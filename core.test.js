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
  put('.claude-profiles/w/.credentials.json', { claudeAiOauth: oauth('W', 'w-tok', live) }); // weekly limit used up
  put('.claude-profiles/x/.credentials.json', { claudeAiOauth: oauth('X', 'x-tok', live) }); // 100%, but that week already reset
  const at = (ms) => new Date(Date.now() + ms).toISOString();
  const byToken = {
    'c-tok': { five_hour: { utilization: 5, resets_at: at(36e5) } }, // window running
    'w-tok': { five_hour: { utilization: 0, resets_at: null }, seven_day: { utilization: 100, resets_at: at(864e5) } },
    'x-tok': { five_hour: { utilization: 0, resets_at: null }, seven_day: { utilization: 100, resets_at: at(-6e4) } },
  };
  global.fetch = async (_url, opts) => new Response(JSON.stringify(byToken[opts.headers.Authorization.slice(7)] ?? { five_hour: { utilization: 5, resets_at: null } }));

  assert.equal(core.setSessions({ autoStart: false, message: '   ' }).message, 'hi');
  put('.claude-profiles/.switcher.json', { autoStart: true, message: 'start please' });
  await core.keepSessions();

  const dir = (n) => path.join(home, '.claude-profiles', n);
  assert.deepEqual(spawns.map((s) => s.dir), [undefined, dir('e'), dir('x')], 'skips c (window running) and w (weekly limit reached)');
  assert.ok(spawns.every((s) => s.cmd === 'claude' && s.input === 'start please' && s.args.includes('haiku')));
  assert.deepEqual(Object.keys(core.getSessions().status).sort(), ['b', 'e', 'x']);
  assert.ok(!core.getSessions().status.b.error);

  await core.keepSessions(); // cool-down: no second start
  assert.equal(spawns.length, 3);
});

test('usage asks at most every 10 minutes and backs off on HTTP 429, keeping the last numbers', fileOnly, async (t) => {
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
  assert.equal(calls, 1, 'within 10 minutes the last answer is reused');

  t.mock.timers.tick(10 * 60e3);
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

test('usage answers survive a restart, and the active account reuses Claude Code\'s own numbers', fileOnly, async () => {
  put('.claude-profiles/p/.credentials.json', { claudeAiOauth: oauth('P', 'p-tok', { expiresAt: Date.now() + 864e5 }) });
  let calls = 0;
  global.fetch = async () => { calls++; return new Response(JSON.stringify({ five_hour: { utilization: 12, resets_at: null } })); };
  await core.usage('p');
  assert.equal(calls, 1);

  // A restart (or an update install) loads a fresh copy of the code: it must not ask Anthropic again.
  delete require.cache[require.resolve('./core')];
  const restarted = require('./core');
  assert.equal((await restarted.usage('p')).session.pct, 12);
  assert.equal(calls, 1, 'answer came from the saved cache');
  const saved = fs.readFileSync(path.join(home, '.claude-profiles', '.usage-cache.json'), 'utf8');
  assert.ok(!/tok|refresh|access/i.test(saved), 'the saved cache holds usage numbers only, never tokens');

  // Active account: Claude Code's fresh numbers are reused, no request at all.
  put('.claude/.credentials.json', { claudeAiOauth: oauth('A2', 'a2-tok', { expiresAt: Date.now() + 864e5 }) });
  put('.claude.json', { cachedUsageUtilization: { accountUuid: 'A2', fetchedAtMs: Date.now(), utilization: { five_hour: { utilization: 9, resets_at: null } } } });
  put('.claude-profiles/a2/.credentials.json', { claudeAiOauth: oauth('A2', 'a2-old', { expiresAt: Date.now() + 864e5 }) });
  assert.equal((await restarted.usage('a2')).session.pct, 9);
  assert.equal(calls, 1, 'active account served from Claude Code\'s cache');
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

// --- labels, settings, best-account hint, notification triggers ---
const fresh = () => { // a clean profiles folder and a fresh copy of core (no cached readings from earlier tests)
  fs.rmSync(path.join(home, '.claude-profiles'), { recursive: true, force: true });
  delete require.cache[require.resolve('./core')];
  return require('./core');
};

test('labels, colours, pins and order show in the list, are validated, and are cleaned up on remove', fileOnly, async () => {
  const c = fresh();
  const live = { expiresAt: Date.now() + 864e5 };
  for (const [n, id] of [['alpha', 'A1'], ['beta', 'B1'], ['gamma', 'G1']]) put(`.claude-profiles/${n}/.credentials.json`, { claudeAiOauth: oauth(id, n, live) });
  put('.claude-profiles/.switcher.json', { autoStart: false, message: 'keep me' });

  c.reorder(['gamma', 'alpha', 'beta']);
  c.setAccountMeta({ name: 'beta', label: 'Work', color: 'teal', pinned: true });
  const l = c.list().profiles;
  assert.deepEqual(l.map((p) => p.name), ['beta', 'gamma', 'alpha'], 'pinned first, then the saved order');
  assert.deepEqual([l[0].label, l[0].color, l[0].pinned], ['Work', 'teal', true]);
  assert.throws(() => c.setAccountMeta({ name: 'beta', color: 'neon' }), /Unknown colour/);
  assert.throws(() => c.setAccountMeta({ name: 'nope', label: 'x' }), /doesn't exist/);

  c.setAccountMeta({ name: 'beta', label: '  ', color: '', pinned: false });
  assert.deepEqual(c.list().profiles.map((p) => [p.name, p.label, p.color, p.pinned]),
    [['gamma', '', '', false], ['alpha', '', '', false], ['beta', '', '', false]]);
  assert.equal(c.getSessions().message, 'keep me', 'label changes keep the session manager settings');

  await c.remove('alpha');
  const cfg = j('.claude-profiles/.switcher.json');
  assert.ok(!cfg.order.includes('alpha') && !cfg.accounts.alpha);
  assert.equal(cfg.message, 'keep me');
});

test('settings have defaults, are validated, and live alongside the session manager config', fileOnly, () => {
  const c = fresh();
  assert.deepEqual(c.getSettings(), { startAtLogin: false, notify: true, shortcut: 'CommandOrControl+Shift+Alt+S', trayHintShown: false });
  c.setSettings({ notify: false, shortcut: 'CommandOrControl+Alt+K' });
  assert.deepEqual([c.getSettings().notify, c.getSettings().shortcut], [false, 'CommandOrControl+Alt+K']);
  assert.throws(() => c.setSettings({ shortcut: 'Ctrl+<script>' }), /isn't valid/);
  c.setSessions({ autoStart: false, message: 'hello' });
  assert.equal(c.getSettings().notify, false, 'saving the session manager keeps the settings');
  assert.equal(c.getSessions().message, 'hello');
});

test('best-account hint: most headroom wins, ties go to the active account, needs two to compare', fileOnly, async () => {
  const c = fresh();
  const live = { expiresAt: Date.now() + 864e5 };
  put('.claude-profiles/x/.credentials.json', { claudeAiOauth: oauth('X', 'x-old', live) });
  put('.claude-profiles/y/.credentials.json', { claudeAiOauth: oauth('Y', 'y-tok', live) });
  put('.claude/.credentials.json', { claudeAiOauth: oauth('X', 'x-tok', live) }); // x is active
  put('.claude.json', {});
  const at = (ms) => new Date(Date.now() + ms).toISOString();
  const reply = {
    'x-tok': { five_hour: { utilization: 70, resets_at: at(36e5) }, seven_day: { utilization: 20, resets_at: at(864e5) } }, // 30 left
    'y-tok': { five_hour: { utilization: 0, resets_at: null }, seven_day: { utilization: 90, resets_at: at(864e5) } }, // 10 left
  };
  global.fetch = async (_url, opts) => new Response(JSON.stringify(reply[opts.headers.Authorization.slice(7)]));

  await c.usage('x');
  assert.equal(c.bestAccount(), null, 'one account: nothing to compare');
  await c.usage('y');
  assert.equal(c.bestAccount(), 'x');

  reply['y-tok'].seven_day.utilization = 70; // 30 left too: a tie goes to the active account
  c.retryUsage('y');
  await c.usage('y');
  assert.equal(c.bestAccount(), 'x');

  reply['y-tok'].seven_day.utilization = 0; // y is completely free
  c.retryUsage('y');
  await c.usage('y');
  assert.equal(c.bestAccount(), 'y');
});

test('notifications fire only when a threshold is crossed', () => {
  const r = (s, w) => ({ session: { pct: s, resetsAt: new Date(Date.now() + 65 * 60e3).toISOString() }, week: { pct: w, resetsAt: new Date(Date.now() + 864e5).toISOString() } });
  const kinds = (a, b) => core.usageAlerts('work', a, b).map((x) => x.kind);
  assert.deepEqual(kinds(undefined, r(100, 100)), [], 'no alerts for the first reading after start');
  assert.deepEqual(kinds(r(50, 70), r(60, 85)), ['week80']);
  assert.deepEqual(kinds(r(50, 85), r(60, 90)), [], 'already past 80%: no repeat');
  assert.deepEqual(kinds(r(90, 95), r(100, 100)), ['weekFull', 'sessionFull']);
  assert.deepEqual(kinds(r(100, 50), r(3, 50)), ['sessionReset']);
  assert.match(core.usageAlerts('work', r(90, 50), r(100, 50))[0].text, /^work reached its session limit\. It resets in 1 hr \d+ min\.$/);
});

test('folder accounts: the deepest folder wins, the active account and whole drives are refused, they block switching, remove cleans up', fileOnly, async () => {
  const c = fresh();
  const live = { expiresAt: Date.now() + 864e5 };
  for (const [n, id] of [['work', 'W'], ['client', 'C'], ['me', 'M']]) put(`.claude-profiles/${n}/.credentials.json`, { claudeAiOauth: oauth(id, n, live) });
  put('.claude/.credentials.json', { claudeAiOauth: oauth('M', 'me', live) }); // "me" is active
  const proj = path.join(home, 'code', 'proj'), inner = path.join(proj, 'vendor', 'sdk');
  fs.mkdirSync(inner, { recursive: true });
  const dirOf = (n) => path.join(home, '.claude-profiles', n);

  assert.equal(c.bind(proj, 'work'), proj);
  c.bind(inner, 'client');
  assert.equal(c.configDirFor(path.join(proj, 'src')), dirOf('work'));
  assert.equal(c.configDirFor(path.join(inner, 'lib')), dirOf('client'), 'the deepest folder wins');
  assert.equal(c.configDirFor(proj + '-other'), null, 'a sibling with the same prefix is not inside');
  assert.equal(c.configDirFor(home), null, 'elsewhere: the active login');
  if (process.platform === 'win32') assert.equal(c.configDirFor(proj.toUpperCase()), dirOf('work'), 'Windows paths ignore case');

  assert.throws(() => c.bind(proj, 'me'), /active account/);
  assert.throws(() => c.bind(path.parse(home).root, 'work'), /not a whole drive/);
  assert.throws(() => c.bind(path.join(home, 'missing'), 'work'), /isn't a folder/);
  assert.throws(() => c.bind('relative', 'work'), /Choose a folder/);
  await assert.rejects(c.use('work'), /Remove its folders first/, 'two live copies of one login would log each other out');
  assert.deepEqual(c.list().profiles.find((p) => p.name === 'work').folders, [proj]);

  c.bind(proj, 'client'); // a folder has one account
  assert.deepEqual(c.list().profiles.find((p) => p.name === 'work').folders, []);
  c.unbind(inner);
  assert.equal(c.configDirFor(inner), dirOf('client'), 'still inside proj');
  await c.remove('client');
  assert.equal(c.configDirFor(proj), null);
  assert.deepEqual(j('.claude-profiles/.switcher.json').projects, {});
});

test('folder accounts share your Claude Code setup, never the login or org files; removing one keeps the originals', fileOnly, async () => {
  const c = fresh();
  put('.claude-profiles/work/.credentials.json', { claudeAiOauth: oauth('W', 'w', { expiresAt: Date.now() + 864e5 }) });
  put('.claude/.credentials.json', { claudeAiOauth: oauth('M', 'me') });
  put('.claude/settings.json', { theme: 'dark' });
  put('.claude/policy-limits.json', { org: 'someone else' });
  put('.claude/projects/p/session.jsonl', { keep: true });
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'mine');
  const prof = path.join(home, '.claude-profiles', 'work');
  c.bind(fs.mkdtempSync(path.join(home, 'proj-')), 'work');

  assert.equal(fs.readFileSync(path.join(prof, 'CLAUDE.md'), 'utf8'), 'mine');
  assert.deepEqual(j('.claude-profiles/work/settings.json'), { theme: 'dark' });
  assert.ok(fs.existsSync(path.join(prof, 'projects', 'p', 'session.jsonl')), 'sessions are shared, so VS Code still lists them');
  assert.ok(!fs.existsSync(path.join(prof, 'policy-limits.json')), 'organisation files stay per account');
  assert.equal(j('.claude-profiles/work/.credentials.json').claudeAiOauth.accessToken, 'w', 'its own login is untouched');

  await c.remove('work');
  assert.ok(!fs.existsSync(prof));
  assert.deepEqual(j('.claude/projects/p/session.jsonl'), { keep: true }, 'removing the profile drops only the links');
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'), 'mine');
});

test("usage never refreshes a folder account's login (Claude Code does that in its folder)", fileOnly, async () => {
  const c = fresh();
  put('.claude-profiles/work/.credentials.json', { claudeAiOauth: oauth('W', 'w-old', { expiresAt: 0 }) });
  put('.claude/.credentials.json', { claudeAiOauth: oauth('M', 'me', { expiresAt: Date.now() + 864e5 }) });
  c.bind(fs.mkdtempSync(path.join(home, 'proj-')), 'work');
  const calls = [];
  global.fetch = async (url) => { calls.push(url); return new Response('{}'); };
  await assert.rejects(c.usage('work'), /once Claude Code runs in its folder/);
  assert.deepEqual(calls, [], 'no token refresh, no usage call with a dead token');
  assert.equal(j('.claude-profiles/work/.credentials.json').claudeAiOauth.refreshToken, 'w-old');
});

test('the shell launcher (macOS/Linux) sets CLAUDE_CONFIG_DIR only inside a folder account', { skip: process.platform !== 'linux' }, () => {
  const c = fresh();
  put('.claude-profiles/work/.credentials.json', { claudeAiOauth: oauth('W', 'w', { expiresAt: Date.now() + 864e5 }) });
  put('.claude/.credentials.json', { claudeAiOauth: oauth('M', 'me') });
  const proj = fs.mkdtempSync(path.join(home, "it's a proj-")); // a quote in the path
  fs.mkdirSync(path.join(proj, 'src'));
  c.bind(proj, 'work');
  const env = { ...process.env };
  delete env.CLAUDE_CONFIG_DIR;
  const run = (cwd) => require('child_process').execFileSync(c.launcherFile(), ['sh', '-c', 'printf %s "${CLAUDE_CONFIG_DIR:-none}"'],
    { cwd, env: { ...env, PWD: cwd }, encoding: 'utf8' });
  assert.equal(run(path.join(proj, 'src')), path.join(home, '.claude-profiles', 'work'));
  assert.equal(run(home), 'none');
});
