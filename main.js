const { app, BrowserWindow, ipcMain, nativeTheme, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const cp = require('child_process');
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

let update = {}; // { state: 'downloading' | 'ready', version }
const api = {
  list: core.list, add: core.startLogin, use: core.use, remove: core.remove, relogin: core.relogin, usage: core.usage, retryUsage: core.retryUsage,
  sessions: core.getSessions, setSessions: core.setSessions,
  update: () => ({ current: app.getVersion(), ...update }),
  installUpdate: () => (LINK_ONLY ? shell.openExternal(RELEASE_PAGE + update.version) : autoUpdater.quitAndInstall(true, true)), // silent install, then relaunch
};
ipcMain.handle('call', (_e, fn, arg) => {
  if (!Object.hasOwn(api, fn)) throw new Error(`Unknown call ${fn}`);
  return api[fn](arg);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1080, height: 700, minWidth: 420, minHeight: 480, autoHideMenuBar: true, title: 'Switcher',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#181715' : '#faf9f5',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  core.keepSessions();
  setInterval(core.keepSessions, 5 * 60e3);
  // macOS: closing the window keeps the app (and the session manager) running; the Dock icon reopens it.
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });

  // Updates come from GitHub Releases (latest.yml / latest-mac.yml / latest-linux.yml); a downloaded update also installs on quit.
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = !LINK_ONLY;
  autoUpdater.on('update-available', (i) => (update = LINK_ONLY ? { state: 'ready', version: i.version } : { state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => (update = { ...update, state: 'downloading', percent: p.percent }));
  autoUpdater.on('update-downloaded', (i) => (update = { state: 'ready', version: i.version }));
  autoUpdater.on('error', () => { if (update.state !== 'ready') update = {}; }); // offline: retry next round
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 3600e3);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
