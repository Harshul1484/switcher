// All credential logic. Local files, (macOS) the local Keychain via `security`, and network calls only to
// Anthropic's own endpoints (usage + token refresh), each account using its own token, as Claude Code does.
//
// Where Claude Code keeps a login (verified against Claude Code 2.1.332):
//   Windows/Linux: <configDir>/.credentials.json -> { claudeAiOauth, mcpOAuth }
//   macOS:         Keychain item, service "Claude Code-credentials", account "claude-code-user" (older CLIs: $USER)
//   Account info:  ~/.claude.json -> oauthAccount   (with CLAUDE_CONFIG_DIR: <configDir>/.claude.json)
// With CLAUDE_CONFIG_DIR set, the Keychain service gets "-" + sha256(configDir).slice(0, 8) appended.
// Switching swaps only claudeAiOauth + oauthAccount, so MCP logins, settings and project history stay put.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const MAC = process.platform === 'darwin';
// Becomes a folder name: no path separators, no leading dot (hidden/reserved), no trailing dot (Windows drops it).
const NAME_RE = /^[\w-](?:[\w.@+-]{0,62}[\w@+-])?$/;
const WIN_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
// Claude Code's production OAuth config (from its 2.1.332 binary).
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage?skip_spend=1';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const KC_ACCOUNTS = ['claude-code-user', os.userInfo().username];

const root = () => path.join(os.homedir(), '.claude-profiles');
const profileDir = (name) => path.join(root(), name);
const activeCredsFile = () => path.join(os.homedir(), '.claude', '.credentials.json');
const activeConfigFile = () => path.join(os.homedir(), '.claude.json');
const keyOf = (o) => (o?.accountUuid ? `${o.accountUuid}|${o.organizationUuid}` : null);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

function parseObj(raw, what) {
  let o;
  try { o = JSON.parse(raw); } catch {}
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(`${what} is not plain JSON; nothing was changed.`);
  return o;
}

function checkName(name) {
  if (!NAME_RE.test(name || '') || WIN_RESERVED.test(name)) {
    throw new Error('Name must be 1-64 letters, numbers or . _ - @ + (an email works), not starting or ending with a dot.');
  }
}

function writeAtomic(f, data) {
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  const tmp = `${f}.switcher-${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  try { fs.renameSync(tmp, f); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}

// --- macOS Keychain ---
const serviceFor = (configDir) => 'Claude Code-credentials' +
  (configDir ? '-' + crypto.createHash('sha256').update(configDir.normalize('NFC')).digest('hex').slice(0, 8) : '');

function kcRead(service) {
  for (const account of KC_ACCOUNTS) {
    try {
      const raw = cp.execFileSync('security', ['find-generic-password', '-a', account, '-s', service, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      return { raw, account };
    } catch {} // exit 44 = no such item
  }
  return null;
}

function kcWrite(service, account, json) {
  // Hex via stdin, like Claude Code does, so the secret never appears in the process list.
  const line = `add-generic-password -U -a "${account}" -s "${service}" -X "${Buffer.from(json).toString('hex')}"\n`;
  // shortcut: `security -i` reads lines up to ~4KB; bigger blobs need Claude Code's multi-item format, which we refuse to fake.
  if (line.length > 4000) throw new Error('Credentials too large for one Keychain item; nothing was changed.');
  cp.execFileSync('security', ['-i'], { input: line, stdio: ['pipe', 'ignore', 'pipe'] });
  if (kcRead(service)?.raw !== json) throw new Error('Keychain write did not stick; restore from the latest backup if needed.');
}

// --- active login ---
function readActiveCreds() {
  if (MAC) return kcRead(serviceFor());
  const f = activeCredsFile();
  return fs.existsSync(f) ? { raw: fs.readFileSync(f, 'utf8') } : null;
}

function activeOauth() {
  try { return parseObj(readActiveCreds().raw, 'x').claudeAiOauth ?? null; } catch { return null; }
}

function writeActiveCreds(json, account) {
  if (MAC) kcWrite(serviceFor(), account || KC_ACCOUNTS[0], json);
  else writeAtomic(activeCredsFile(), json);
}

// --- profiles ---
const names = () => fs.readdirSync(root(), { withFileTypes: true })
  .filter((d) => d.isDirectory() && NAME_RE.test(d.name)).map((d) => d.name);

function loadProfile(name) {
  const dir = profileDir(name);
  const f = path.join(dir, '.credentials.json');
  if (MAC && !fs.existsSync(f)) { // the isolated login landed in the Keychain; keep a file copy in the profile
    const r = kcRead(serviceFor(dir));
    if (r && readJsonStr(r.raw)?.claudeAiOauth) writeAtomic(f, r.raw);
  }
  const oauth = readJson(f)?.claudeAiOauth;
  return oauth ? { oauth, account: readJson(path.join(dir, '.claude.json'))?.oauthAccount } : null;
}
const readJsonStr = (s) => { try { return JSON.parse(s); } catch { return null; } };

function list() {
  fs.mkdirSync(root(), { recursive: true, mode: 0o700 });
  const activeKey = keyOf(activeOauth());
  const profiles = names().map((name) => {
    const p = loadProfile(name);
    return {
      name,
      ready: !!p,
      email: p?.account?.emailAddress || '',
      org: p?.account?.organizationName || '',
      active: !!p && activeKey !== null && keyOf(p.oauth) === activeKey,
    };
  });
  const activeEmail = activeKey && (readJson(activeConfigFile())?.oauthAccount?.emailAddress || 'unknown account');
  return { activeEmail, profiles };
}

function startLogin(name) {
  checkName(name);
  if (loadProfile(name)) throw new Error(`"${name}" already exists.`);
  const dir = profileDir(name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  openTerminal(dir, 'claude auth login');
}

function openTerminal(configDir, cmd) {
  if (process.platform === 'win32') {
    // `start` opens a new console window; it inherits CLAUDE_CONFIG_DIR from env.
    cp.spawn('cmd.exe', ['/c', 'start', '"Claude login"', 'cmd', '/c', `"${cmd} & pause"`],
      { env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }, windowsVerbatimArguments: true, windowsHide: true, detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  const line = `CLAUDE_CONFIG_DIR=${q(configDir)} ${cmd}; echo; echo 'Done. You can close this window.'`;
  if (MAC) {
    cp.spawn('osascript', ['-e', `tell application "Terminal" to do script "${line.replace(/[\\"]/g, '\\$&')}"`,
      '-e', 'tell application "Terminal" to activate'], { stdio: 'ignore' });
    return;
  }
  const pick = 'if command -v x-terminal-emulator; then exec x-terminal-emulator -e sh -c "$0";' +
    ' elif command -v gnome-terminal; then exec gnome-terminal -- sh -c "$0";' +
    ' elif command -v konsole; then exec konsole -e sh -c "$0"; else exec xterm -e sh -c "$0"; fi';
  cp.spawn('sh', ['-c', pick, `${line}; read x`], { detached: true, stdio: 'ignore' }).unref();
}

function backup(rawCreds) {
  const dir = path.join(root(), '.backups', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (rawCreds != null) fs.writeFileSync(path.join(dir, '.credentials.json'), rawCreds, { mode: 0o600 });
  if (fs.existsSync(activeConfigFile())) fs.copyFileSync(activeConfigFile(), path.join(dir, '.claude.json'));
  return dir;
}

// Refresh tokens rotate, so the outgoing account's newest tokens must go back into its profile.
function syncBack(oauth) {
  const k = keyOf(oauth);
  if (!k) return;
  for (const name of names()) {
    const f = path.join(profileDir(name), '.credentials.json');
    const saved = readJson(f);
    if (keyOf(saved?.claudeAiOauth) === k) writeAtomic(f, JSON.stringify({ ...saved, claudeAiOauth: oauth }));
  }
}

function use(name) {
  checkName(name);
  if (!loadProfile(name)) throw new Error(`"${name}" has no saved login yet.`);
  const cur = readActiveCreds();
  const curCreds = cur ? parseObj(cur.raw, 'Current credentials') : {};
  if (MAC && cur && !curCreds.claudeAiOauth) throw new Error('Keychain credentials are in a format Switcher does not know; nothing was changed.');
  const config = fs.existsSync(activeConfigFile()) ? parseObj(fs.readFileSync(activeConfigFile(), 'utf8'), '~/.claude.json') : {};

  const backupDir = backup(cur?.raw);
  syncBack(curCreds.claudeAiOauth);
  const target = loadProfile(name); // re-read: syncBack may have just refreshed it
  writeActiveCreds(JSON.stringify({ ...curCreds, claudeAiOauth: target.oauth }), cur?.account);
  if (target.account) config.oauthAccount = target.account;
  else delete config.oauthAccount; // Claude Code refetches it; a stale one would show the wrong email
  writeAtomic(activeConfigFile(), JSON.stringify(config, null, 2));
  return { backupDir };
}

function kcDelete(service) {
  for (const a of KC_ACCOUNTS) {
    try { cp.execFileSync('security', ['delete-generic-password', '-a', a, '-s', service], { stdio: 'ignore' }); } catch {}
  }
}

function remove(name) {
  checkName(name);
  if (MAC) kcDelete(serviceFor(profileDir(name)));
  fs.rmSync(profileDir(name), { recursive: true, force: true });
  delete sessionStatus[name];
  delete usageCache[name];
  saveUsageCache();
}

// Sign an existing account in again. The dead login is dropped first, so the card waits for the new one.
function relogin(name) {
  checkName(name);
  const dir = profileDir(name);
  if (!fs.existsSync(dir)) throw new Error(`"${name}" doesn't exist.`);
  if (MAC) kcDelete(serviceFor(dir));
  fs.rmSync(path.join(dir, '.credentials.json'), { force: true });
  delete usageCache[name];
  saveUsageCache();
  openTerminal(dir, 'claude auth login');
}

const expired = (oauth) => oauth.expiresAt < Date.now() + 60e3;
// Typed failures: the name survives IPC ("Offline: ...", "Expired: ...") so the UI can offer the right Reconnect.
const fail = (name, message) => Object.assign(new Error(message), { name });
const EXPIRED = 'Login expired. Reconnect to sign in again.';
const call = (url, opts) => fetch(url, opts).catch(() => { throw fail('Offline', "Couldn't reach Anthropic. Check your internet connection."); });
const usageWindow = (w) => ({ pct: w?.utilization ?? 0, resetsAt: w?.resets_at ?? null });
const shapeUsage = (u, oauth) => ({ plan: oauth.subscriptionType || '', session: usageWindow(u?.five_hour), week: usageWindow(u?.seven_day) });

async function refresh(oauth) {
  const res = await call(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30e3),
    body: JSON.stringify({
      grant_type: 'refresh_token', refresh_token: oauth.refreshToken, client_id: CLIENT_ID,
      ...(oauth.scopes?.length && { scope: oauth.scopes.join(' ') }),
    }),
  });
  if (res.status === 400 || res.status === 401) throw fail('Expired', EXPIRED);
  const t = res.ok ? await res.json() : {};
  if (!t.access_token) throw new Error(`Couldn't refresh login (HTTP ${res.status}).`);
  return { ...oauth, accessToken: t.access_token, refreshToken: t.refresh_token || oauth.refreshToken, expiresAt: Date.now() + (t.expires_in || 3600) * 1000 };
}

// Anthropic rate-limits the usage endpoint per account (HTTP 429). To stay well under it: ask at most every
// 10 minutes, keep the answers on disk so restarts (and update installs) don't re-ask, reuse Claude Code's own
// numbers for the active account, and after a 429 wait as long as Anthropic says while showing the last numbers.
const USAGE_GAP = 10 * 60e3;
const usageCacheFile = () => path.join(root(), '.usage-cache.json');
const usageCache = readJson(usageCacheFile()) || {}; // name -> { data, at, retryAt } (usage numbers only, no tokens)
const saveUsageCache = () => { try { writeAtomic(usageCacheFile(), JSON.stringify(usageCache)); } catch {} };
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function staleOrThrow(c) {
  if (c.data) return { ...c.data, stale: c.at };
  throw fail('Limited', `Anthropic is limiting usage checks for this account. Next try at ${clock(c.retryAt)}.`);
}
// Reconnect for a lost connection or a rate limit: forget our wait so the next check asks Anthropic right away.
function retryUsage(name) {
  checkName(name);
  if (usageCache[name]) Object.assign(usageCache[name], { at: 0, retryAt: 0 });
  saveUsageCache();
}

async function usage(name) {
  checkName(name);
  const f = path.join(profileDir(name), '.credentials.json');
  const saved = readJson(f);
  let oauth = saved?.claudeAiOauth;
  if (!oauth) throw new Error(`"${name}" has no saved login yet.`);
  const active = activeOauth();
  const isActive = keyOf(oauth) && keyOf(active) === keyOf(oauth);
  if (isActive) {
    // Claude Code owns the active login: use its freshest token and never refresh it ourselves (that would log it out).
    // Claude Code also keeps this account's usage on disk; reuse it when fresh instead of asking Anthropic again.
    oauth = active;
    const cc = readJson(activeConfigFile())?.cachedUsageUtilization;
    const ccMine = cc?.accountUuid === oauth.accountUuid && cc.utilization;
    if (ccMine && (expired(oauth) || Date.now() - cc.fetchedAtMs < USAGE_GAP)) return shapeUsage(cc.utilization, oauth);
    if (expired(oauth)) throw new Error('Usage shows once Claude Code runs again.');
  }
  const now = Date.now();
  const c = usageCache[name];
  if (c?.data && now - c.at < USAGE_GAP) return c.data;
  if (c?.retryAt > now) return staleOrThrow(c);
  if (!isActive && expired(oauth)) {
    oauth = await refresh(oauth);
    writeAtomic(f, JSON.stringify({ ...saved, claudeAiOauth: oauth })); // the old refresh token is now dead; save at once
  }
  const res = await call(USAGE_URL, {
    headers: { Authorization: `Bearer ${oauth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
    signal: AbortSignal.timeout(15e3),
  });
  if (res.status === 401) throw fail('Expired', EXPIRED);
  if (res.status === 429) {
    usageCache[name] = { ...c, retryAt: now + (Number(res.headers.get('retry-after')) || 600) * 1000 };
    saveUsageCache();
    return staleOrThrow(usageCache[name]);
  }
  if (!res.ok) throw new Error(`Couldn't load usage (HTTP ${res.status}).`);
  const data = shapeUsage(await res.json(), oauth);
  usageCache[name] = { data, at: now };
  saveUsageCache();
  return data;
}

// --- session manager: keeps a 5-hour window running on every account ---
const configFile = () => path.join(root(), '.switcher.json');
const sessionStatus = {}; // name -> { at, error? } for the last start attempt
const getSessions = () => ({ autoStart: false, message: 'hi', ...readJson(configFile()), status: sessionStatus });

function setSessions({ autoStart, message } = {}) {
  writeAtomic(configFile(), JSON.stringify({ autoStart: !!autoStart, message: String(message ?? '').trim().slice(0, 500) || 'hi' }));
  if (autoStart) keepSessions();
  return getSessions();
}

// Smallest Claude Code run that still counts as usage: Haiku, no tools, MCP servers, plugins or user hooks.
// shell on Windows so claude.cmd (npm installs) works too; every arg is a constant and the message goes in on stdin.
const WIN = process.platform === 'win32';
const PING_ARGS = ['-p', '--model', 'haiku', '--tools', WIN ? '""' : '', '--strict-mcp-config', '--disable-slash-commands',
  '--setting-sources', 'project', '--no-session-persistence'];

function runClaude(message, env) {
  return new Promise((resolve, reject) => {
    const opts = { env, cwd: root(), shell: WIN, windowsHide: true, timeout: 120e3 };
    const p = WIN ? cp.spawn(`claude ${PING_ARGS.join(' ')}`, opts) : cp.spawn('claude', PING_ARGS, opts);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.stdout.resume();
    p.on('error', (e) => reject(e.code === 'ENOENT' ? new Error('Could not find the claude command.') : e));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`claude exited with code ${code}. ${err.trim().slice(0, 200)}`))));
    p.stdin.end(message);
  });
}

async function startSession(name) {
  const dir = profileDir(name);
  const f = path.join(dir, '.credentials.json');
  const p = loadProfile(name);
  if (!p) throw new Error(`"${name}" has no saved login yet.`);
  const active = !!keyOf(p.oauth) && keyOf(p.oauth) === keyOf(activeOauth());
  const env = { ...process.env };
  delete env.CLAUDECODE;
  // The active login lives in Claude Code's default location and only Claude Code may refresh it; others run from their profile.
  if (active) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = dir;
  if (MAC && !active) kcWrite(serviceFor(dir), KC_ACCOUNTS[0], fs.readFileSync(f, 'utf8')); // macOS Claude Code reads the Keychain first
  try {
    await runClaude(getSessions().message, env);
  } finally {
    if (MAC && !active) { const r = kcRead(serviceFor(dir)); if (readJsonStr(r?.raw)?.claudeAiOauth) writeAtomic(f, r.raw); }
  }
}

let keeping = false;
async function keepSessions() {
  if (keeping || !getSessions().autoStart || !fs.existsSync(root())) return;
  keeping = true;
  try {
    for (const name of names()) {
      // 30-min cool-down per account, so a failing or not-yet-counted start never loops.
      if (!loadProfile(name) || Date.now() - (sessionStatus[name]?.at ?? 0) < 30 * 60e3) continue;
      try {
        const { session, week } = await api.usage(name);
        if (session.resetsAt && Date.parse(session.resetsAt) > Date.now()) continue; // a window is already running
        // Weekly limit used up: a start message can't run until the week resets (unless that reset already passed).
        if (week.pct >= 100 && !(week.resetsAt && Date.parse(week.resetsAt) <= Date.now())) continue;
        await api.startSession(name);
        sessionStatus[name] = { at: Date.now() };
        if (usageCache[name]) { usageCache[name].at = 0; saveUsageCache(); } // next check shows the new window (still honours a 429 wait)
      } catch (e) {
        sessionStatus[name] = { at: Date.now(), error: e.message };
      }
    }
  } finally {
    keeping = false;
  }
}

// One token-touching operation at a time, so a refresh never races a switch copying the same profile.
let lock = Promise.resolve();
const serial = (fn) => (arg) => (lock = lock.then(() => fn(arg), () => fn(arg)));
const api = { use: serial(use), remove: serial(remove), relogin: serial(relogin), usage: serial(usage), startSession: serial(startSession) };

module.exports = { list, startLogin, ...api, retryUsage, getSessions, setSessions, keepSessions };
