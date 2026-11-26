const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const core = require('./core');

let update = {}; // { state: 'downloading' | 'ready', version }
const api = {
  list: core.list, add: core.startLogin, use: core.use, remove: core.remove, usage: core.usage,
  sessions: core.getSessions, setSessions: core.setSessions,
  update: () => ({ current: app.getVersion(), ...update }),
  installUpdate: () => autoUpdater.quitAndInstall(true, true), // silent install, then relaunch
};
ipcMain.handle('call', (_e, fn, arg) => {
  if (!Object.hasOwn(api, fn)) throw new Error(`Unknown call ${fn}`);
  return api[fn](arg);
});

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1080, height: 700, minWidth: 420, minHeight: 480, autoHideMenuBar: true, title: 'Switcher',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#181715' : '#faf9f5',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile('index.html');
  core.keepSessions();
  setInterval(core.keepSessions, 5 * 60e3);

  // Updates come from GitHub Releases (latest.yml); a downloaded update also installs on quit.
  if (!app.isPackaged) return;
  autoUpdater.on('update-available', (i) => (update = { state: 'downloading', version: i.version }));
  autoUpdater.on('update-downloaded', (i) => (update = { state: 'ready', version: i.version }));
  autoUpdater.on('error', () => { if (update.state !== 'ready') update = {}; }); // offline: retry next round
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 3600e3);
});
app.on('window-all-closed', () => app.quit());
