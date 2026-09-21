import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Client } from '@run-cloud/sdk';

const apiUrl = process.env.RUN_CLOUD_API_URL ?? 'https://api.run.cloud';
const directory = process.env.RUN_CLOUD_REGISTRATION_STATE_DIR
  ? pathToFileURL(resolve(process.env.RUN_CLOUD_REGISTRATION_STATE_DIR) + '/')
  : new URL('./.credentials/', import.meta.url);
const stateFile = new URL('signup.json', directory);
await mkdir(directory, { recursive: true, mode: 0o700 });
async function save(state) { await writeFile(stateFile, JSON.stringify(state), { mode: 0o600 }); }
async function request(path, { token, body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://run.cloud', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return { data, token: response.headers.get('set-auth-token') ?? data.token };
}
async function mailbox(settings) {
  const username = process.env.RUN_CLOUD_TEST_MAILBOX;
  const passwordFile = process.env.RUN_CLOUD_TEST_MAILBOX_PASSWORD_FILE;
  if (!username || !passwordFile) throw new Error('Set RUN_CLOUD_TEST_MAILBOX and RUN_CLOUD_TEST_MAILBOX_PASSWORD_FILE');
  const password = (await readFile(passwordFile, 'utf8')).trim();
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [fileURLToPath(new URL('./mail-code.py', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume();
    child.on('error', () => reject(new Error('Unable to start IMAP reader')));
    child.on('close', code => {
      if (code !== 0) return reject(new Error('IMAP authentication or retrieval failed'));
      try { resolve(JSON.parse(output)); } catch { reject(new Error('Invalid IMAP reader response')); }
    });
    child.stdin.end(JSON.stringify({ username, password, ...settings }));
  });
}

try {
  const action = process.argv[2];
  if (action === 'start') {
    try { await readFile(stateFile); throw new Error('Signup already started; use finish or status'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mailbox({ probe: true });
    const [local, domain] = process.env.RUN_CLOUD_TEST_MAILBOX.split('@');
    const email = `${local}+runcloud-a2a-${randomUUID().slice(0, 12)}@${domain}`;
    const state = { apiUrl, email, startedAt: new Date().toISOString() };
    await save(state);
    await request('/api/auth/email-otp/send-verification-otp', { body: { email, type: 'sign-in' } });
    console.log(JSON.stringify({ step: 'signup_code_requested', freshAlias: true }));
  } else {
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    if (state.apiUrl !== apiUrl) throw new Error('API URL does not match signup');
    if (action === 'finish') {
      if (!state.sessionToken) {
        const mail = await mailbox({ recipient: state.email });
        if (!mail.code) throw new Error('Verification email not delivered yet; run finish again');
        const session = await request('/api/auth/sign-in/email-otp', {
          body: { email: state.email, otp: mail.code, name: 'Run Cloud A2A QA' },
        });
        if (!session.token) throw new Error('Sign-in returned no session token');
        state.sessionToken = session.token;
        state.userCreatedAt = session.data.user?.createdAt;
        state.freshSignup = Boolean(state.userCreatedAt && Date.parse(state.userCreatedAt) >= Date.parse(state.startedAt));
        await save(state);
      }
      if (!state.apiKey) {
        const { data } = await request('/run-cloud/api-keys', { token: state.sessionToken, body: { name: 'A2A connector proof' } });
        if (!data.apiKey?.key) throw new Error('No API key returned');
        state.apiKey = data.apiKey.key;
        state.apiKeyId = data.apiKey.id;
        await save(state);
      }
      const cloud = new Client({ apiKey: state.apiKey, apiUrl });
      const credential = await cloud.credential();
      let account = await cloud.account();
      if (!account.orgs?.length) {
        await request('/api/auth/organization/create', {
          token: state.sessionToken,
          body: { name: 'Run Cloud A2A QA', slug: `runcloud-a2a-${randomUUID()}` },
        });
        state.explicitOrganizationCreationRequired = true;
        await save(state);
        account = await cloud.account();
      }
      state.orgId = account.orgs?.find(org => ['owner', 'admin'].includes(org.role))?.id;
      if (!state.orgId || !credential.runCloud) throw new Error('New account has no authorized organization');
      await save(state);
      console.log(JSON.stringify({ freshSignup: state.freshSignup, authenticatedWithApiKey: true, organizationReady: true }));
    } else if (action === 'status') {
      if (!state.apiKey || !state.orgId) throw new Error('Signup incomplete; run finish first');
      const cloud = new Client({ apiKey: state.apiKey, apiUrl });
      const credential = await cloud.credential();
      console.log(JSON.stringify({
        freshSignup: state.freshSignup,
        authenticatedWithApiKey: credential.runCloud === true,
        organizationReady: credential.orgs?.includes(state.orgId) === true,
      }));
    } else {
      throw new Error('Usage: node signup.mjs start|finish|status');
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
