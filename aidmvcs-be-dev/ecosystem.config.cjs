// ecosystem.config.cjs
// Rename to .cjs if using "type": "module" in package.json
module.exports = {
  apps: [
    {
      name: 'aidmvcs-be',        // Next.js server
      script: 'npm',
      args: 'start',
      cwd: '/var/www/html/aidmvcs-be',
      env: {
        NODE_ENV: 'production',
        // any other env vars (OR rely on .env.production)
      },
      out_file: '/var/www/html/aidmvcs-be/logs/aidmvcs-be-out.log',
      error_file: '/var/www/html/aidmvcs-be/logs/aidmvcs-be-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm Z',
    },
    {
      name: 'aidmvcs-worker',    // background worker
      script: 'worker.js',
      cwd: '/var/www/html/aidmvcs-be/app/worker',
      env: {
        NODE_ENV: 'production',
        // include REDIS_PASSWORD etc.
      },
      out_file: '/var/www/html/aidmvcs-be/logs/aidmvcs-worker-out.log',
      error_file: '/var/www/html/aidmvcs-be/logs/aidmvcs-worker-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm Z'
    }
  ]
};
