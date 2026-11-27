const { app, BrowserWindow, ipcMain, nativeTheme, shell, Tray, Menu, nativeImage, Notification, globalShortcut, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('./core');

// Apps started from the macOS Dock/Finder or a Linux app menu don't get the login shell's PATH, so `claude`
// (in ~/.local/bin, Homebrew, npm's bin...) wouldn't be found. Ask the user's shell once, plus the usual install dirs.
if (process.platform !== 'win32') {
  try {
    const out = cp.execFileSync(process.env.SHELL || '/bin/sh', ['-ilc', 'echo __PATH__; printenv PATH'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    const found = out.split('__PATH__\n')[1]?.split('\n')[0].trim();
    if (found) process.env.PATH = found;
  } catch {}
  const home = os.homedir();
  process.env.PATH = [process.env.PATH, `${home}/.local/bin`, `${home}/.claude/local`, '/opt/homebrew/bin', '/usr/local/bin'].join(path.delimiter);
}

// shortcut: macOS only installs updates into apps signed with an Apple Developer ID, which these builds aren't,
// so there the Update button opens the release page; sign the mac build to use quitAndInstall there too.
const LINK_ONLY = process.platform === 'darwin';
const RELEASE_PAGE = 'https://github.com/Harshul1484/switcher/releases/tag/v';
const MAC = process.platform === 'darwin';
const preload = path.join(__dirname, 'preload.js');
// Windows and macOS take the app icon from the installed app (build/icon.ico, build/icon.icns); Linux windows and
// notifications need it passed in.
const linuxIcon = process.platform === 'linux' ? { icon: path.join(__dirname, 'assets', 'icon.png') } : {};
const bg = () => (nativeTheme.shouldUseDarkColors ? '#181715' : '#faf9f5');
const labelOf = (p) => p.label || p.name;
const pretty = (acc) => acc.split('+').map((k) => ({ CommandOrControl: MAC ? 'Cmd' : 'Ctrl', Alt: MAC ? 'Option' : 'Alt' }[k] || k)).join('+');

let win, quick, tray, trayPop, trayClosedAt = 0, quitting = false;
let update = {}; // { state: 'downloading' | 'ready', version }

// --- windows ---
function createWindow(show) {
  win = new BrowserWindow({
    width: 1080, height: 700, minWidth: 420, minHeight: 480, show, autoHideMenuBar: true, title: 'Switcher',
    backgroundColor: bg(), webPreferences: { preload }, ...linuxIcon,
  });
  win.loadFile('index.html');
  // Closing hides to the tray, so the session manager and notifications keep running. Quit is in the tray menu.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!MAC && !core.getSettings().trayHintShown) {
      notify('Switcher is still running in the tray. Use Quit there to close it.');
      core.setSettings({ trayHintShown: true });
    }
  });
}

function showWindow() {
  quick?.hide();
  trayPop?.hide();
  if (!win || win.isDestroyed()) return createWindow(true);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function openQuick() {
  if (!quick || quick.isDestroyed()) {
    quick = new BrowserWindow({
      width: 560, height: 440, show: false, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
      fullscreenable: false, backgroundColor: bg(), webPreferences: { preload },
    });
    quick.loadFile('quick.html');
    quick.on('blur', () => quick.hide());
  }
  if (MAC) app.focus({ steal: true }); // a background app can't take focus otherwise
  quick.center();
  quick.show();
  quick.focus();
  quick.webContents.send('quick-open');
}

// Tray popup (Windows, macOS): every account with a session ring and a weekly bar, which a native menu can't draw.
function openTrayPopup() {
  if (Date.now() - trayClosedAt < 300) return; // this click is the one that just closed it
  if (!trayPop || trayPop.isDestroyed()) {
    trayPop = new BrowserWindow({
      width: 340, height: 460, show: false, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
      fullscreenable: false, backgroundColor: bg(), webPreferences: { preload },
    });
    trayPop.loadFile('tray.html');
    trayPop.on('blur', () => { trayPop.hide(); trayClosedAt = Date.now(); });
  }
  placeTrayPopup();
  if (MAC) app.focus({ steal: true });
  trayPop.show();
  trayPop.focus();
  trayPop.webContents.send('tray-open');
}
// Next to the tray icon: above it for a bottom taskbar, below it for the macOS menu bar; kept on screen.
function placeTrayPopup() {
  let b = tray.getBounds();
  if (!b.width) { const p = screen.getCursorScreenPoint(); b = { x: p.x, y: p.y, width: 0, height: 0 }; }
  const area = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
  const [w, h] = trayPop.getSize();
  const below = b.y < area.y + area.height / 2;
  const x = b.x + b.width / 2 - w / 2, y = below ? b.y + b.height + 6 : b.y - h - 6;
  const clamp = (v, lo, hi) => Math.round(Math.min(Math.max(v, lo), hi));
  trayPop.setPosition(clamp(x, area.x + 8, area.x + area.width - w - 8), clamp(y, area.y + 8, area.y + area.height - h - 8));
}

// Something changed (switch, label, settings): refresh every window and the tray menu.
function changed() {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('changed');
  rebuildTray();
}

// --- notifications ---
const showing = new Set(); // keep them referenced, or their click handler can be garbage-collected
function notify(body) {
  if (!core.getSettings().notify || !Notification.isSupported()) return;
  const n = new Notification({ title: 'Switcher', body, ...linuxIcon });
  showing.add(n);
  n.on('click', showWindow);
  n.on('close', () => showing.delete(n));
  n.show();
}

async function useAccount(name) {
  const r = await core.use(name);
  changed();
  if (!win?.isFocused()) {
    const p = core.list().profiles.find((x) => x.name === name);
    notify(`Now using ${p ? labelOf(p) : name}. Reload VS Code so Claude Code picks it up.`);
  }
  return r;
}

// Every 5 minutes: compare each account's usage with the last reading and announce crossed thresholds.
// core.usage serves its cache, so this asks Anthropic at most every 10 minutes per account.
const lastUsage = {};
const expiredSeen = new Set();
async function watchUsage() {
  let profiles = [];
  try { profiles = core.list().profiles.filter((p) => p.ready); } catch { return; }
  for (const p of profiles) {
    try {
      const u = await core.usage(p.name);
      expiredSeen.delete(p.name);
      for (const a of core.usageAlerts(labelOf(p), lastUsage[p.name], u)) {
        const best = p.active && (a.kind === 'sessionFull' || a.kind === 'weekFull') && core.bestAccount();
        const bestP = best && best !== p.name && profiles.find((x) => x.name === best);
        notify(a.text + (bestP ? ` Most left: ${labelOf(bestP)}.` : ''));
      }
      lastUsage[p.name] = u;
    } catch (e) {
      if (e.name === 'Expired' && !expiredSeen.has(p.name)) {
        expiredSeen.add(p.name);
        notify(`The login for ${labelOf(p)} has expired. Open Switcher to reconnect.`);
      }
    }
  }
  rebuildTray();
}

// --- tray / menu bar ---
function trayIcon() {
  const dir = path.join(__dirname, 'assets');
  if (MAC) {
    const i = nativeImage.createFromPath(path.join(dir, 'trayTemplate.png')); // macOS tints template images itself
    i.setTemplateImage(true);
    return i;
  }
  return nativeImage.createFromPath(path.join(dir, process.platform === 'win32' ? 'tray.png' : 'tray@2x.png'));
}

function rebuildTray() {
  if (!tray) return;
  let profiles = [], best = null;
  try { profiles = core.list().profiles.filter((p) => p.ready); best = core.bestAccount(); } catch {}
  const s = core.getSettings();
  const active = profiles.find((p) => p.active);
  const usageText = (u) => (u ? `${Math.round(u.session.pct)}% session · ${Math.round(u.week.pct)}% week` : '');
  const au = active && usageText(lastUsage[active.name]);
  tray.setToolTip(active ? `Switcher · ${labelOf(active)}${au ? ` · ${au}` : ''}` : 'Switcher');
  // Windows and macOS open the popup; Linux trays (AppIndicator) only show a menu, so usage goes in its labels.
  if (process.platform !== 'linux') return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: profiles.length ? 'Use account' : 'No accounts yet', enabled: false },
    ...profiles.map((p) => ({
      label: labelOf(p) + (lastUsage[p.name] ? `   ${usageText(lastUsage[p.name])}` : '') + (p.name === best && !p.active ? '  (most left)' : ''),
      type: 'radio', checked: p.active,
      click: () => useAccount(p.name).catch((e) => { notify(e.message); rebuildTray(); }),
    })),
    { type: 'separator' },
    { label: s.shortcut ? `Quick switcher    ${pretty(s.shortcut)}` : 'Quick switcher', click: openQuick },
    { label: 'Open Switcher', click: showWindow },
    { type: 'separator' },
    { label: 'Start at login', type: 'checkbox', checked: s.startAtLogin, enabled: app.isPackaged,
      click: (i) => applySettings({ startAtLogin: i.checked }).catch(rebuildTray) },
    { label: 'Quit Switcher', click: () => { quitting = true; app.quit(); } },
  ]));
}

// --- settings that touch the OS: global shortcut, start at login ---
function registerShortcut(acc) {
  globalShortcut.unregisterAll();
  if (!acc) return true;
  try { return globalShortcut.register(acc, openQuick); } catch { return false; }
}

function setLoginItem(on) {
  if (!app.isPackaged) return; // a dev run would register the bare Electron binary
  if (process.platform === 'linux') {
    const f = path.join(os.homedir(), '.config', 'autostart', 'switcher.desktop');
    if (!on) return fs.rmSync(f, { force: true });
    fs.mkdirSync(path.dirname(f), { recursive: true });
    // An AppImage runs from a temporary mount, so point at the .AppImage file itself.
    fs.writeFileSync(f, `[Desktop Entry]\nType=Application\nName=Switcher\nExec="${process.env.APPIMAGE || process.execPath}" --hidden\nX-GNOME-Autostart-enabled=true\n`);
    return;
  }
  app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
}

const settingsForUI = () => ({ ...core.getSettings(), loginSupported: app.isPackaged });
async function applySettings(patch) {
  const prev = core.getSettings();
  const next = core.setSettings(patch); // validates
  if (next.shortcut !== prev.shortcut && !registerShortcut(next.shortcut)) {
    core.setSettings({ shortcut: prev.shortcut });
    registerShortcut(prev.shortcut);
    throw new Error(`${pretty(next.shortcut)} is already used by another app. Try a different shortcut.`);
  }
  if (next.startAtLogin !== prev.startAtLogin) setLoginItem(next.startAtLogin);
  rebuildTray();
  return settingsForUI();
}

// --- IPC: the only functions the windows can call ---
const api = {
  list: core.list, add: core.startLogin, use: useAccount, relogin: core.relogin, usage: core.usage, retryUsage: core.retryUsage,
  remove: async (name) => { await core.remove(name); changed(); },
  meta: (m) => { core.setAccountMeta(m); changed(); },
  reorder: (order) => { core.reorder(order); changed(); },
  best: core.bestAccount,
  sessions: core.getSessions, setSessions: core.setSessions,
  settings: settingsForUI, setSettings: applySettings,
  hideQuick: () => quick?.hide(),
  openQuick: () => { trayPop?.hide(); openQuick(); },
  hideTray: () => trayPop?.hide(),
  fitTray: (h) => { if (!trayPop || !Number.isFinite(h)) return; trayPop.setSize(340, Math.round(Math.min(Math.max(h, 120), 640))); placeTrayPopup(); },
  quit: () => { quitting = true; app.quit(); },
  showMain: showWindow,
  update: () => ({ current: app.getVersion(), ...update }),
  installUpdate: () => (LINK_ONLY ? shell.openExternal(RELEASE_PAGE + update.version) : autoUpdater.quitAndInstall(true, true)), // silent install, then relaunch
};
ipcMain.handle('call', (_e, fn, arg) => {
  if (!Object.hasOwn(api, fn)) throw new Error(`Unknown call ${fn}`);
  return api[fn](arg);
});

// --- start-up ---
if (!app.requestSingleInstanceLock()) app.quit(); // already running: the first copy shows its window instead
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('local.switcher.app'); // Windows files notifications under this ID
    // Launched by "Start at login": stay in the tray.
    const hidden = process.argv.includes('--hidden') || (MAC && app.getLoginItemSettings().wasOpenedAtLogin);
    createWindow(!hidden);
    tray = new Tray(trayIcon());
    if (process.platform === 'win32') tray.on('click', showWindow); // left click opens; right click shows the popup
    if (process.platform !== 'linux') tray.on('right-click', openTrayPopup);
    if (MAC) tray.on('click', openTrayPopup);
    const s = core.getSettings();
    registerShortcut(s.shortcut);
    setLoginItem(s.startAtLogin); // re-applied each start, so the path stays right after updates
    rebuildTray();
    setInterval(rebuildTray, 60e3); // picks up accounts added in the main window
    core.keepSessions();
    setInterval(core.keepSessions, 5 * 60e3);
    watchUsage();
    setInterval(watchUsage, 5 * 60e3);
    app.on('activate', showWindow); // macOS: clicking the Dock icon

    // Updates come from GitHub Releases (latest.yml / latest-mac.yml / latest-linux.yml); a downloaded update also installs on quit.
    if (!app.isPackaged) return;
    autoUpdater.autoDownload = !LINK_ONLY;
    autoUpdater.on('update-available', (i) => {
      update = LINK_ONLY ? { state: 'ready', version: i.version } : { state: 'downloading', version: i.version, percent: 0 };
      if (LINK_ONLY) notify(`Switcher ${i.version} is available. Open Switcher to download it.`);
    });
    autoUpdater.on('download-progress', (p) => (update = { ...update, state: 'downloading', percent: p.percent }));
    autoUpdater.on('update-downloaded', (i) => {
      update = { state: 'ready', version: i.version };
      notify(`Switcher ${i.version} is ready. Open Switcher and click Update, or it installs when you quit.`);
    });
    autoUpdater.on('error', () => { if (update.state !== 'ready') update = {}; }); // offline: retry next round
    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    check();
    setInterval(check, 4 * 3600e3);
  });
}
app.on('before-quit', () => { quitting = true; }); // also covers Cmd+Q and quitAndInstall
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (!MAC) app.quit(); });
