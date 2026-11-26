// Runs against a fake home dir and a fake network; never touches real credentials. File storage only (skipped on macOS).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'switcher-test-'));
process.env.HOME = process.env.USERPROFILE = home;
const core = require('./core');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const fileOnly = { skip: process.platform === 'darwin' };
const j = (f) => JSON.parse(fs.readFileSync(path.join(home, f), 'utf8'));
const put = (f, o) => { fs.mkdirSync(path.dirname(path.join(home, f)), { recursive: true }); fs.writeFileSync(path.join(home, f), JSON.stringify(o)); };
const oauth = (id, token, extra = {}) => ({ accountUuid: id, organizationUuid: 'org', accessToken: token, refreshToken: token, ...extra });

test('switch swaps only the account, keeps MCP logins, backs up, syncs rotated tokens', fileOnly, async () => {
  put('.claude-profiles/a/.credentials.json', { claudeAiOauth: oauth('A', 'a-old') });
  put('.claude-profiles/a/.claude.json', { oauthAccount: { emailAddress: 'a@x' } });
  put('.claude-profiles/b/.credentials.json', { claudeAiOauth: oauth('B', 'b1') });
  put('.claude-profiles/b/.claude.json', { oauthAccount: { emailAddress: 'b@x' } });
  fs.mkdirSync(path.join(home, '.claude-profiles/pending'));
  // A is active and its token has rotated since it was saved
  put('.claude/.credentials.json', { claudeAiOauth: oauth('A', 'a-new'), mcpOAuth: { srv: 1 } });
  put('.claude.json', { oauthAccount: { emailAddress: 'a@x' }, projects: { p: 1 } });

  const l = core.list();
  assert.equal(l.activeEmail, 'a@x');
  assert.deepEqual(l.profiles.map((p) => [p.name, p.ready, p.active]), [['a', true, true], ['b', true, false], ['pending', false, false]]);

  const { backupDir } = await core.use('b');
  assert.equal(j('.claude/.credentials.json').claudeAiOauth.accessToken, 'b1');
  assert.deepEqual(j('.claude/.credentials.json').mcpOAuth, { srv: 1 });
  assert.deepEqual(j('.claude.json'), { oauthAccount: { emailAddress: 'b@x' }, projects: { p: 1 } });
  assert.equal(j('.claude-profiles/a/.credentials.json').claudeAiOauth.accessToken, 'a-new');
  assert.equal(JSON.parse(fs.readFileSync(path.join(backupDir, '.credentials.json'))).claudeAiOauth.accessToken, 'a-new');
  assert.ok(fs.existsSync(path.join(backupDir, '.claude.json')));
  assert.equal(core.list().profiles.find((p) => p.active).name, 'b');
});

test('refuses to write when current credentials are unreadable', fileOnly, async () => {
  fs.writeFileSync(path.join(home, '.claude/.credentials.json'), 'garbage');
  await assert.rejects(core.use('a'), /not plain JSON/);
  assert.equal(fs.readFileSync(path.join(home, '.claude/.credentials.json'), 'utf8'), 'garbage');
});

test('rejects unsafe names and unknown profiles', async () => {
  for (const bad of ['../x', '..', '.hidden', 'trailing.', 'a/b', 'a\\b', 'nul', 'COM1.txt', 'x'.repeat(65), '']) {
    await assert.rejects(core.use(bad), /Name must be/, bad);
  }
  await assert.rejects(core.remove('..'), /Name must be/);
  // Emails and the old allowed names pass validation (and then fail only because no such profile exists).
  for (const ok of ['nope', 'harshul@example.in', 'first.last+work@mail.co', '_legacy', 'my-account_2']) {
    await assert.rejects(core.use(ok), /no saved login/, ok);
  }
});

test('usage refreshes an expired inactive login and saves the new tokens; never refreshes the active one', fileOnly, async () => {
  put('.claude/.credentials.json', { claudeAiOauth: oauth('B', 'b-live', { expiresAt: 0 }) });
  put('.claude.json', { cachedUsageUtilization: { accountUuid: 'B', utilization: { five_hour: { utilization: 7, resets_at: null }, seven_day: { utilization: 3, resets_at: '2030-01-01T00:00:00Z' } } } });
  put('.claude-profiles/b/.credentials.json', { claudeAiOauth: oauth('B', 'b1', { expiresAt: 0 }) });
  put('.claude-profiles/c/.credentials.json', { claudeAiOauth: oauth('C', 'c-old', { expiresAt: 0, scopes: ['user:inference', 'user:profile'], subscriptionType: 'pro' }) });
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('/oauth/token')) return new Response(JSON.stringify({ access_token: 'c-new', refresh_token: 'c-new-r', expires_in: 3600 }));
    return new Response(JSON.stringify({ five_hour: { utilization: 42, resets_at: '2030-01-01T05:00:00Z' }, seven_day: { utilization: 12, resets_at: '2030-01-04T09:30:00Z' } }));
  };

  assert.deepEqual(await core.usage('c'), { plan: 'pro', session: { pct: 42, resetsAt: '2030-01-01T05:00:00Z' }, week: { pct: 12, resetsAt: '2030-01-04T09:30:00Z' } });
  assert.equal(calls[0].url, 'https://platform.claude.com/v1/oauth/token');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { grant_type: 'refresh_token', refresh_token: 'c-old', client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e', scope: 'user:inference user:profile' });
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer c-new');
  const saved = j('.claude-profiles/c/.credentials.json').claudeAiOauth;
  assert.equal(saved.refreshToken, 'c-new-r');
  assert.ok(saved.expiresAt > Date.now());

  calls.length = 0;
  assert.deepEqual((await core.usage('b')).session, { pct: 7, resetsAt: null });
  assert.equal(calls.length, 0, 'active login must not be refreshed or used while expired');
  assert.equal(j('.claude-profiles/b/.credentials.json').claudeAiOauth.refreshToken, 'b1');
});

test('session manager starts a window only where none is running, active account from the default location', fileOnly, async () => {
  const { PassThrough } = require('stream');
  const EventEmitter = require('events');
  const spawns = [];
  require('child_process').spawn = (cmd, args, opts) => {
    if (!Array.isArray(args)) { opts = args; [cmd, ...args] = cmd.split(' '); } // Windows: one shell command string
    const p = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    let input = '';
    p.stdin.on('data', (d) => (input += d));
    p.stdin.on('finish', () => { spawns.push({ cmd, args, dir: opts.env.CLAUDE_CONFIG_DIR, input }); setImmediate(() => p.emit('close', 0)); });
    return p;
  };
  fs.rmSync(path.join(home, '.claude-profiles'), { recursive: true, force: true });
  const live = { expiresAt: Date.now() + 36e5 };
  put('.claude/.credentials.json', { claudeAiOauth: oauth('B', 'b-live', { expiresAt: 0 }) }); // active, expired: uses cached usage
  put('.claude.json', { cachedUsageUtilization: { accountUuid: 'B', utilization: { five_hour: { utilization: 0, resets_at: null } } } });
  put('.claude-profiles/b/.credentials.json', { claudeAiOauth: oauth('B', 'b1', live) });
  put('.claude-profiles/c/.credentials.json', { claudeAiOauth: oauth('C', 'c-tok', live) });
  put('.claude-profiles/e/.credentials.json', { claudeAiOauth: oauth('E', 'e-tok', live) });
  global.fetch = async (_url, opts) => new Response(JSON.stringify({
    five_hour: { utilization: 5, resets_at: opts.headers.Authorization === 'Bearer c-tok' ? new Date(Date.now() + 36e5).toISOString() : null },
  }));

  assert.equal(core.setSessions({ autoStart: false, message: '   ' }).message, 'hi');
  put('.claude-profiles/.switcher.json', { autoStart: true, message: 'start please' });
  await core.keepSessions();

  assert.deepEqual(spawns.map((s) => s.dir), [undefined, path.join(home, '.claude-profiles', 'e')]);
  assert.ok(spawns.every((s) => s.cmd === 'claude' && s.input === 'start please' && s.args.includes('haiku')));
  assert.deepEqual(Object.keys(core.getSessions().status).sort(), ['b', 'e']);
  assert.ok(!core.getSessions().status.b.error);

  await core.keepSessions(); // cool-down: no second start
  assert.equal(spawns.length, 2);
});

test('usage asks at most every 5 minutes and backs off on HTTP 429, keeping the last numbers', fileOnly, async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  put('.claude-profiles/r/.credentials.json', { claudeAiOauth: oauth('R', 'r-tok', { expiresAt: Date.now() + 864e5 }) });
  put('.claude-profiles/q/.credentials.json', { claudeAiOauth: oauth('Q', 'q-tok', { expiresAt: Date.now() + 864e5 }) });
  let calls = 0, status = 200;
  global.fetch = async () => {
    calls++;
    return status === 200
      ? new Response(JSON.stringify({ five_hour: { utilization: 30, resets_at: null } }))
      : new Response('{}', { status, headers: { 'retry-after': '120' } });
  };

  assert.equal((await core.usage('r')).session.pct, 30);
  await core.usage('r');
  assert.equal(calls, 1, 'within 5 minutes the last answer is reused');

  t.mock.timers.tick(5 * 60e3);
  status = 429;
  const stale = await core.usage('r');
  assert.equal(calls, 2);
  assert.equal(stale.session.pct, 30, 'a 429 keeps the last numbers');
  assert.ok(stale.stale);

  t.mock.timers.tick(60e3);
  await core.usage('r');
  assert.equal(calls, 2, 'no request while Retry-After is pending');

  t.mock.timers.tick(61e3);
  status = 200;
  await core.usage('r');
  assert.equal(calls, 3, 'asks again once the wait is over');

  status = 429;
  await assert.rejects(core.usage('q'), (e) => e.name === 'Limited' && /limiting usage checks/.test(e.message),
    'no numbers yet: clear, typed message instead of "HTTP 429"');

  // Reconnect: forget the wait and ask right away.
  const before = calls;
  core.retryUsage('q');
  status = 200;
  assert.equal((await core.usage('q')).session.pct, 30);
  assert.equal(calls, before + 1, 'Reconnect asks immediately, even inside the Retry-After wait');
});

test('lost connection and dead logins are typed for Reconnect; relogin drops the dead login and reopens sign-in', fileOnly, async () => {
  const dir = path.join(home, '.claude-profiles', 'z');
  put('.claude-profiles/z/.credentials.json', { claudeAiOauth: oauth('Z', 'z-tok', { expiresAt: Date.now() + 864e5 }) });
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(core.usage('z'), (e) => e.name === 'Offline' && /Couldn't reach Anthropic/.test(e.message));
  global.fetch = async () => new Response('{}', { status: 401 });
  await assert.rejects(core.usage('z'), (e) => e.name === 'Expired');

  const spawned = [];
  require('child_process').spawn = (...args) => { spawned.push(args); return { unref() {} }; };
  await core.relogin('z');
  assert.ok(!fs.existsSync(path.join(dir, '.credentials.json')), 'dead login removed, card shows "waiting"');
  const launched = JSON.stringify(spawned[0]);
  assert.ok(launched.includes('claude auth login') && launched.includes(JSON.stringify(dir).slice(1, -1)), 'sign-in opened for this profile');
  await assert.rejects(core.relogin('nope'), /doesn't exist/);
});

test('a rejected refresh leaves the saved login untouched', fileOnly, async () => {
  put('.claude-profiles/d/.credentials.json', { claudeAiOauth: oauth('D', 'd-old', { expiresAt: 0 }) });
  global.fetch = async () => new Response('{}', { status: 400 });
  await assert.rejects(core.usage('d'), /Login expired/);
  assert.equal(j('.claude-profiles/d/.credentials.json').claudeAiOauth.refreshToken, 'd-old');
});
