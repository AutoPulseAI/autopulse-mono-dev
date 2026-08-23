# AWS Credentials Fix

## 🐛 **Problem:**

The script was failing to upload `.eml` files to S3 with error:
```
Unable to locate credentials
HOME: /tmp
AWS_SHARED_CREDENTIALS_FILE: /tmp/.aws/credentials
```

## 🔍 **Root Cause:**

When the script runs as the `mail` user, the `HOME` environment variable was being set to `/tmp` (possibly by the system or Exim4), causing AWS CLI to look for credentials in the wrong location.

The original code:
```bash
export HOME="${HOME:-/var/mail}"  # Only sets if HOME is unset/empty
export AWS_SHARED_CREDENTIALS_FILE="${AWS_SHARED_CREDENTIALS_FILE:-$HOME/.aws/credentials}"
```

If `HOME` was already set to `/tmp`, it would keep that value and look for credentials at `/tmp/.aws/credentials`.

## ✅ **Solution:**

Force `HOME` to `/var/mail` unconditionally and use absolute paths for AWS credentials:

```bash
# Force HOME to /var/mail (mail user's home) regardless of what it was set to
export HOME="/var/mail"

# Explicitly set AWS credentials file paths - use absolute path
export AWS_SHARED_CREDENTIALS_FILE="${AWS_SHARED_CREDENTIALS_FILE:-/var/mail/.aws/credentials}"
export AWS_CONFIG_FILE="${AWS_CONFIG_FILE:-/var/mail/.aws/config}"
```

## 📋 **Setup Instructions:**

1. **Copy AWS credentials to mail user's home:**
   ```bash
   sudo mkdir -p /var/mail/.aws
   sudo cp ~/.aws/credentials /var/mail/.aws/credentials
   sudo cp ~/.aws/config /var/mail/.aws/config
   sudo chown -R mail:mail /var/mail/.aws
   sudo chmod 600 /var/mail/.aws/credentials
   sudo chmod 600 /var/mail/.aws/config
   ```

2. **Verify credentials are accessible:**
   ```bash
   sudo su -s /bin/bash mail -c "HOME=/var/mail /usr/local/bin/aws s3 ls --region us-east-1"
   ```

3. **Deploy updated script:**
   ```bash
   sudo cp email_webhook_simple_with_s3.sh /usr/local/bin/email_webhook_hestia.sh
   sudo chmod +x /usr/local/bin/email_webhook_hestia.sh
   ```

4. **Test with a real email** and check logs:
   ```bash
   tail -f /tmp/email_webhook_log.txt
   ```

## 🔍 **Verification:**

After deploying, check the logs for:
- `HOME: /var/mail` ✅
- `AWS_SHARED_CREDENTIALS_FILE: /var/mail/.aws/credentials` ✅
- `[SUCCESS] Email .eml uploaded to S3: https://...` ✅

## 📝 **Files Changed:**

- `email_webhook_simple_with_s3.sh` - Fixed HOME and AWS credentials paths

