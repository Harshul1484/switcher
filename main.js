const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const core = require('./core');

const api = {
  list: core.list, add: core.startLogin, use: core.use, remove: core.remove, usage: core.usage,
  sessions: core.getSessions, setSessions: core.setSessions,
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
});
app.on('window-all-closed', () => app.quit());
