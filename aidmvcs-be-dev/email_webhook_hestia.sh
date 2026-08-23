#!/bin/bash

set +e  # Don't exit on errors

# Ensure AWS CLI is in PATH and HOME is set for credentials
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
# Force HOME to /var/mail (mail user's home) regardless of what it was set to
export HOME="/var/mail"

# AWS S3 Configuration
export AWS_S3_BUCKET="${AWS_S3_BUCKET:-autopulseai}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

# Explicitly set AWS credentials file paths (for mail user) - use absolute path
export AWS_SHARED_CREDENTIALS_FILE="${AWS_SHARED_CREDENTIALS_FILE:-/var/mail/.aws/credentials}"
export AWS_CONFIG_FILE="${AWS_CONFIG_FILE:-/var/mail/.aws/config}"

LOGFILE="/tmp/email_webhook_log.txt"
EMAIL_CONTENT=$(cat)

echo "=== [$(date)] Email webhook START ===" >> "$LOGFILE"
echo "Raw content size: ${#EMAIL_CONTENT} bytes" >> "$LOGFILE"
echo "AWS CLI path: $(command -v aws 2>/dev/null || echo 'not found')" >> "$LOGFILE"
echo "AWS S3 Bucket: $AWS_S3_BUCKET" >> "$LOGFILE"
echo "AWS Region: $AWS_REGION" >> "$LOGFILE"
echo "HOME: $HOME" >> "$LOGFILE"
echo "AWS_SHARED_CREDENTIALS_FILE: $AWS_SHARED_CREDENTIALS_FILE" >> "$LOGFILE"
echo "AWS_CONFIG_FILE: $AWS_CONFIG_FILE" >> "$LOGFILE"
echo "AWS credentials exist: $([ -f "$AWS_SHARED_CREDENTIALS_FILE" ] && echo 'yes' || echo 'no')" >> "$LOGFILE"
echo "AWS config exists: $([ -f "$AWS_CONFIG_FILE" ] && echo 'yes' || echo 'no')" >> "$LOGFILE"

# Create temp directory for attachments
TEMP_DIR=$(mktemp -d 2>/dev/null || echo "/tmp/email_webhook_$$")
mkdir -p "$TEMP_DIR" 2>/dev/null
trap "rm -rf '$TEMP_DIR'" EXIT

# Extract full raw headers (everything before the first empty line)
EMAIL_HEADERS=$(echo "$EMAIL_CONTENT" | sed '/^$/q' 2>/dev/null || echo "$EMAIL_CONTENT")

# Extract headers individually
SENDER=$(echo "$EMAIL_HEADERS" | grep -i "^From:" | sed -e 's/^From:\s*//I' 2>/dev/null || echo "unknown@sender.local")
SUBJECT=$(echo "$EMAIL_HEADERS" | grep -i "^Subject:" | sed -e 's/^Subject:\s*//I' 2>/dev/null || echo "(No Subject)")
MESSAGE_ID=$(echo "$EMAIL_HEADERS" | grep -i "^Message-ID:" | sed -e 's/^Message-ID:\s*//I' 2>/dev/null || echo "<$(date +%s)@webhook.local>")
IN_REPLY_TO=$(echo "$EMAIL_HEADERS" | grep -i "^In-Reply-To:" | sed -e 's/^In-Reply-To:\s*//I' 2>/dev/null || echo "")
REFERENCES=$(echo "$EMAIL_HEADERS" | grep -i "^References:" | sed -e 's/^References:\s*//I' 2>/dev/null || echo "")
DATE=$(echo "$EMAIL_HEADERS" | grep -i "^Date:" | sed -e 's/^Date:\s*//I' 2>/dev/null || date -R)
ENCODING=$(echo "$EMAIL_HEADERS" | grep -i "^Content-Transfer-Encoding:" | awk '{print tolower($2)}' 2>/dev/null || echo "")

# Smarter recipient detection
RECIPIENT=$(echo "$EMAIL_HEADERS" | grep -i "^Delivered-To:" | tail -n1 | sed -e 's/^Delivered-To:\s*//I' 2>/dev/null)
if [ -z "$RECIPIENT" ]; then
  RECIPIENT=$(echo "$EMAIL_HEADERS" | grep -i "^X-Forwarded-To:" | tail -n1 | sed -e 's/^X-Forwarded-To:\s*//I' 2>/dev/null)
fi
if [ -z "$RECIPIENT" ]; then
  RECIPIENT=$(echo "$EMAIL_HEADERS" | grep -i "^Envelope-To:" | tail -n1 | sed -e 's/^Envelope-To:\s*//I' 2>/dev/null)
fi
if [ -z "$RECIPIENT" ]; then
  RECIPIENT=$(echo "$EMAIL_HEADERS" | grep -i "^To:" | head -n1 | sed -e 's/^To:\s*//I' 2>/dev/null)
fi
[ -z "$RECIPIENT" ] && RECIPIENT="unknown@recipient.local"

# Normalize separators
RECIPIENT=$(echo "$RECIPIENT" | sed 's/[;[:space:]]\+/,/g')

# Prioritize autopulsemail.com addresses
if [[ "$RECIPIENT" == *","* ]]; then
  ORIGINAL_RECIPIENTS="$RECIPIENT"
  IFS=',' read -ra TEMP_RECIPIENTS <<< "$RECIPIENT"
  AUTOPULSE_RECIPIENT=""
  for temp_rec in "${TEMP_RECIPIENTS[@]}"; do
    temp_rec_clean=$(echo "$temp_rec" | xargs | tr -d '<>' | grep -oE '[^[:space:]]+@[^[:space:]]+' 2>/dev/null)
    if [[ "$temp_rec_clean" =~ autopulsemail\.com$ ]]; then
      AUTOPULSE_RECIPIENT="$temp_rec_clean"
      break
    fi
  done
  if [ -n "$AUTOPULSE_RECIPIENT" ]; then
    echo "[PRIORITY] Using autopulsemail recipient: $AUTOPULSE_RECIPIENT" >> "$LOGFILE"
    RECIPIENT="$AUTOPULSE_RECIPIENT"
  fi
fi

RECIPIENT=$(echo "$RECIPIENT" | xargs | tr -d '<>')
echo "Final recipient: $RECIPIENT" >> "$LOGFILE"

# Extract body
EMAIL_BODY=$(echo "$EMAIL_CONTENT" | sed -n '/^$/,$p' | sed '1d' 2>/dev/null || echo "$EMAIL_CONTENT")

# Extract HTML part if multipart
BOUNDARY=$(echo "$EMAIL_HEADERS" | grep -i "boundary=" | sed -E 's/.*boundary="?([^";[:space:]]+)"?/\1/I' 2>/dev/null)
if echo "$EMAIL_HEADERS" | grep -qi "multipart" 2>/dev/null && [ -n "$BOUNDARY" ]; then
  HTML_PART=$(echo "$EMAIL_BODY" | awk -v RS="--$BOUNDARY" '/Content-Type: text\/html/{found=1} found && /<\/html>/ {print; exit}' 2>/dev/null || echo "")
  if [ -n "$HTML_PART" ]; then
    EMAIL_BODY="$HTML_PART"
  fi
fi

# Decode quoted-printable
if [[ "$ENCODING" == "quoted-printable" ]]; then
  EMAIL_BODY=$(echo "$EMAIL_BODY" | perl -MMIME::QuotedPrint -ne 'print decode_qp($_)' 2>/dev/null || echo "$EMAIL_BODY")
fi

# Clean encodings and HTML entities
EMAIL_BODY=$(echo "$EMAIL_BODY" \
  | sed 's/=3D/=/g' 2>/dev/null \
  | sed 's/=\r//g' 2>/dev/null \
  | sed 's/=\n//g' 2>/dev/null \
  | sed 's/&#8217;/'"'"'/g' 2>/dev/null \
  | sed 's/&quot;/\"/g' 2>/dev/null \
  | sed 's/&lt;/</g' 2>/dev/null \
  | sed 's/&gt;/>/g' 2>/dev/null \
  | sed 's/&amp;/\&/g' 2>/dev/null || echo "$EMAIL_BODY")

echo "Final body size: ${#EMAIL_BODY} chars" >> "$LOGFILE"

# -------------------------------------------------------
# EXTRACT ATTACHMENTS AND UPLOAD TO S3
# -------------------------------------------------------
ATTACHMENTS_JSON="[]"
TEMP_EMAIL="$TEMP_DIR/email.eml"
echo "$EMAIL_CONTENT" > "$TEMP_EMAIL" 2>/dev/null || true

if command -v munpack >/dev/null 2>&1; then
  echo "[DEBUG] munpack available, extracting attachments" >> "$LOGFILE"
  (
    cd "$TEMP_DIR" 2>/dev/null || exit 0
    munpack -q "$TEMP_EMAIL" 2>/dev/null || true
  )
  
  # Find attachments (exclude munpack metadata)
  ATTACHMENT_FILES=()
  while IFS= read -r -d '' file; do
    filename=$(basename "$file")
    [ "$file" = "$TEMP_EMAIL" ] && continue
    [ "$filename" = "tempdesc.txt" ] && continue
    [ "$filename" = "email.eml" ] && continue
    [ -f "$file" ] && ATTACHMENT_FILES+=("$file")
  done < <(find "$TEMP_DIR" -type f -print0 2>/dev/null)
  
  echo "Found ${#ATTACHMENT_FILES[@]} attachment(s)" >> "$LOGFILE"
  
  # Upload each attachment to S3
  AWS_CMD="/usr/local/bin/aws"
  if [ ${#ATTACHMENT_FILES[@]} -gt 0 ] && [ -f "$AWS_CMD" ] && [ -x "$AWS_CMD" ]; then
    ATTACHMENTS_ARRAY=()
    
    for attachment_file in "${ATTACHMENT_FILES[@]}"; do
      filename=$(basename "$attachment_file")
      filesize=$(stat -f%z "$attachment_file" 2>/dev/null || stat -c%s "$attachment_file" 2>/dev/null || echo "0")
      
      # Skip files larger than 25MB
      MAX_SIZE=$((25 * 1024 * 1024))
      if [ "$filesize" -gt "$MAX_SIZE" ]; then
        echo "[WARN] Attachment $filename too large (${filesize} bytes), skipping" >> "$LOGFILE"
        continue
      fi
      
      # Generate S3 key (using timestamp-based directory, no MESSAGE_ID)
      timestamp=$(date +%s%N)
      sanitized_filename=$(echo "$filename" | sed 's/[^a-zA-Z0-9._-]/_/g')
      s3_key="email-attachments/${timestamp}_${sanitized_filename}"
      
      # Detect content type
      content_type="application/octet-stream"
      case "${filename##*.}" in
        jpg|jpeg) content_type="image/jpeg" ;;
        png) content_type="image/png" ;;
        gif) content_type="image/gif" ;;
        webp) content_type="image/webp" ;;
        pdf) content_type="application/pdf" ;;
        txt) content_type="text/plain" ;;
        html) content_type="text/html" ;;
        doc) content_type="application/msword" ;;
        docx) content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document" ;;
        xls) content_type="application/vnd.ms-excel" ;;
        xlsx) content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ;;
      esac
      
      echo "[INFO] Uploading $filename to S3..." >> "$LOGFILE"
      
      # Upload to S3
      if "$AWS_CMD" s3 cp "$attachment_file" "s3://${AWS_S3_BUCKET}/${s3_key}" \
          --content-type "$content_type" \
          --region "${AWS_REGION}" \
          2>>"$LOGFILE"; then
        
        # Generate public URL
        s3_url="https://${AWS_S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${s3_key}"
        
        echo "[SUCCESS] Uploaded: $filename -> $s3_url" >> "$LOGFILE"
        
        # Add to attachments array
        ATTACHMENTS_ARRAY+=("$(jq -n \
          --arg filename "$filename" \
          --arg size "$filesize" \
          --arg contentType "$content_type" \
          --arg url "$s3_url" \
          --arg s3Key "$s3_key" \
          --arg status "processed" \
          --arg uploadedAt "$(date -Iseconds)" \
          '{
            filename: $filename,
            size: ($size | tonumber),
            contentType: $contentType,
            url: $url,
            s3Key: $s3Key,
            status: $status,
            uploadedAt: $uploadedAt
          }')")
      else
        echo "[ERROR] Failed to upload $filename to S3" >> "$LOGFILE"
        ATTACHMENTS_ARRAY+=("$(jq -n \
          --arg filename "$filename" \
          --arg size "$filesize" \
          --arg status "failed" \
          --arg error "S3 upload failed" \
          '{
            filename: $filename,
            size: ($size | tonumber),
            status: $status,
            error: $error
          }')")
      fi
    done
    
    # Convert array to JSON
    if [ ${#ATTACHMENTS_ARRAY[@]} -gt 0 ]; then
      ATTACHMENTS_JSON=$(printf '%s\n' "${ATTACHMENTS_ARRAY[@]}" | jq -s '.')
    fi
  else
    if [ ${#ATTACHMENT_FILES[@]} -gt 0 ]; then
      echo "[WARN] AWS CLI not available, cannot upload attachments" >> "$LOGFILE"
    fi
  fi
fi

# Fallback threading IDs
FIRST_MESSAGE_ID=""
LAST_MESSAGE_ID=""
PARENT_CONVERSATION=""
BASE_PARENT_ID="$MESSAGE_ID"

if [ -n "$REFERENCES" ]; then
  CLEAN_REFS=$(echo "$REFERENCES" | xargs)
  IFS=' ' read -ra REF_ARRAY <<< "$CLEAN_REFS"
  FIRST_MESSAGE_ID="${REF_ARRAY[0]}"
  LAST_MESSAGE_ID="${REF_ARRAY[-1]}"
  PARENT_CONVERSATION="${IN_REPLY_TO:-$LAST_MESSAGE_ID}"
  BASE_PARENT_ID="$FIRST_MESSAGE_ID"
elif [ -n "$IN_REPLY_TO" ]; then
  PARENT_CONVERSATION="$IN_REPLY_TO"
  LAST_MESSAGE_ID="$IN_REPLY_TO"
  BASE_PARENT_ID="$IN_REPLY_TO"
fi

# Always upload entire email as .eml file to S3
EMAIL_EML_URL=""
EMAIL_SIZE=${#EMAIL_CONTENT}

# Verify temp email file exists
if [ ! -f "$TEMP_EMAIL" ]; then
  echo "[ERROR] Temp email file not found: $TEMP_EMAIL" >> "$LOGFILE"
  echo "[ERROR] Recreating temp email file..." >> "$LOGFILE"
  echo "$EMAIL_CONTENT" > "$TEMP_EMAIL" 2>/dev/null || {
    echo "[ERROR] Failed to create temp email file" >> "$LOGFILE"
  }
fi

# Use full path to AWS CLI
AWS_CMD="/usr/local/bin/aws"
if [ -f "$AWS_CMD" ] && [ -x "$AWS_CMD" ]; then
  if [ -f "$TEMP_EMAIL" ]; then
    TEMP_EMAIL_SIZE=$(stat -f%z "$TEMP_EMAIL" 2>/dev/null || stat -c%s "$TEMP_EMAIL" 2>/dev/null || echo "0")
    echo "[INFO] Uploading email .eml to S3 (${TEMP_EMAIL_SIZE} bytes)" >> "$LOGFILE"
    
    # Generate S3 key for .eml file (using timestamp only, no MESSAGE_ID)
    timestamp=$(date +%s%N)
    s3_eml_key="email-attachments/${timestamp}_email.eml"
    
    echo "[DEBUG] S3 key: $s3_eml_key" >> "$LOGFILE"
    echo "[DEBUG] S3 bucket: $AWS_S3_BUCKET" >> "$LOGFILE"
    echo "[DEBUG] S3 region: $AWS_REGION" >> "$LOGFILE"
    
    # Upload .eml file to S3 (capture errors)
    AWS_ERROR_LOG="$TEMP_DIR/aws_eml_error.log"
    if "$AWS_CMD" s3 cp "$TEMP_EMAIL" "s3://${AWS_S3_BUCKET}/${s3_eml_key}" \
        --content-type "message/rfc822" \
        --region "${AWS_REGION}" \
        2>"$AWS_ERROR_LOG"; then
      
      EMAIL_EML_URL="https://${AWS_S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${s3_eml_key}"
      echo "[SUCCESS] Email .eml uploaded to S3: $EMAIL_EML_URL" >> "$LOGFILE"
    else
      echo "[ERROR] Failed to upload .eml to S3" >> "$LOGFILE"
      echo "[ERROR] AWS error output:" >> "$LOGFILE"
      cat "$AWS_ERROR_LOG" >> "$LOGFILE" 2>/dev/null || true
      echo "[ERROR] Temp email file exists: $([ -f "$TEMP_EMAIL" ] && echo 'yes' || echo 'no')" >> "$LOGFILE"
      echo "[ERROR] Temp email file size: $([ -f "$TEMP_EMAIL" ] && stat -f%z "$TEMP_EMAIL" 2>/dev/null || stat -c%s "$TEMP_EMAIL" 2>/dev/null || echo 'unknown')" >> "$LOGFILE"
      echo "[ERROR] AWS command: $AWS_CMD" >> "$LOGFILE"
      echo "[ERROR] HOME: $HOME" >> "$LOGFILE"
      echo "[ERROR] AWS_SHARED_CREDENTIALS_FILE: $AWS_SHARED_CREDENTIALS_FILE" >> "$LOGFILE"
      echo "[ERROR] AWS_CONFIG_FILE: $AWS_CONFIG_FILE" >> "$LOGFILE"
      echo "[ERROR] AWS credentials check:" >> "$LOGFILE"
      if [ -d "$HOME/.aws" ]; then
        ls -la "$HOME/.aws/" >> "$LOGFILE" 2>&1
        echo "[ERROR] Credentials file exists: $([ -f "$AWS_SHARED_CREDENTIALS_FILE" ] && echo 'yes' || echo 'no')" >> "$LOGFILE"
        echo "[ERROR] Config file exists: $([ -f "$AWS_CONFIG_FILE" ] && echo 'yes' || echo 'no')" >> "$LOGFILE"
      else
        echo "[ERROR] No .aws directory found at $HOME/.aws" >> "$LOGFILE"
        echo "[ERROR] Checking /var/mail/.aws..." >> "$LOGFILE"
        ls -la "/var/mail/.aws/" >> "$LOGFILE" 2>&1 || echo "[ERROR] No .aws directory at /var/mail/.aws either" >> "$LOGFILE"
      fi
    fi
    rm -f "$AWS_ERROR_LOG" 2>/dev/null || true
  else
    echo "[ERROR] Temp email file does not exist: $TEMP_EMAIL" >> "$LOGFILE"
  fi
else
  echo "[WARN] AWS CLI not found at $AWS_CMD, cannot upload .eml file" >> "$LOGFILE"
  echo "[WARN] Checking alternative locations..." >> "$LOGFILE"
  which aws >> "$LOGFILE" 2>&1 || echo "[WARN] 'aws' not in PATH" >> "$LOGFILE"
fi

# Send webhook with attachments as JSON (not file uploads!)
IFS=',' read -ra RECIPIENTS <<< "$RECIPIENT"
for REC in "${RECIPIENTS[@]}"; do
  REC_TRIMMED=$(echo "$REC" | xargs)
  
  echo "[INFO] Sending webhook for $REC_TRIMMED" >> "$LOGFILE"
  
  # Create JSON payload file (body/headers will be parsed from .eml in route.js)
  JSON_PAYLOAD_FILE="$TEMP_DIR/payload.json"
  jq -n \
    --arg sender "$SENDER" \
    --arg recipient "$REC_TRIMMED" \
    --arg subject "$SUBJECT" \
    --arg message_id "$MESSAGE_ID" \
    --arg in_reply_to "$IN_REPLY_TO" \
    --arg references "$REFERENCES" \
    --arg first_message_id "$FIRST_MESSAGE_ID" \
    --arg last_message_id "$LAST_MESSAGE_ID" \
    --arg parent_conversation "$PARENT_CONVERSATION" \
    --arg base_parent_id "$BASE_PARENT_ID" \
    --arg date "$DATE" \
    --arg eml_url "$EMAIL_EML_URL" \
    --argjson attachments "$ATTACHMENTS_JSON" \
    '{
      sender: $sender,
      recipient: $recipient,
      subject: $subject,
      message_id: $message_id,
      in_reply_to: $in_reply_to,
      references: $references,
      first_message_id: $first_message_id,
      last_message_id: $last_message_id,
      parent_conversation: $parent_conversation,
      base_parent_id: $base_parent_id,
      date: $date,
      eml_url: (if $eml_url != "" then $eml_url else null end),
      attachments: $attachments
    }' > "$JSON_PAYLOAD_FILE" 2>> "$LOGFILE"
  
  echo "[DEBUG] JSON payload created ($(stat -f%z "$JSON_PAYLOAD_FILE" 2>/dev/null || stat -c%s "$JSON_PAYLOAD_FILE" 2>/dev/null || echo "0") bytes)" >> "$LOGFILE"
  
  # Function to send webhook to an endpoint
  send_webhook() {
    local endpoint_url="$1"
    local endpoint_name="$2"
    local response_file="/tmp/curl_response_${endpoint_name}_$$.txt"
    
    echo "[INFO] Sending webhook to $endpoint_name: $endpoint_url" >> "$LOGFILE"
    
    HTTP_CODE=$(curl -X POST "$endpoint_url" \
         -H "Content-Type: application/json" \
         -w "%{http_code}" \
         -o "$response_file" \
         --max-time 30 \
         --connect-timeout 10 \
         --retry 2 \
         --retry-delay 1 \
         -d @"$JSON_PAYLOAD_FILE" 2>> "$LOGFILE")
    
    if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
      echo "[OK] $endpoint_name webhook sent successfully (HTTP $HTTP_CODE)" >> "$LOGFILE"
      cat "$response_file" >> "$LOGFILE" 2>/dev/null
    else
      echo "[ERR] $endpoint_name webhook failed (HTTP $HTTP_CODE)" >> "$LOGFILE"
      cat "$response_file" >> "$LOGFILE" 2>/dev/null
    fi
    
    rm -f "$response_file" 2>/dev/null || true
  }
  
  # Send to both production and staging endpoints
  send_webhook "https://www.autopulse.ai/api/system" "PRODUCTION"
  send_webhook "https://stage.autopulse.ai/api/system" "STAGING"
  
  rm -f "$JSON_PAYLOAD_FILE"
done

echo "=== [$(date)] Email webhook END ===" >> "$LOGFILE"
exit 0