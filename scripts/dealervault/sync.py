#!/usr/bin/env python3
"""Copy previously unseen DealerVault SFTP files to S3 without altering them."""

import fcntl
import json
import logging
import os
import posixpath
import stat
import tempfile
from contextlib import ExitStack, contextmanager
from pathlib import Path

import boto3
import paramiko
from botocore.exceptions import ClientError

AWS_REGION = "us-east-1"
SECRET_ID = "dealervault/sftp"
S3_BUCKET = "autopulse-dealervault-975497245504-us-east-1-an"
S3_PREFIX = "raw"
REMOTE_DIRECTORY = "."  # The SFTP account's login directory; no recursion.
LOCK_FILE = "/var/lock/autopulse-dealervault-sync.lock"
DOWNLOAD_DIRECTORY = Path(__file__).resolve().parent
TIMEOUT_SECONDS = 60
PART_SIZE = 64 * 1024 * 1024
COPY_CHUNK_SIZE = 1024 * 1024

LOGGER = logging.getLogger("dealervault.sync")


class SyncError(Exception):
    """An operational error with a message safe to log."""


class RejectUnknownHostKey(paramiko.MissingHostKeyPolicy):
    def missing_host_key(self, client, hostname, key):
        raise SyncError(
            "Unknown DealerVault host key. Have an administrator verify the "
            "provider's fingerprint and provision known_hosts for the run user."
        )


@contextmanager
def acquire_lock():
    """Keep the inode in place so competing processes always lock the same file."""
    try:
        fd = os.open(LOCK_FILE, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    except OSError:
        raise SyncError(
            "Cannot open lock file at "
            + LOCK_FILE
            + "; ensure it is provisioned and writable by the run user."
        ) from None
    with os.fdopen(fd, "r+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SyncError("Another DealerVault sync is already running.") from None
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def get_secret():
    with boto3.client("secretsmanager", region_name=AWS_REGION) as client:
        response = client.get_secret_value(SecretId=SECRET_ID)
    try:
        secret = json.loads(response["SecretString"])
        if not isinstance(secret, dict):
            raise ValueError
        for key in ("host", "username", "password"):
            if not isinstance(secret.get(key), str) or not secret[key]:
                raise ValueError
        port = secret["port"]
        if isinstance(port, bool) or not isinstance(port, (str, int)):
            raise ValueError
        port = int(port)
        if not 1 <= port <= 65535:
            raise ValueError
    except (KeyError, TypeError, ValueError):
        raise SyncError(
            "Invalid secret: expected JSON with nonempty host, username, password "
            "strings and a port from 1 through 65535."
        ) from None
    return {key: secret[key] for key in ("host", "username", "password")} | {
        "port": port
    }


@contextmanager
def connect_sftp(secret):
    with paramiko.SSHClient() as client:
        # Explicit filenames make unreadable or malformed trust stores fail closed.
        for path in (
            Path("/etc/ssh/ssh_known_hosts"),
            Path.home() / ".ssh/known_hosts",
        ):
            if path.exists():
                client.load_system_host_keys(str(path))
        client.set_missing_host_key_policy(RejectUnknownHostKey())
        try:
            client.connect(
                hostname=secret["host"],
                port=secret["port"],
                username=secret["username"],
                password=secret["password"],
                allow_agent=False,
                look_for_keys=False,
                timeout=TIMEOUT_SECONDS,
                banner_timeout=TIMEOUT_SECONDS,
                auth_timeout=TIMEOUT_SECONDS,
                channel_timeout=TIMEOUT_SECONDS,
            )
        except paramiko.BadHostKeyException:
            raise SyncError(
                "DealerVault host key has changed or does not match known_hosts. "
                "Have an administrator verify the key with the provider."
            ) from None
        with client.open_sftp() as sftp:
            sftp.get_channel().settimeout(TIMEOUT_SECONDS)
            LOGGER.info("Successful SFTP connection")
            yield sftp


def list_remote_files(sftp):
    # Keep unclassified entries so they fail explicitly in the per-file loop.
    return sorted(
        (
            entry
            for entry in sftp.listdir_attr(REMOTE_DIRECTORY)
            if entry.st_mode is None or stat.S_ISREG(entry.st_mode)
        ),
        key=lambda entry: entry.filename,
    )


def list_existing_keys(s3):
    """Build the skip set only after every page has been fetched successfully."""
    pages = s3.get_paginator("list_objects_v2").paginate(
        Bucket=S3_BUCKET,
        Prefix=f"{S3_PREFIX}/",
    )
    return {obj["Key"] for page in pages for obj in page.get("Contents", [])}


def file_metadata(attributes):
    if attributes.st_mode is None or not stat.S_ISREG(attributes.st_mode):
        raise SyncError(
            "Remote entry is not a verified regular file (mode missing or changed)."
        )
    if attributes.st_size is None or attributes.st_size < 0:
        raise SyncError("Remote file size is unavailable.")
    if attributes.st_mtime is None:
        raise SyncError(
            "Remote modification time is unavailable; cannot verify stability."
        )
    return attributes.st_mode, attributes.st_size, attributes.st_mtime


def download_file(sftp, remote_file, local_path):
    remote_path = posixpath.join(REMOTE_DIRECTORY, remote_file.filename)
    before = file_metadata(sftp.lstat(remote_path))
    # SFTP v3 has no O_NOFOLLOW or stable inode identity. These checks mitigate
    # replacement races but cannot prove identity against a hostile remote writer.
    with sftp.open(remote_path, "rb") as source:
        if (
            file_metadata(source.stat()) != before
            or file_metadata(sftp.lstat(remote_path)) != before
        ):
            raise SyncError("Remote file changed while opening; no content downloaded.")
        remaining = before[1]
        with local_path.open("wb") as target:
            while remaining:
                chunk = source.read(min(COPY_CHUNK_SIZE, remaining))
                if not chunk:
                    raise SyncError("Download ended before the expected byte count.")
                target.write(chunk)
                remaining -= len(chunk)
            if source.read(1):
                raise SyncError("Remote file grew during download.")
        if (
            file_metadata(source.stat()) != before
            or file_metadata(sftp.lstat(remote_path)) != before
            or local_path.stat().st_size != before[1]
        ):
            raise SyncError(
                "Download size mismatch or remote file changed during download."
            )
    LOGGER.info("Downloaded file %r (%d bytes)", remote_file.filename, before[1])


def conditional_multipart_upload(s3, local_path, key):
    upload_id = s3.create_multipart_upload(Bucket=S3_BUCKET, Key=key)["UploadId"]
    completed = False
    try:
        parts = []
        # Stay within S3's 10,000-part limit, including for very large files.
        part_size = max(PART_SIZE, (local_path.stat().st_size + 9999) // 10000)
        with local_path.open("rb") as source:
            while chunk := source.read(part_size):
                number = len(parts) + 1
                response = s3.upload_part(
                    Bucket=S3_BUCKET,
                    Key=key,
                    UploadId=upload_id,
                    PartNumber=number,
                    Body=chunk,
                )
                parts.append({"PartNumber": number, "ETag": response["ETag"]})
        s3.complete_multipart_upload(
            Bucket=S3_BUCKET,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={"Parts": parts},
            IfNoneMatch="*",
        )
        completed = True
    finally:
        if not completed:
            try:
                s3.abort_multipart_upload(Bucket=S3_BUCKET, Key=key, UploadId=upload_id)
            except Exception as error:
                LOGGER.warning(
                    "Could not abort incomplete multipart upload for %r: %s",
                    key,
                    error_description(error),
                )


def upload_file(s3, local_path, key):
    """Return False if another writer created the key; never overwrite a key."""
    try:
        if local_path.stat().st_size > PART_SIZE:
            conditional_multipart_upload(s3, local_path, key)
        else:
            with local_path.open("rb") as source:
                s3.put_object(Bucket=S3_BUCKET, Key=key, Body=source, IfNoneMatch="*")
    except ClientError as error:
        if error.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 412:
            LOGGER.info("Skipped concurrently created S3 key %r", key)
            return False
        # A 409 or an ambiguous network outcome is a failure, safe to retry on
        # the next run. Never fall back to an unconditional write.
        raise
    LOGGER.info("Successful S3 upload: s3://%s/%s", S3_BUCKET, repr(key))
    return True


@contextmanager
def temporary_download(counts):
    directory = tempfile.TemporaryDirectory(prefix=".download-", dir=DOWNLOAD_DIRECTORY)
    try:
        yield Path(directory.name) / "payload"
    finally:
        try:
            directory.cleanup()
        except Exception as error:
            counts["cleanup_warnings"] += 1
            LOGGER.warning(
                "Temporary cleanup failed at %r: %s; remove when no sync is running",
                directory.name,
                error_description(error),
            )


def connection_lost(sftp, error):
    if isinstance(
        error, (EOFError, ConnectionError, TimeoutError, paramiko.SSHException)
    ):
        return True
    channel = sftp.get_channel()
    transport = channel.get_transport()
    return channel.closed or transport is None or not transport.is_active()


def error_description(error):
    # Temporary debug mode: include exception type and message.
    # Revert to sanitized logging after the startup failure is fixed.
    return f"{type(error).__name__}: {error}"


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    counts = dict(
        discovered=None,
        skipped=0,
        uploaded=0,
        failed=0,
        not_attempted=0,
        cleanup_warnings=0,
        connection_failures=0,
    )
    listing_status = "not_started"
    run_status = "aborted"
    stage = "startup"
    LOGGER.info("Sync started")
    try:
        with acquire_lock():
            secret = get_secret()
            with (
                ExitStack() as connections,
                boto3.client("s3", region_name=AWS_REGION) as s3,
            ):
                stage = "connecting SFTP"
                sftp = connections.enter_context(connect_sftp(secret))
                stage = "listing remote directory"
                listing_status = "failed"
                remote_files = list_remote_files(sftp)
                listing_status = "complete"
                counts["discovered"] = len(remote_files)
                LOGGER.info("Remote files discovered: %d", counts["discovered"])
                stage = "listing existing S3 keys"
                counts["not_attempted"] = len(remote_files)
                existing_keys = list_existing_keys(s3) if remote_files else set()
                counts["not_attempted"] = 0
                LOGGER.info("Existing S3 keys loaded: %d", len(existing_keys))
                for index, remote_file in enumerate(remote_files):
                    stage = "validating filename"
                    try:
                        name = remote_file.filename
                        if (
                            not name
                            or name in (".", "..")
                            or "/" in name
                            or "\x00" in name
                        ):
                            raise SyncError("Invalid remote filename.")
                        if remote_file.st_mode is None:
                            raise SyncError(
                                "Remote listing omitted file mode; cannot classify entry."
                            )
                        key = f"{S3_PREFIX}/{name}"
                        stage = "checking S3"
                        if key in existing_keys:
                            counts["skipped"] += 1
                            LOGGER.info("Skipped existing file %r", name)
                            continue
                        stage = "downloading"
                        with temporary_download(counts) as local_path:
                            download_file(sftp, remote_file, local_path)
                            stage = "uploading to S3"
                            if upload_file(s3, local_path, key):
                                counts["uploaded"] += 1
                            else:
                                counts["skipped"] += 1
                            existing_keys.add(key)
                    except Exception as error:
                        counts["failed"] += 1
                        LOGGER.error(
                            "Failed file %r while %s: %s",
                            remote_file.filename,
                            stage,
                            error_description(error),
                        )
                        if stage == "downloading" and connection_lost(sftp, error):
                            counts["connection_failures"] += 1
                            remaining = len(remote_files) - index - 1
                            LOGGER.error(
                                "SFTP connection lost; %d files remain", remaining
                            )
                            if remaining:
                                # One bounded recovery attempt, rather than failing every
                                # subsequent file on the same dead connection.
                                counts["not_attempted"] = remaining
                                stage = "reconnecting SFTP"
                                connections.close()
                                sftp = connections.enter_context(connect_sftp(secret))
                                counts["not_attempted"] = 0
                stage = "closing connections"
        run_status = "file_failures" if counts["failed"] else "complete"
    except Exception as error:
        LOGGER.exception(
            "Sync aborted while %s: %s",
            stage,
            error_description(error),
        )
        return 1
    finally:
        LOGGER.info(
            "Final counts: discovered=%s skipped=%d uploaded=%d failed=%d "
            "not_attempted=%d cleanup_warnings=%d connection_failures=%d "
            "listing=%s status=%s",
            counts["discovered"] if counts["discovered"] is not None else "unknown",
            counts["skipped"],
            counts["uploaded"],
            counts["failed"],
            counts["not_attempted"],
            counts["cleanup_warnings"],
            counts["connection_failures"],
            listing_status,
            run_status,
        )
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
