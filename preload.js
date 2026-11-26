const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('call', (fn, arg) => ipcRenderer.invoke('call', fn, arg));
