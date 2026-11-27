// Tray popup: every account with its current session (ring, % used in the middle) and this week (bar). Click to switch.
const $ = (id) => document.getElementById(id);
const MAC = navigator.userAgent.includes('Mac');
const labelOf = (p) => p.label || p.name;
const clean = (e) => String(e.message || e).replace(/^Error invoking remote method 'call': \w+: /, '');
let profiles = [], best = null;
const usage = {}; // name -> usage, or null when it couldn't load

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}
function svgEl(tag, attrs) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// Session ring: the arc fills clockwise from the top, red from 80%, with the % used in the middle.
function ring(u) {
  const pct = u ? Math.round(u.session.pct) : null;
  const len = 2 * Math.PI * 15;
  const s = svgEl('svg', { viewBox: '0 0 36 36', class: 'ring', 'aria-hidden': 'true' });
  s.append(svgEl('circle', { cx: 18, cy: 18, r: 15, class: 'track' }));
  if (pct) s.append(svgEl('circle', { cx: 18, cy: 18, r: 15, class: `arc${pct >= 80 ? ' high' : ''}`, 'stroke-dasharray': `${(len * Math.min(pct, 100)) / 100} ${len}` }));
  const t = svgEl('text', { x: 18, y: 18, class: 'ring-num' });
  t.textContent = pct == null ? '–' : pct;
  s.append(t);
  return s;
}

function row(p) {
  const u = usage[p.name];
  const week = u ? Math.round(u.week.pct) : null;
  const said = u ? `${labelOf(p)}: session ${Math.round(u.session.pct)}% used, this week ${week}% used` : labelOf(p);
  return el('li', {
    role: 'option', ariaSelected: String(p.active), ariaLabel: said, title: said, tabIndex: 0,
    onclick: () => pick(p),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(p); } },
  },
  ring(u),
  el('div', { className: 'who' },
    el('div', { className: 'name' }, el('span', { textContent: labelOf(p) }),
      p.active ? el('span', { className: 'badge', textContent: 'Active' })
        : p.name === best ? el('span', { className: 'badge best', textContent: 'Most left' }) : ''),
    el('div', { className: 'week' }, 'Week',
      el('progress', { max: 100, value: week ?? 0, className: week >= 80 ? 'high' : '' }),
      el('span', { textContent: week == null ? '–' : `${week}%` }))));
}

function render() {
  $('accounts').replaceChildren(...(profiles.length ? profiles.map(row) : [el('li', { className: 'empty', textContent: 'No accounts yet' })]));
  window.call('fitTray', Math.ceil(document.body.getBoundingClientRect().height)); // the content, not the window
}

async function pick(p) {
  $('err').textContent = '';
  try {
    if (!p.active) await window.call('use', p.name);
    window.call('hideTray');
  } catch (e) {
    $('err').textContent = clean(e);
    render();
  }
}

async function load() {
  try { profiles = (await window.call('list')).profiles.filter((p) => p.ready); } catch { profiles = []; }
  render();
  // Cached by core (at most one request per account every 10 minutes), so opening the popup doesn't ask Anthropic again.
  await Promise.all(profiles.map(async (p) => {
    try { usage[p.name] = await window.call('usage', p.name); } catch { usage[p.name] = null; }
  }));
  try { best = await window.call('best'); } catch {}
  render();
}

async function loadSettings() {
  try {
    const s = await window.call('settings');
    $('quickKey').textContent = s.shortcut ? s.shortcut.replace('CommandOrControl', MAC ? 'Cmd' : 'Ctrl').replace('Alt', MAC ? 'Option' : 'Alt') : '';
    $('login').checked = s.startAtLogin;
    $('login').disabled = !s.loginSupported;
  } catch {}
}

$('quick').onclick = () => window.call('openQuick');
$('open').onclick = () => window.call('showMain');
$('quit').onclick = () => window.call('quit');
$('login').onchange = () => window.call('setSettings', { startAtLogin: $('login').checked }).catch(loadSettings);
document.onkeydown = (e) => { if (e.key === 'Escape') window.call('hideTray'); };
window.onEvent('tray-open', () => { $('err').textContent = ''; load(); loadSettings(); });
window.onEvent('changed', load);
load();
loadSettings();
