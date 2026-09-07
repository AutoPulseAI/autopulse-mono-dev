# DealerVault / Authenticom SFTP sync

`sync.py` copies regular files from the SFTP account's login directory (`.`) to
`s3://autopulse-dealervault-975497245504-us-east-1-an/raw/<filename>` in `us-east-1`.
It does not recurse into directories or follow listed symlinks. Change
`REMOTE_DIRECTORY` in the script if the provider assigns another directory.

Existing S3 keys are skipped, even if the remote file has changed. The script loads
all keys under `raw/` with a paginated `ListObjectsV2` listing once per run, then
checks an in-memory set instead of making a HEAD request for each remote file.
No S3 listing is needed when the remote directory has no candidate files. An S3
listing error aborts before any transfers and reports all candidates as
`not_attempted`; a partial listing is never used. Listing requests and memory use
scale with the number of S3 keys under `raw/`, including historical files no longer
on SFTP. Keys created or deleted after listing may be reflected on the next run.
Both single PUTs and multipart completion use `IfNoneMatch="*"`, so a writer racing the listing
cannot overwrite an existing key. A 412 response counts as skipped; other errors,
including a 409 conflict, fail the file for retry on the next run. Incomplete
multipart uploads are aborted on failure (abort failures are logged as warnings).
New files are downloaded one at a time into a private `TemporaryDirectory` under
this directory.
The script checks the downloaded byte count and remote size/modification time
before uploading the original bytes, then removes the temporary directory,
including after failures. Missing listing modes are explicitly logged and counted
as failed entries, rather than silently omitted. Missing size, mode, or modification
time on a downloaded file fails validation; timestamps are never optional.

Downloads open one remote handle, check its metadata and recheck the path before
reading any bytes, and verify both again afterward. This mitigates symlink swaps,
but **does not guarantee atomic no-follow behavior**: Paramiko's SFTP v3 interface
has no `O_NOFOLLOW` equivalent or stable inode identifier. A transient replacement
with matching metadata can evade the checks. The provider must expose completed,
immutable files in a directory protected from untrusted writers; strict no-follow
guarantees require server/protocol support beyond this client. These checks also
cannot detect same-size rewrites that preserve timestamps.
Remote files are never changed or deleted, and contents are never parsed.

Timestamped logs report discoveries, skips, downloads, uploads, failures, and final
counts. File failures do not stop subsequent files. Exit status is `0` on success
(including no new files) or `1` for any file failure, startup error, or lock conflict.
Cleanup errors count as `cleanup_warnings`, preserving the successful upload/skip
count and exit status. They identify a local directory requiring cleanup.
On a dropped SFTP connection the current file fails, and the script attempts one
reconnection before processing the remaining entries. If recovery fails, the run
aborts, reporting the remaining entries as `not_attempted`, not independent file
failures. The failed transfer can be retried by rerunning the script.

Final logs include `listing=not_started|failed|complete` and
`status=aborted|file_failures|complete`. Until a listing completes, `discovered` is
`unknown`, distinguishing a listing error from a successful empty run. Discovered
counts include unclassified entries; on completed listings, discovered equals
skipped + uploaded + failed + not_attempted. Startup errors are reported separately
from file failures. SDK failures log the operation and exception class, without
raw responses or tracebacks.

## EC2 IAM permissions

Use the instance's existing IAM role through boto3's default credential provider.
Do not configure or export AWS access keys. The role needs:

- `secretsmanager:GetSecretValue` on the ARN of `dealervault/sftp` in `us-east-1`
  (use its actual ARN, including Secrets Manager's generated suffix).
- `s3:PutObject` and `s3:AbortMultipartUpload` on
  `arn:aws:s3:::autopulse-dealervault-975497245504-us-east-1-an/raw/*`.
- `s3:ListBucket` on
  `arn:aws:s3:::autopulse-dealervault-975497245504-us-east-1-an`.
  This permits the initial listing of existing keys. Listing failures, including
  access denied (403), abort the run without downloading or uploading files.
- If a customer managed KMS key encrypts the secret, `kms:Decrypt` on that key.
  If the bucket uses SSE-KMS, `kms:GenerateDataKey` and `kms:Decrypt` on its key,
  with the corresponding key policies allowing the role.

The EC2 instance also needs network access to the SFTP host/port, Secrets Manager,
and S3. The bucket must already exist.

## Secret structure

Store this JSON as the **SecretString** of `dealervault/sftp`:

```json
{
  "host": "sftp.example.com",
  "port": 22,
  "username": "your-dealervault-username",
  "password": "your-dealervault-password"
}
```

Use the actual provider values in Secrets Manager; do not commit them to this repo.

## Host key and lock prerequisites

An administrator must obtain the SSH host key and independently verify its
fingerprint with Authenticom/DealerVault, then provision it in the run user's
`~/.ssh/known_hosts` or `/etc/ssh/ssh_known_hosts`. The host must match the secret's
`host`; for a nondefault port, the known_hosts name is `[host]:port`. Blindly
trusting `ssh-keyscan` output is not verification. Unknown and changed keys are
rejected; this script never adds or updates keys.

The run user must be able to open/create
`/var/lock/autopulse-dealervault-sync.lock`. If `/var/lock` is not writable,
have an administrator pre-create that regular file with ownership and read/write
permissions for the run user. All runs must use this same lock file. It remains
on disk after exit; the OS releases its advisory lock when the process exits.
Do not delete it to clear a lock. No system configuration is changed by setup
commands below. The runtime lock is the only file the script creates outside
this repository.

## Python setup and manual execution

Use Python 3.10 or newer on Linux. From the repository root:

```bash
python3 -m venv scripts/dealervault/.venv
scripts/dealervault/.venv/bin/python -m pip install -r scripts/dealervault/requirements.txt
scripts/dealervault/.venv/bin/python scripts/dealervault/sync.py
echo $?
```

The run user needs write access to `scripts/dealervault` and enough disk space for
the largest remote file. An uncatchable termination or power loss can leave a
`.download-*` directory behind; remove leftover downloads only when no sync is
running. No scheduler, systemd service, or downstream processing is installed.

Run the offline regression suite (AWS calls are stubbed; no SFTP connection is made):

```bash
scripts/dealervault/.venv/bin/python -m unittest discover -s scripts/dealervault -v
```

## Verify uploads

In the AWS S3 console, open bucket
`autopulse-dealervault-975497245504-us-east-1-an`, then `raw/`, and check filenames,
sizes, and last-modified timestamps against the successful upload logs. A manual
rerun should log skips for keys already uploaded.

For a programmatic listing using the same EC2 role:

```bash
scripts/dealervault/.venv/bin/python - <<'PY'
import boto3

s3 = boto3.client("s3", region_name="us-east-1")
for page in s3.get_paginator("list_objects_v2").paginate(
    Bucket="autopulse-dealervault-975497245504-us-east-1-an", Prefix="raw/"
):
    for obj in page.get("Contents", []):
        print(repr(obj["Key"]), obj["Size"], obj["LastModified"])
PY
```

References: [Paramiko host-key verification](https://docs.paramiko.org/en/stable/api/client.html),
[SFTP file handles and metadata](https://docs.paramiko.org/en/stable/api/sftp.html),
[S3 ListObjectsV2 pagination](https://docs.aws.amazon.com/boto3/latest/reference/services/s3/paginator/ListObjectsV2.html),
[conditional PUT](https://docs.aws.amazon.com/boto3/latest/reference/services/s3/client/put_object.html),
and [conditional multipart completion](https://docs.aws.amazon.com/boto3/latest/reference/services/s3/client/complete_multipart_upload.html).
