# DealerVault daily copy (SFTP -> S3), deployed with the CRM

The same `sync.py` as `scripts/dealervault/` (see its README for what it does and the AWS / host-key prerequisites),
shipped inside `aidmvcs-be-dev` so every deploy puts it on the server at
`/var/www/html/autopulse-prod-v2/aidmvcs-be-dev/scripts/dealervault-sync/sync.py`. Until 11 Nov 2026 it ran on a machine
nobody could find; when that stopped, no DealerVault file reached the CRM for 9 days (20 Nov 2026).

On the server (once): a Python environment outside the deployed folder, then a daily crontab line at 13:00 UTC:

    python3 -m venv ~/dealervault-sync/.venv
    ~/dealervault-sync/.venv/bin/pip install -r /var/www/html/autopulse-prod-v2/aidmvcs-be-dev/scripts/dealervault-sync/requirements.txt
    0 13 * * * ~/dealervault-sync/.venv/bin/python /var/www/html/autopulse-prod-v2/aidmvcs-be-dev/scripts/dealervault-sync/sync.py >> ~/dealervault-sync/sync.log 2>&1

Each new S3 file reaches the CRM worker through the queue (worker/dealervault/sqsConsumer.js); Admin > DMS feed shows it.
