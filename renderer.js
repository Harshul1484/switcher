const $ = (id) => document.getElementById(id);
const mod = navigator.userAgent.includes('Mac') ? 'Cmd' : 'Ctrl';
// IPC errors arrive as "Error invoking remote method 'call': <Name>: <message>"; Name is Offline/Expired/Error.
function parseError(e) {
  const m = String(e.message).match(/^Error invoking remote method 'call': (\w+): ([\s\S]*)$/);
  return m ? { kind: m[1], text: m[2] } : { kind: 'Error', text: String(e.message) };
}
const clean = (e) => parseError(e).text;
let data = { activeEmail: null, profiles: [] };
const usage = {}; // name -> { at, data } | { at, error }
let loadingUsage = false;
let sessions = { autoStart: false, message: 'hi', status: {} };

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

function say(text, err = false) {
  $('msg').textContent = text;
  $('msg').className = err ? 'err' : '';
}

async function run(fn, arg) {
  try { return await window.call(fn, arg); }
  catch (e) { say(clean(e), true); return false; }
}

const button = (label, onclick, className = '') => el('button', { textContent: label, onclick, className });

// Same wording as Claude's usage panel.
function resetText(iso, weekly) {
  if (!iso) return 'Starts with your first message';
  const t = new Date(iso);
  if (weekly) return `Resets ${t.toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' })}`;
  const min = Math.max(0, Math.round((t - Date.now()) / 60e3));
  return `Resets in ${min >= 60 ? `${Math.floor(min / 60)} hr ` : ''}${min % 60} min`;
}

function meter(label, w, weekly) {
  return el('div', { className: 'meter' },
    el('div', {}, label, el('small', { textContent: resetText(w.resetsAt, weekly) })),
    el('progress', { max: 100, value: w.pct, className: w.pct >= 80 ? 'high' : '', ariaLabel: `${label} usage` }),
    el('span', { className: 'pct', textContent: `${Math.round(w.pct)}% used` }));
}

function usageBlock(name) {
  const u = usage[name];
  if (!u) return el('small', { className: 'usage', textContent: 'Loading usage...' });
  if (u.error) {
    return el('div', { className: 'usage problem' }, el('small', { className: 'err', textContent: u.error }),
      ['Offline', 'Expired', 'Limited'].includes(u.kind) ? button('Reconnect', () => reconnect(name, u.kind)) : '');
  }
  const asOf = u.data.stale && new Date(u.data.stale).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return el('div', { className: 'usage' }, meter('Current session', u.data.session, false), meter('This week', u.data.week, true),
    asOf ? el('div', { className: 'problem' },
      el('small', { textContent: `Anthropic is limiting usage checks; showing numbers from ${asOf}.` }),
      button('Reconnect', () => reconnect(name, 'Limited'))) : '');
}

function managerLine(name) {
  const st = sessions.status[name];
  if (!sessions.autoStart || !st || (st.error && st.error === usage[name]?.error)) return ''; // card already says it
  const time = new Date(st.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return st.error
    ? el('small', { className: 'manager err', textContent: `Session manager couldn't start a session (${time}): ${st.error}` })
    : el('small', { className: 'manager', textContent: `Session manager started a session at ${time}` });
}

function render() {
  $('active').textContent = data.activeEmail
    ? `Active: ${data.profiles.find((p) => p.active)?.name ?? 'not saved in Switcher'} (${data.activeEmail})`
    : 'Active: not logged in';
  $('list').replaceChildren(...data.profiles.map((p) => {
    const plan = usage[p.name]?.data?.plan;
    const info = el('div', {}, p.name, plan ? el('span', { className: 'plan', textContent: plan }) : '',
      el('small', { textContent: p.ready ? [p.email, p.org].filter(Boolean).join(' · ') : 'Waiting for login in the terminal window...' }));
    const action = p.active ? el('span', { className: 'badge', textContent: 'Active' })
      : p.ready ? button('Use', () => use(p.name)) : '';
    return el('li', {},
      el('div', { className: 'row' }, info, action, button('Remove', () => remove(p.name), 'link')),
      p.ready ? usageBlock(p.name) : '',
      p.ready ? managerLine(p.name) : '');
  }));
}

async function loadSessions() {
  const s = await run('sessions');
  if (s === false) return;
  for (const [name, st] of Object.entries(s.status)) if (usage[name] && st.at > usage[name].at) usage[name].at = 0; // refetch
  sessions = s;
  $('autoStart').checked = s.autoStart;
  if (document.activeElement !== $('message')) $('message').value = s.message;
  render();
  loadUsage();
}

async function loadUpdate() {
  const u = await run('update');
  if (u === false) return;
  const text = u.state === 'downloading' ? `Version ${u.current} · downloading ${u.version}...` : `Version ${u.current}`;
  $('update').replaceChildren(text, u.state === 'ready' ? button(`Update ${u.version}`, () => run('installUpdate'), 'primary') : '');
}

async function saveSessions() {
  const s = await run('setSessions', { autoStart: $('autoStart').checked, message: $('message').value });
  if (s !== false) { sessions = s; render(); }
}
$('autoStart').onchange = saveSessions;
$('message').onchange = saveSessions;

async function refresh() {
  const d = await run('list');
  if (d === false) return;
  data = d;
  render();
  loadUsage();
}

// One account at a time; each result renders as soon as it arrives.
async function loadUsage(force = false) {
  if (loadingUsage) return;
  loadingUsage = true;
  for (const { name } of data.profiles.filter((p) => p.ready)) {
    if (!force && usage[name] && Date.now() - usage[name].at < 5 * 60e3) continue; // core also enforces this gap
    try { usage[name] = { at: Date.now(), data: await window.call('usage', name) }; }
    catch (e) { const { kind, text } = parseError(e); usage[name] = { at: Date.now(), error: text, kind }; }
    render();
  }
  loadingUsage = false;
}

async function use(name) {
  const r = await run('use', name);
  if (r === false) return;
  say(`Switched to ${name}. Backup saved to ${r.backupDir}\n\nReload VS Code so Claude Code picks it up: ${mod}+Shift+P → "Developer: Reload Window".`);
  refresh();
}

// Offline: just try again. Expired: sign that account in again (the card waits for the new login).
async function reconnect(name, kind) {
  if (kind === 'Expired') {
    if ((await run('relogin', name)) === false) return;
    say(`Sign in to "${name}" again in the terminal window that just opened.`);
  } else if ((await run('retryUsage', name)) === false) return;
  delete usage[name];
  refresh();
}

async function remove(name) {
  if (!confirm(`Remove "${name}"? Its saved login is deleted from this computer.`)) return;
  await run('remove', name);
  delete usage[name];
  refresh();
}

$('add').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('name').value.trim();
  if ((await run('add', name)) !== false) {
    $('name').value = '';
    say(`Finish signing in to "${name}" in the terminal window that just opened.`);
  }
  refresh();
};

setInterval(() => data.profiles.some((p) => !p.ready) && refresh(), 3000);
setInterval(render, 60e3); // keep "Resets in ..." countdowns current
setInterval(() => loadUsage(true), 5 * 60e3);
setInterval(() => { loadSessions(); loadUpdate(); }, 30e3);
window.addEventListener('focus', refresh);
refresh();
loadSessions();
loadUpdate();
