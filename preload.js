const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('call', (fn, arg) => ipcRenderer.invoke('call', fn, arg));
// Main-process events: an account was switched or relabelled elsewhere (tray, quick switcher), or the quick switcher or tray popup opened.
contextBridge.exposeInMainWorld('onEvent', (channel, cb) => {
  if (['changed', 'quick-open', 'tray-open'].includes(channel)) ipcRenderer.on(channel, () => cb());
});
