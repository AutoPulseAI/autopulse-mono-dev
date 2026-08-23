#!/bin/bash

# Script to create CSV processing directories
# Run this on the server to set up the required directories

echo "Creating CSV processing directories..."

# Create the main CSV directory structure
mkdir -p /var/www/html/aidmvcs-be/public/csv/dealersocket/upload
mkdir -p /var/www/html/aidmvcs-be/public/csv/dealersocket/processed
mkdir -p /var/www/html/aidmvcs-be/public/csv/dealersocket/failed
mkdir -p /var/www/html/aidmvcs-be/public/csv/dealersocket/temp

# Set appropriate permissions
chmod 755 /var/www/html/aidmvcs-be/public/csv/dealersocket/upload
chmod 755 /var/www/html/aidmvcs-be/public/csv/dealersocket/processed
chmod 755 /var/www/html/aidmvcs-be/public/csv/dealersocket/failed
chmod 755 /var/www/html/aidmvcs-be/public/csv/dealersocket/temp

# Set ownership to the web server user (adjust as needed)
chown -R www-data:www-data /var/www/html/aidmvcs-be/public/csv/

echo "CSV directories created successfully!"
echo "Directories:"
ls -la /var/www/html/aidmvcs-be/public/csv/dealersocket/
