#!/usr/bin/env node
// Runs the platform locally against the dev stack (`make dev-full`):
// the Next.js app on http://localhost:3000 and the BullMQ workers, both
// pointed at the local MongoDB / Redis containers and the AI service on :8100.
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

const aiEnv = readEnvFile(aiEnvPath);
const secret = process.env.UPSELL_SERVICE_SHARED_SECRET || aiEnv.UPSELL_SERVICE_SHARED_SECRET;
if (!secret) {
  console.error(`UPSELL_SERVICE_SHARED_SECRET not found (looked in the environment and ${aiEnvPath}).`);
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_ENV: 'development',
  MONGODB_URI: process.env.AI_DEV_MONGODB_URI || 'mongodb://localhost:27017/pulse',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  REDIS_URL: '',
  UPSELL_AGENT_API_URL: 'http://localhost:8100',
  UPSELL_SERVICE_SHARED_SECRET: secret,
  JWT_SECRET: process.env.JWT_SECRET || 'autopulse-local-dev-jwt-secret',
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || 'autopulse-local-dev-nextauth-secret',
  MAILGUN_API_KEY: 'local-dev-placeholder-never-sends',
  MAILGUN_DOMAIN: 'local-dev.invalid',
  TWILIO_ACCOUNT_SID: `AC${'0'.repeat(32)}`,
  TWILIO_AUTH_TOKEN: 'local-dev-placeholder-never-sends',
};

const N8N_TRIPWIRE_PORT = Number(process.env.AI_DEV_N8N_PORT || 3999);
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
function run(name, command, args, color) {
  // One command string: on Windows `npx` needs a shell, and passing args
  // separately with shell:true is deprecated (DEP0190).
  const child = spawn([command, ...args].join(' '), {
    cwd: root, env, shell: true, detached: process.platform !== 'win32',
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

console.log('Platform dev: web http://localhost:3000, workers, MongoDB localhost:27017/pulse, AI http://localhost:8100, '
  + `n8n tripwire http://localhost:${N8N_TRIPWIRE_PORT}/hits`);
run('web', 'npx', ['next', 'dev', '--turbopack', '-p', '3000'], '36');
run('worker', 'node', ['app/worker/worker.js'], '35');
