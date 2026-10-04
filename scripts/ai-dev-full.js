#!/usr/bin/env node
// Runs the platform locally against the dev stack, in one of two modes:
//
// `make dev-full` (no flag): the Next.js app on http://localhost:3000 and the
// BullMQ workers, pointed at the local MongoDB (localhost:27018/pulse) / Redis
// (localhost:6380) containers and the AI service containers on :8100.
//
// `make crm-local` (--crm-local, MASTER_PLAN_4 stream C1): the whole CRM with
// its own AI service, without touching the shared AI containers or anyone
// else's data:
//   - CRM web  http://localhost:3100   (CRM_LOCAL_WEB_PORT)
//   - CRM BullMQ workers                (Redis localhost:6380, db 4: its own queues)
//   - AI API   http://localhost:8110   (CRM_LOCAL_AI_PORT) + AI worker, run from
//     ../agentic-upsell source with uv, Redis db 5, queue ai-turns-crm-local,
//     CHANNEL_DRIVER=platform (the CRM sends every AI message) and
//     PLATFORM_CLIENT=live (360, inventory, bookings through the CRM's APIs)
//   - MongoDB  localhost:27018/autopulse_local (CRM_LOCAL_MONGODB_URI)
//   - provider sends stubbed (PROVIDER_SEND_STUB): nothing real leaves
// Seed it first (`make crm-seed`; crm-local seeds automatically when empty).
//
// Connection settings are passed as environment variables, which take
// precedence over any .env / .env.local (dotenv never overrides them), so
// this can't accidentally talk to a real database. The shared secret is read
// from ../agentic-upsell/.env so both sides always agree.
//
// Mailgun and Twilio get PLACEHOLDER credentials, always (the workers build
// both clients when they load). A local run must never send a real SMS or
// email through the platform; the AI service uses its fake channel driver.
//
// n8n is never reachable from a local run either: every N8N_* URL points at a
// small "tripwire" server started here, which records each call and answers
// like a minimal n8n (a canned reply marked "local n8n stand-in"), so an off /
// shadow dealer's lead goes through the platform's normal path. The
// end-to-end check reads GET /hits to prove a live dealer's lead never reached
// n8n (Stage 11) and that a shadow dealer's did (Stage 13).
//
// Ctrl+C stops both processes.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const aiEnvPath = path.resolve(root, '../agentic-upsell/.env');

function readEnvFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
    }));
}

const CRM_LOCAL = process.argv.includes('--crm-local');
export const LOCAL_DEV_SECRET = 'autopulse-local-dev-shared-secret';

const aiEnv = readEnvFile(aiEnvPath);
// crm-local runs its own AI service, so it can use a fixed local secret.
const secret = process.env.UPSELL_SERVICE_SHARED_SECRET || (CRM_LOCAL ? LOCAL_DEV_SECRET
  : aiEnv.UPSELL_SERVICE_SHARED_SECRET);
if (!secret) {
  console.error(`UPSELL_SERVICE_SHARED_SECRET not found (looked in the environment and ${aiEnvPath}).`);
  process.exit(1);
}

const config = CRM_LOCAL ? {
  mongodbUri: process.env.CRM_LOCAL_MONGODB_URI || 'mongodb://localhost:27018/autopulse_local',
  redisPort: process.env.CRM_LOCAL_REDIS_PORT || '6380',
  redisDb: process.env.CRM_LOCAL_REDIS_DB || '4',
  webPort: process.env.CRM_LOCAL_WEB_PORT || '3100',
  aiPort: process.env.CRM_LOCAL_AI_PORT || '8110',
  aiRedisUrl: process.env.CRM_LOCAL_AI_REDIS_URL || 'redis://localhost:6380/5',
  n8nPort: process.env.AI_DEV_N8N_PORT || '3998',
} : {
  mongodbUri: process.env.AI_DEV_MONGODB_URI || 'mongodb://localhost:27018/pulse',
  redisPort: process.env.AI_DEV_REDIS_PORT || '6380',
  redisDb: '0',
  webPort: process.env.AI_DEV_WEB_PORT || '3000',
  aiPort: '8100',
  n8nPort: process.env.AI_DEV_N8N_PORT || '3999',
};

const env = {
  ...process.env,
  NODE_ENV: 'development',
  MONGODB_URI: config.mongodbUri,
  REDIS_HOST: 'localhost',
  REDIS_PORT: config.redisPort,
  REDIS_DB: config.redisDb,
  REDIS_URL: '',
  UPSELL_AGENT_API_URL: `http://localhost:${config.aiPort}`,
  UPSELL_SERVICE_SHARED_SECRET: secret,
  JWT_SECRET: process.env.JWT_SECRET || 'autopulse-local-dev-jwt-secret',
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || 'autopulse-local-dev-nextauth-secret',
  MAILGUN_API_KEY: 'local-dev-placeholder-never-sends',
  MAILGUN_DOMAIN: 'local-dev.invalid',
  TWILIO_ACCOUNT_SID: `AC${'0'.repeat(32)}`,
  TWILIO_AUTH_TOKEN: 'local-dev-placeholder-never-sends',
  // sendSMS / sendEmail / account mails never reach a provider (app/lib/providerStub.js).
  PROVIDER_SEND_STUB: 'true',
  NEXT_PUBLIC_BASE_URL: `http://localhost:${config.webPort}`,
};

// The AI service for crm-local, from source (never the shared containers).
const aiServiceEnv = {
  ...process.env,
  ENVIRONMENT: 'DEV',
  PYTHONPATH: path.resolve(root, '../agentic-upsell/src'),
  MONGODB_URI: config.mongodbUri,
  REDIS_URL: config.aiRedisUrl,
  QUEUE_NAME: process.env.CRM_LOCAL_AI_QUEUE || 'ai-turns-crm-local',
  AUTOPULSE_API_BASE_URL: `http://localhost:${config.webPort}`,
  UPSELL_SERVICE_SHARED_SECRET: secret,
  CHANNEL_DRIVER: 'platform',
  PLATFORM_CLIENT: 'live',
  MODEL_EXTRACT: process.env.AI_MODEL_EXTRACT || 'offline',
  MODEL_COMPOSE: process.env.AI_MODEL_COMPOSE || 'offline',
  FIRST_REPLY_MODE: process.env.AI_FIRST_REPLY_MODE || 'ai',
  PUBLIC_BASE_URL: '',
  PYDANTIC_AI_NO_BANNER: '1',
  // Never spend paid Vehicle Databases credits from the local stack (scenarios/e2e/seed run many leads).
  VEHICLE_DATABASES_ENABLED: process.env.CRM_LOCAL_VEHICLE_DATABASES_ENABLED || 'false',
  // The morning / afternoon send-time split (stream L) puts a lead's Day 2-90 touches at 10:00 or 15:00 by
  // chance; the scenarios, the cadence check and a demo need the same time every run. CRM_LOCAL_SEND_TIME_AB=true
  // turns it on here.
  SEND_TIME_AB: process.env.CRM_LOCAL_SEND_TIME_AB || 'false',
};

const N8N_TRIPWIRE_PORT = Number(config.n8nPort);
const n8nBase = `http://localhost:${N8N_TRIPWIRE_PORT}/n8n`;
Object.assign(env, {
  N8N_SMS_API: `${n8nBase}/sms`,
  N8N_EMAIL_API: `${n8nBase}/email`,
  N8N_LEAD_API: `${n8nBase}/lead`,
  N8N_WRITE_WITH_AI_API: `${n8nBase}/write-with-ai`,
});

const n8nHits = [];
const tripwire = http.createServer((req, res) => {
  if (req.url === '/hits') {
    if (req.method === 'DELETE') n8nHits.length = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(n8nHits));
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    n8nHits.push({ at: new Date().toISOString(), path: req.url, body: body.slice(0, 20_000) });
    console.log(`\x1b[33m[n8n-tripwire]\x1b[0m ${req.method} ${req.url} (${n8nHits.length} call(s) so far)`);
    // The fields the lead / SMS / email workers read from n8n's answer.
    const reply = 'Thanks for reaching out! A member of our team will be in touch shortly. (local n8n stand-in)';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      response: reply, Response: reply, response_mode: req.url.includes('email') ? 'email' : 'sms',
      create_lead: false, new_message: false, user_language: 'english', subject: 'Re: your inquiry',
    }));
  });
});
tripwire.listen(N8N_TRIPWIRE_PORT);

const children = [];
function run(name, command, args, color, { cwd = root, env: childEnv = env } = {}) {
  // One command string: on Windows `npx` needs a shell, and passing args
  // separately with shell:true is deprecated (DEP0190).
  const child = spawn([command, ...args].join(' '), {
    cwd, env: childEnv, shell: true, detached: process.platform !== 'win32',
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

// With shell:true the child is a shell; killing it alone would orphan `next`
// (on Windows especially), leaving port 3000 taken for the next run.
function killTree(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
}

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) killTree(child);
  tripwire.close();
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log(`Platform dev${CRM_LOCAL ? ' (crm-local)' : ''}: web http://localhost:${config.webPort}, workers, `
  + `MongoDB ${config.mongodbUri}, Redis localhost:${config.redisPort} db ${config.redisDb}, `
  + `AI http://localhost:${config.aiPort}, n8n tripwire http://localhost:${N8N_TRIPWIRE_PORT}/hits`);
if (CRM_LOCAL) {
  // Demo data the first time (scripts/seed-local-crm.js); `make crm-seed` starts over.
  const seeded = spawnSync('node', ['scripts/seed-local-crm.js', '--if-missing'], { cwd: root, env, stdio: 'inherit' });
  if (seeded.status !== 0) {
    console.error('Seeding the local CRM failed (is MongoDB up on localhost:27018? `make ai-up`).');
    process.exit(1);
  }
  console.log('Login: http://localhost:' + config.webPort + '/dealer  demo-dealer@autopulse.local / AutopulseDemo#1 '
    + '(the OTP is printed below by [web] as "[provider-stub]" and returned by the login call)');
  const aiDir = path.resolve(root, '../agentic-upsell');
  run('ai-api', 'uv', ['run', '--frozen', 'uvicorn', 'upsell_agent.main:app', '--host', '127.0.0.1', '--port',
    config.aiPort], '32', { cwd: aiDir, env: aiServiceEnv });
  run('ai-worker', 'uv', ['run', '--frozen', 'saq', 'upsell_agent.worker.main.settings'], '33',
    { cwd: aiDir, env: aiServiceEnv });
}
run('web', 'npx', ['next', 'dev', '--turbopack', '-p', config.webPort], '36');
run('worker', 'node', ['app/worker/worker.js'], '35');
