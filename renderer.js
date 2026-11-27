const $ = (id) => document.getElementById(id);
const MAC = navigator.userAgent.includes('Mac');
const mod = MAC ? 'Cmd' : 'Ctrl';
const COLORS = ['coral', 'amber', 'green', 'teal', 'stone']; // same as core.LABEL_COLORS
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
let settings = {};
let best = null; // account with the most usage left
let openMenu = null, editing = null, draft = '', dragName = null;
const labelOf = (p) => p.label || p.name;

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

const button = (label, onclick, className = '') => el('button', { type: 'button', textContent: label, onclick, className });

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
      el('small', { textContent: `Updated ${asOf}` }),
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

// --- the ⋯ menu: rename, pin, colour, order, remove ---
function cardMenu(p, i) {
  const item = (text, onclick, disabled = false, cls = '') => el('button', {
    type: 'button', className: `menu-item ${cls}`, textContent: text, disabled, role: 'menuitem',
    onclick: (e) => { e.stopPropagation(); onclick(); },
  });
  const sameGroup = (j) => data.profiles[j] && data.profiles[j].pinned === p.pinned; // order moves within pinned / unpinned
  return el('div', { className: 'menu', role: 'menu', ariaLabel: `Actions for ${labelOf(p)}`, onclick: (e) => e.stopPropagation() },
    item('Rename', () => { editing = p.name; draft = labelOf(p); openMenu = null; render(); }),
    item(p.pinned ? 'Unpin' : 'Pin to top', () => meta({ name: p.name, pinned: !p.pinned })),
    el('div', { className: 'swatches', role: 'group', ariaLabel: 'Colour label' },
      ...['', ...COLORS].map((c) => el('button', {
        type: 'button', className: `swatch ${c || 'none'}${(p.color || '') === c ? ' on' : ''}`,
        title: c ? `${c[0].toUpperCase()}${c.slice(1)}` : 'No colour', ariaLabel: c ? `${c} label` : 'No colour label',
        ariaPressed: String((p.color || '') === c),
        onclick: (e) => { e.stopPropagation(); meta({ name: p.name, color: c }); },
      }))),
    item('Move up', () => move(i, -1), !sameGroup(i - 1)),
    item('Move down', () => move(i, 1), !sameGroup(i + 1)),
    item('Remove', () => remove(p.name), false, 'danger'));
}

async function meta(m) {
  openMenu = null;
  await run('meta', m);
  refresh();
}

async function reorderTo(names) {
  await run('reorder', names);
  refresh();
}

function move(i, dir) {
  const names = data.profiles.map((x) => x.name);
  [names[i], names[i + dir]] = [names[i + dir], names[i]];
  openMenu = null;
  reorderTo(names);
}

async function saveRename(p) {
  if (editing !== p.name) return;
  editing = null;
  await run('meta', { name: p.name, label: draft });
  refresh();
}

function card(p, i) {
  const plan = usage[p.name]?.data?.plan;
  const title = editing === p.name
    ? el('input', {
      id: 'rename', className: 'rename', value: draft, maxLength: 40, ariaLabel: `Name for ${p.name}`,
      oninput: (e) => (draft = e.target.value),
      onkeydown: (e) => { if (e.key === 'Enter') saveRename(p); if (e.key === 'Escape') { editing = null; render(); } },
      onblur: () => saveRename(p),
    })
    : labelOf(p);
  const info = el('div', {},
    p.color ? el('span', { className: `dot ${p.color}`, ariaHidden: 'true' }) : '', title,
    plan ? el('span', { className: 'plan', textContent: plan }) : '',
    p.pinned ? el('span', { className: 'plan', textContent: 'pinned' }) : '',
    el('small', { textContent: p.ready ? [p.email, p.org].filter(Boolean).join(' · ') : 'Waiting for login in the terminal window...' }));
  const more = button('⋯', (e) => { e.stopPropagation(); openMenu = openMenu === p.name ? null : p.name; render(); }, 'link more');
  more.ariaLabel = `More actions for ${labelOf(p)}`;
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', String(openMenu === p.name));
  const li = el('li', { draggable: !editing },
    el('div', { className: 'row' }, info,
      p.name === best && !p.active ? el('span', { className: 'badge best', textContent: 'Most left' }) : '',
      p.active ? el('span', { className: 'badge', textContent: 'Active' }) : p.ready ? button('Use', () => use(p.name)) : '',
      more, openMenu === p.name ? cardMenu(p, i) : ''),
    p.ready ? usageBlock(p.name) : '',
    p.ready ? managerLine(p.name) : '');
  // Drag to reorder (within pinned / unpinned).
  li.ondragstart = (e) => { dragName = p.name; e.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); };
  li.ondragend = () => { dragName = null; render(); };
  li.ondragover = (e) => {
    const from = data.profiles.find((x) => x.name === dragName);
    if (from && from.name !== p.name && from.pinned === p.pinned) { e.preventDefault(); li.classList.add('drop'); }
  };
  li.ondragleave = () => li.classList.remove('drop');
  li.ondrop = (e) => {
    e.preventDefault();
    const names = data.profiles.map((x) => x.name), from = names.indexOf(dragName);
    dragName = null;
    names.splice(from, 1);
    names.splice(i, 0, data.profiles[from].name);
    reorderTo(names);
  };
  return li;
}

function render() {
  if (dragName) return; // rebuilding the list would cancel the drag
  const act = data.profiles.find((p) => p.active);
  $('active').textContent = data.activeEmail
    ? `Active: ${act ? labelOf(act) : 'not saved in Switcher'} (${data.activeEmail})`
    : 'Active: not logged in';
  $('list').replaceChildren(...data.profiles.map(card));
  const input = $('rename');
  if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
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

let updateTimer;
async function loadUpdate() {
  const u = await run('update');
  if (u === false) return;
  const down = u.state === 'downloading';
  const pct = Math.round(u.percent || 0);
  $('update').replaceChildren(
    down ? `Downloading ${u.version} · ${pct}%` : `Version ${u.current}`,
    down ? el('progress', { max: 100, value: pct, ariaLabel: `Downloading version ${u.version}` }) : '',
    u.state === 'ready' ? button(`Update ${u.version}`, () => run('installUpdate'), 'primary') : '');
  clearTimeout(updateTimer);
  if (down) updateTimer = setTimeout(loadUpdate, 1000); // follow the download closely, then back to the 30s poll
}

async function saveSessions() {
  const s = await run('setSessions', { autoStart: $('autoStart').checked, message: $('message').value });
  if (s !== false) { sessions = s; render(); }
}
$('autoStart').onchange = saveSessions;
$('message').onchange = saveSessions;

// --- settings: start at login, notifications, quick switcher shortcut ---
const prettyKey = (acc) => (acc
  ? acc.split('+').map((k) => ({ CommandOrControl: mod, Control: 'Ctrl', Alt: MAC ? 'Option' : 'Alt' }[k] || k)).join(' + ')
  : 'Off');
const KEYS = {
  Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
};
const codeKey = (c) => (/^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5) : /^F\d{1,2}$/.test(c) ? c : KEYS[c]);

function showSettings() {
  $('startAtLogin').checked = settings.startAtLogin;
  $('startAtLogin').disabled = !settings.loginSupported;
  $('notify').checked = settings.notify;
  if (document.activeElement !== $('shortcut')) $('shortcut').value = prettyKey(settings.shortcut);
}

async function loadSettings() {
  try { settings = await window.call('settings'); showSettings(); } catch {}
  $('loginHint').textContent = settings.loginSupported === false ? 'Works in the installed app.' : '';
}

const SHORTCUT_HINT = $('settingsHint').textContent;
const shortcutHint = (text = SHORTCUT_HINT, err = false) => { $('settingsHint').textContent = text; $('settingsHint').classList.toggle('err', err); };
async function saveSettings(patch) {
  try {
    settings = await window.call('setSettings', patch);
    shortcutHint();
  } catch (e) {
    shortcutHint(clean(e), true);
  }
  showSettings();
}
$('startAtLogin').onchange = () => saveSettings({ startAtLogin: $('startAtLogin').checked });
$('notify').onchange = () => saveSettings({ notify: $('notify').checked });
$('clearShortcut').onclick = () => saveSettings({ shortcut: '' });
$('shortcut').onfocus = () => { $('shortcut').value = 'Press a key combination...'; };
$('shortcut').onblur = showSettings;
$('shortcut').onkeydown = (e) => {
  if (e.key === 'Tab') return; // keep keyboard navigation
  e.preventDefault();
  if (e.key === 'Escape') return $('shortcut').blur();
  const key = codeKey(e.code);
  if (!key) return; // only a modifier so far
  const mods = [(MAC ? e.metaKey : e.ctrlKey) && 'CommandOrControl', MAC && e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
  if (!mods.some((m) => m !== 'Shift')) return shortcutHint(`Include ${mod} or ${MAC ? 'Option' : 'Alt'} in the shortcut.`, true);
  saveSettings({ shortcut: [...mods, key].join('+') }).then(() => $('shortcut').blur());
};

// --- settings dialog: sections on the left, like Claude's ---
const dialog = $('settingsDialog');
function showPane(id) {
  for (const b of document.querySelectorAll('.nav-item')) {
    const on = b.dataset.pane === id;
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    $(b.dataset.pane).hidden = !on;
  }
}
function openSettings() {
  if (dialog.open) return;
  dialog.showModal();
  document.querySelector('.nav-item[aria-current]').focus(); // start on the section, not the close button
}
for (const b of document.querySelectorAll('.nav-item')) b.onclick = () => showPane(b.dataset.pane);
$('openSettings').onclick = openSettings;
$('closeSettings').onclick = () => dialog.close();
dialog.onclick = (e) => { if (e.target === dialog) dialog.close(); }; // a click on the backdrop
dialog.oncancel = (e) => { if (document.activeElement === $('shortcut')) { e.preventDefault(); $('shortcut').blur(); } }; // Esc while recording cancels only that
$('settingsKey').textContent = `${mod}+,`;
document.addEventListener('keydown', (e) => { if (e.key === ',' && (MAC ? e.metaKey : e.ctrlKey)) { e.preventDefault(); openSettings(); } });

async function refresh() {
  const d = await run('list');
  if (d === false) return;
  data = d;
  render();
  loadUsage();
}

async function loadBest() {
  try { best = await window.call('best'); } catch { best = null; }
  render();
}

// One account at a time; each result renders as soon as it arrives.
async function loadUsage(force = false) {
  if (loadingUsage) return;
  loadingUsage = true;
  for (const { name } of data.profiles.filter((p) => p.ready)) {
    if (!force && usage[name] && Date.now() - usage[name].at < 10 * 60e3) continue; // core also enforces this gap
    try { usage[name] = { at: Date.now(), data: await window.call('usage', name) }; }
    catch (e) { const { kind, text } = parseError(e); usage[name] = { at: Date.now(), error: text, kind }; }
    render();
  }
  loadingUsage = false;
  loadBest();
}

async function use(name) {
  const r = await run('use', name);
  if (r === false) return;
  const p = data.profiles.find((x) => x.name === name);
  say(`Now using ${p ? labelOf(p) : name}. Reload VS Code to apply.`);
  refresh();
}

// Linux has no standard terminal app, so also show the sign-in command for running by hand.
const LINUX = navigator.userAgent.includes('Linux');
const orRunIt = (r) => (LINUX && r?.manual ? `\nNo terminal? Run: ${r.manual}` : '');

// Offline: just try again. Expired: sign that account in again (the card waits for the new login).
async function reconnect(name, kind) {
  if (kind === 'Expired') {
    const r = await run('relogin', name);
    if (r === false) return;
    say(`Sign in to ${name} again in the terminal that opened.${orRunIt(r)}`);
  } else if ((await run('retryUsage', name)) === false) return;
  delete usage[name];
  refresh();
}

async function remove(name) {
  openMenu = null;
  const p = data.profiles.find((x) => x.name === name);
  if (!confirm(`Remove "${p ? labelOf(p) : name}"? Its saved login is deleted from this computer.`)) return render();
  await run('remove', name);
  delete usage[name];
  refresh();
}

$('add').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('name').value.trim();
  const r = await run('add', name);
  if (r !== false) {
    $('name').value = '';
    say(`Sign in to ${name} in the terminal that opened.${orRunIt(r)}`);
  }
  refresh();
};

// Close the ⋯ menu on an outside click or Escape.
document.addEventListener('click', () => { if (openMenu) { openMenu = null; render(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openMenu) { openMenu = null; render(); } });

window.onEvent('changed', () => { refresh(); loadSettings(); }); // switched from the tray or quick switcher
setInterval(() => data.profiles.some((p) => !p.ready) && refresh(), 3000);
setInterval(render, 60e3); // keep "Resets in ..." countdowns current
setInterval(() => loadUsage(true), 5 * 60e3);
setInterval(() => { loadSessions(); loadUpdate(); }, 30e3);
window.addEventListener('focus', refresh);
refresh();
loadSessions();
loadUpdate();
loadSettings();
