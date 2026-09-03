#!/bin/bash
#
# Check AWS credentials setup for mail user
#

echo "=== AWS Credentials Check ==="
echo ""

# Check current user
echo "Current user: $(whoami)"
echo "HOME: $HOME"
echo ""

# Check AWS CLI
AWS_CMD="/usr/local/bin/aws"
if [ -f "$AWS_CMD" ] && [ -x "$AWS_CMD" ]; then
  echo "✓ AWS CLI found at: $AWS_CMD"
  "$AWS_CMD" --version
else
  echo "✗ AWS CLI not found at $AWS_CMD"
  which aws || echo "✗ 'aws' not in PATH"
fi
echo ""

# Check credentials locations
echo "=== Checking credentials locations ==="
echo ""

# Check /var/mail/.aws (mail user's home)
if [ -d "/var/mail/.aws" ]; then
  echo "✓ /var/mail/.aws exists"
  ls -la /var/mail/.aws/
  echo ""
  if [ -f "/var/mail/.aws/credentials" ]; then
    echo "✓ /var/mail/.aws/credentials exists"
    echo "First line: $(head -n1 /var/mail/.aws/credentials)"
  else
    echo "✗ /var/mail/.aws/credentials NOT found"
  fi
  if [ -f "/var/mail/.aws/config" ]; then
    echo "✓ /var/mail/.aws/config exists"
  else
    echo "✗ /var/mail/.aws/config NOT found"
  fi
else
  echo "✗ /var/mail/.aws directory NOT found"
fi
echo ""

# Check current user's .aws
if [ -d "$HOME/.aws" ]; then
  echo "✓ $HOME/.aws exists"
  ls -la "$HOME/.aws/"
  echo ""
  if [ -f "$HOME/.aws/credentials" ]; then
    echo "✓ $HOME/.aws/credentials exists"
    echo "First line: $(head -n1 "$HOME/.aws/credentials")"
  else
    echo "✗ $HOME/.aws/credentials NOT found"
  fi
else
  echo "✗ $HOME/.aws directory NOT found"
fi
echo ""

# Test AWS access
echo "=== Testing AWS S3 Access ==="
export HOME="/var/mail"
export AWS_SHARED_CREDENTIALS_FILE="$HOME/.aws/credentials"
export AWS_CONFIG_FILE="$HOME/.aws/config"

if [ -f "$AWS_CMD" ] && [ -x "$AWS_CMD" ]; then
  echo "Testing with HOME=$HOME"
  echo "AWS_SHARED_CREDENTIALS_FILE=$AWS_SHARED_CREDENTIALS_FILE"
  echo "AWS_CONFIG_FILE=$AWS_CONFIG_FILE"
  echo ""
  
  if [ -f "$AWS_SHARED_CREDENTIALS_FILE" ]; then
    echo "Attempting to list S3 buckets..."
    "$AWS_CMD" s3 ls --region us-east-1 2>&1 | head -n 5
  else
    echo "✗ Credentials file not found, cannot test"
  fi
else
  echo "✗ AWS CLI not available"
fi

echo ""
echo "=== Setup Instructions ==="
echo ""
echo "If credentials are missing, copy them:"
echo "  sudo mkdir -p /var/mail/.aws"
echo "  sudo cp ~/.aws/credentials /var/mail/.aws/credentials"
echo "  sudo cp ~/.aws/config /var/mail/.aws/config"
echo "  sudo chown -R mail:mail /var/mail/.aws"
echo "  sudo chmod 600 /var/mail/.aws/credentials"
echo "  sudo chmod 600 /var/mail/.aws/config"

