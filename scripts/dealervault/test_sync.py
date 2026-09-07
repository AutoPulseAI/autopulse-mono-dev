"""Offline regressions; run with python -m unittest discover -s scripts/dealervault."""

import io
import stat
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import boto3
from botocore import UNSIGNED
from botocore.config import Config
from botocore.stub import ANY, Stubber

import sync


def entry(name="a file.csv", mode=stat.S_IFREG | 0o600, size=3, mtime=1):
    return SimpleNamespace(filename=name, st_mode=mode, st_size=size, st_mtime=mtime)


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "payload"
        self.path.write_bytes(b"abc")
        # UNSIGNED avoids credential discovery; Stubber intercepts every request.
        self.s3 = boto3.client("s3", region_name=sync.AWS_REGION,
                               config=Config(signature_version=UNSIGNED))
        self.addCleanup(self.s3.close)
        self.sftp = MagicMock()
        self.sftp.get_channel.return_value.closed = False
        self.sftp.get_channel.return_value.get_transport.return_value.is_active.return_value = True

    def run_sync(self, files, download=None, upload=True, connect=None, listing_error=None,
                 existing_keys=None, s3_listing_error=None):
        self.sftp.listdir_attr.side_effect = listing_error
        self.sftp.listdir_attr.return_value = files
        with patch.object(sync, "acquire_lock", nullcontext), \
                patch.object(sync, "get_secret", return_value={}), \
                patch.object(sync, "connect_sftp", side_effect=connect or (lambda _: nullcontext(self.sftp))), \
                patch.object(sync.boto3, "client", return_value=nullcontext(self.s3)), \
                patch.object(sync, "list_existing_keys", return_value=set(existing_keys or ()),
                             side_effect=s3_listing_error), \
                patch.object(sync, "download_file", side_effect=download), \
                patch.object(sync, "upload_file", return_value=upload), \
                patch.object(sync, "DOWNLOAD_DIRECTORY", Path(self.directory.name)), \
                self.assertLogs(sync.LOGGER, level="INFO") as logs:
            status = sync.main()
        return status, "\n".join(logs.output)

    def test_cleanup_error_keeps_uploaded_and_success_status(self):
        real_directory = tempfile.TemporaryDirectory

        def failing_directory(**kwargs):
            directory = real_directory(**kwargs)
            cleanup = directory.cleanup

            def fail_cleanup():
                cleanup()
                raise PermissionError("sensitive exception text")

            directory.cleanup = fail_cleanup
            return directory

        with patch.object(sync.tempfile, "TemporaryDirectory", side_effect=failing_directory):
            status, logs = self.run_sync([entry()])
        self.assertEqual(status, 0)
        self.assertIn("uploaded=1 failed=0", logs)
        self.assertIn("cleanup_warnings=1", logs)
        self.assertNotIn("sensitive exception text", logs)

    def test_cleanup_error_preserves_original_transfer_failure(self):
        real_cleanup = tempfile.TemporaryDirectory.cleanup

        def fail_cleanup(directory):
            real_cleanup(directory)
            raise PermissionError

        with patch.object(sync.tempfile.TemporaryDirectory, "cleanup", autospec=True,
                          side_effect=fail_cleanup):
            status, logs = self.run_sync([entry()], download=ValueError("secret"))
        self.assertEqual(status, 1)
        self.assertIn("uploaded=0 failed=1", logs)
        self.assertIn("ValueError", logs)
        self.assertNotIn("secret", logs)

    def test_conditional_put_success_race_and_conflict(self):
        params = dict(Bucket=sync.S3_BUCKET, Key="raw/a file.csv", Body=ANY, IfNoneMatch="*")
        with Stubber(self.s3) as stub:
            stub.add_response("put_object", {}, params)
            self.assertTrue(sync.upload_file(self.s3, self.path, "raw/a file.csv"))
            stub.add_client_error("put_object", "PreconditionFailed", http_status_code=412,
                                  expected_params=params)
            self.assertFalse(sync.upload_file(self.s3, self.path, "raw/a file.csv"))
            stub.add_client_error("put_object", "ConditionalRequestConflict", http_status_code=409,
                                  expected_params=params)
            with self.assertRaises(sync.ClientError):
                sync.upload_file(self.s3, self.path, "raw/a file.csv")
            stub.assert_no_pending_responses()

    def test_conditional_multipart_success_and_race(self):
        base = dict(Bucket=sync.S3_BUCKET, Key="raw/a file.csv")
        for conflict in (False, True):
            with self.subTest(conflict=conflict), Stubber(self.s3) as stub, patch.object(sync, "PART_SIZE", 2):
                stub.add_response("create_multipart_upload", {"UploadId": "id"}, base)
                for number, body in ((1, b"ab"), (2, b"c")):
                    stub.add_response("upload_part", {"ETag": str(number)},
                                      dict(base, UploadId="id", PartNumber=number, Body=body))
                complete = dict(base, UploadId="id", IfNoneMatch="*", MultipartUpload={"Parts": [
                    {"PartNumber": 1, "ETag": "1"}, {"PartNumber": 2, "ETag": "2"}]})
                if conflict:
                    stub.add_client_error("complete_multipart_upload", "PreconditionFailed",
                                          http_status_code=412, expected_params=complete)
                    stub.add_response("abort_multipart_upload", {}, dict(base, UploadId="id"))
                else:
                    stub.add_response("complete_multipart_upload", {}, complete)
                self.assertEqual(sync.upload_file(self.s3, self.path, base["Key"]), not conflict)
                stub.assert_no_pending_responses()

    def test_multipart_part_failure_aborts(self):
        base = dict(Bucket=sync.S3_BUCKET, Key="raw/a")
        with Stubber(self.s3) as stub, patch.object(sync, "PART_SIZE", 2):
            stub.add_response("create_multipart_upload", {"UploadId": "id"}, base)
            stub.add_client_error("upload_part", "AccessDenied", http_status_code=403,
                                  expected_params=dict(base, UploadId="id", PartNumber=1, Body=b"ab"))
            stub.add_response("abort_multipart_upload", {}, dict(base, UploadId="id"))
            with self.assertRaises(sync.ClientError): sync.upload_file(self.s3, self.path, "raw/a")
            stub.assert_no_pending_responses()

    def test_existing_keys_pagination_and_spaces(self):
        params = dict(Bucket=sync.S3_BUCKET, Prefix="raw/")
        with Stubber(self.s3) as stub:
            stub.add_response("list_objects_v2", {
                "Contents": [{"Key": "raw/a"}], "IsTruncated": True,
                "NextContinuationToken": "next",
            }, params)
            stub.add_response("list_objects_v2", {
                "Contents": [{"Key": "raw/a file.csv"}], "IsTruncated": False,
            }, dict(params, ContinuationToken="next"))
            self.assertEqual(sync.list_existing_keys(self.s3), {"raw/a", "raw/a file.csv"})
            stub.assert_no_pending_responses()

    def test_empty_s3_listing(self):
        with Stubber(self.s3) as stub:
            stub.add_response("list_objects_v2", {"IsTruncated": False},
                              dict(Bucket=sync.S3_BUCKET, Prefix="raw/"))
            self.assertEqual(sync.list_existing_keys(self.s3), set())

    def test_partial_s3_listing_is_not_used(self):
        params = dict(Bucket=sync.S3_BUCKET, Prefix="raw/")
        with Stubber(self.s3) as stub:
            stub.add_response("list_objects_v2", {
                "Contents": [{"Key": "raw/a"}], "IsTruncated": True,
                "NextContinuationToken": "next",
            }, params)
            stub.add_client_error("list_objects_v2", "AccessDenied", http_status_code=403,
                                  expected_params=dict(params, ContinuationToken="next"))
            with self.assertRaises(sync.ClientError): sync.list_existing_keys(self.s3)

    def test_s3_listing_failure_aborts_before_transfers(self):
        download = MagicMock()
        status, logs = self.run_sync([entry(), entry("b")], download=download,
                                     s3_listing_error=ConnectionError())
        self.assertEqual(status, 1)
        download.assert_not_called()
        self.assertIn("listing existing S3 keys", logs)
        self.assertIn("failed=0 not_attempted=2", logs)

    def test_existing_keys_skip_without_download(self):
        download = MagicMock()
        status, logs = self.run_sync([entry()], download=download,
                                     existing_keys={"raw/a file.csv"})
        self.assertEqual(status, 0)
        download.assert_not_called()
        self.assertIn("skipped=1 uploaded=0 failed=0", logs)

    def test_empty_remote_listing_does_not_list_s3(self):
        status, _ = self.run_sync([], s3_listing_error=AssertionError("Unexpected S3 listing"))
        self.assertEqual(status, 0)

    def test_dropped_connection_recovers_for_remaining_file(self):
        connections = MagicMock(side_effect=lambda _: nullcontext(self.sftp))
        status, logs = self.run_sync([entry("a"), entry("b")],
                                     download=[EOFError(), None], connect=connections)
        self.assertEqual(status, 1)
        self.assertEqual(connections.call_count, 2)
        self.assertIn("uploaded=1 failed=1 not_attempted=0", logs)
        self.assertIn("connection_failures=1", logs)

    def test_failed_reconnect_reports_remaining_as_unattempted(self):
        connections = MagicMock(side_effect=[nullcontext(self.sftp), ConnectionError()])
        status, logs = self.run_sync([entry(str(i)) for i in range(100)],
                                     download=EOFError(), connect=connections)
        self.assertEqual(status, 1)
        self.assertIn("failed=1 not_attempted=99", logs)
        self.assertIn("status=aborted", logs)
        self.assertEqual(logs.count("Failed file"), 1)

    def test_individual_failure_continues_without_reconnect(self):
        connections = MagicMock(side_effect=lambda _: nullcontext(self.sftp))
        status, logs = self.run_sync([entry("a"), entry("b")],
                                     download=[PermissionError(), None], connect=connections)
        self.assertEqual(status, 1)
        self.assertEqual(connections.call_count, 1)
        self.assertIn("uploaded=1 failed=1", logs)

    def prepare_download(self, payload=b"abc", metadata=None):
        source = MagicMock()
        source.read.side_effect = io.BytesIO(payload).read
        source.stat.return_value = metadata or entry()
        self.sftp.open.return_value.__enter__.return_value = source
        self.sftp.lstat.return_value = metadata or entry()
        return source

    def test_open_time_symlink_swap_rejected_before_read(self):
        source = self.prepare_download()
        self.sftp.lstat.side_effect = [entry(), entry(mode=stat.S_IFLNK)]
        with self.assertRaises(sync.SyncError): sync.download_file(self.sftp, entry(), self.path)
        source.read.assert_not_called()

    def test_open_handle_change_rejected_before_read(self):
        source = self.prepare_download()
        source.stat.return_value = entry(size=100)
        with self.assertRaises(sync.SyncError): sync.download_file(self.sftp, entry(), self.path)
        source.read.assert_not_called()

    def test_download_exact_bytes_and_validation_failures(self):
        for payload in (b"", b"ab", b"abcd", b"abc"):
            with self.subTest(payload=payload):
                self.prepare_download(payload)
                if payload == b"abc":
                    sync.download_file(self.sftp, entry(), self.path)
                    self.assertEqual(self.path.read_bytes(), payload)
                else:
                    with self.assertRaises(sync.SyncError): sync.download_file(self.sftp, entry(), self.path)

    def test_missing_mtime_fails_before_read(self):
        source = self.prepare_download(metadata=entry(mtime=None))
        with self.assertRaisesRegex(sync.SyncError, "modification time"):
            sync.download_file(self.sftp, entry(), self.path)
        source.read.assert_not_called()

    def test_mtime_changes_or_disappears_after_download(self):
        for mtime in (None, 2):
            with self.subTest(mtime=mtime):
                source = self.prepare_download()
                source.stat.side_effect = [entry(), entry(mtime=mtime)]
                with self.assertRaises(sync.SyncError): sync.download_file(self.sftp, entry(), self.path)

    def test_missing_mode_counted_and_directories_ignored(self):
        status, logs = self.run_sync([entry(mode=None), entry("dir", mode=stat.S_IFDIR),
                                     entry("link", mode=stat.S_IFLNK)])
        self.assertEqual(status, 1)
        self.assertIn("discovered=1 skipped=0 uploaded=0 failed=1", logs)
        self.assertIn("omitted file mode", logs)

    def test_listing_failure_differs_from_empty_success(self):
        status, logs = self.run_sync([], listing_error=EOFError())
        self.assertEqual(status, 1)
        self.assertIn("discovered=unknown", logs)
        self.assertIn("listing=failed status=aborted", logs)
        status, logs = self.run_sync([])
        self.assertEqual(status, 0)
        self.assertIn("discovered=0", logs)
        self.assertIn("listing=complete status=complete", logs)

    def test_concurrent_creation_counts_as_skip(self):
        status, logs = self.run_sync([entry()], upload=False)
        self.assertEqual(status, 0)
        self.assertIn("skipped=1 uploaded=0 failed=0", logs)


if __name__ == "__main__":
    unittest.main()
