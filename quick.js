// Quick switcher: opened by the global shortcut. Type to filter, arrows to choose, Enter to switch, Esc to close.
const $ = (id) => document.getElementById(id);
const HINT = '↑ ↓ to choose · Enter to switch · Esc to close';
let items = [], sel = 0, best = null;
const usage = {};
const labelOf = (p) => p.label || p.name;

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

const matches = () => {
  const q = $('q').value.trim().toLowerCase();
  return items.filter((p) => !q || [p.label, p.name, p.email, p.org].some((s) => s && s.toLowerCase().includes(q)));
};

function render() {
  const list = matches();
  sel = Math.min(sel, Math.max(0, list.length - 1));
  $('results').replaceChildren(...list.map((p, i) => {
    const u = usage[p.name];
    return el('li', {
      id: `opt-${i}`, role: 'option', className: i === sel ? 'sel' : '', ariaSelected: String(i === sel),
      onclick: () => pick(p), onmouseenter: () => { if (sel !== i) { sel = i; render(); } },
    },
    el('span', { className: `dot ${p.color || 'none'}`, ariaHidden: 'true' }),
    el('div', { className: 'who' }, labelOf(p), el('small', { textContent: [p.email, p.org].filter(Boolean).join(' · ') })),
    u ? el('span', { className: 'mini', textContent: `Session ${Math.round(u.session.pct)}% · Week ${Math.round(u.week.pct)}%` }) : '',
    p.active ? el('span', { className: 'badge', textContent: 'Active' })
      : p.name === best ? el('span', { className: 'badge best', textContent: 'Most left' }) : '');
  }));
  if (!list.length) $('results').append(el('li', { className: 'empty', textContent: items.length ? 'No matching account' : 'No accounts yet' }));
  $('q').setAttribute('aria-activedescendant', list.length ? `opt-${sel}` : '');
  $('results').querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}

async function pick(p) {
  try {
    if (!p.active) await window.call('use', p.name);
    window.call('hideQuick');
  } catch (e) {
    $('foot').textContent = String(e.message).replace(/^Error invoking remote method 'call': \w+: /, '');
  }
}

async function load() {
  $('foot').textContent = HINT;
  $('q').value = '';
  $('q').focus();
  try { items = (await window.call('list')).profiles.filter((p) => p.ready); } catch { items = []; }
  sel = Math.max(0, items.findIndex((p) => !p.active)); // start on the first account you'd switch to
  render();
  for (const p of items) { // cached by core: no extra requests to Anthropic
    try { usage[p.name] = await window.call('usage', p.name); } catch {}
  }
  try { best = await window.call('best'); } catch {}
  render();
}

$('q').oninput = () => { sel = 0; render(); };
document.onkeydown = (e) => {
  const list = matches();
  if (e.key === 'Escape') window.call('hideQuick');
  else if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, list.length - 1); render(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
  else if (e.key === 'Enter' && list[sel]) pick(list[sel]);
};
window.onEvent('quick-open', load);
load();
