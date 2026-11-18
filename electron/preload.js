const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const listener = (event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  version: require('../package.json').version,
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    toggleWindow: () => ipcRenderer.send('settings:toggleWindow'),
    captureHotkey: (on) => ipcRenderer.send('hotkey:capture', !!on)
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close')
  },
  onHotkeyRun: (callback) => on('hotkey:run', callback),
  selection: {
    start: () => ipcRenderer.invoke('lens:start'),
    onDone: (callback) => on('selection:done', callback),
    onError: (callback) => on('lens:error', callback)
  },
  lens: {
    onInit: (callback) => on('lens:init', callback),
    ready: () => ipcRenderer.send('lens:ready'),
    modal: (open) => ipcRenderer.send('lens:modal', !!open),
    onEscape: (callback) => on('lens:escape', callback),
    fail: (message) => ipcRenderer.send('lens:fail', String(message)),
    close: () => ipcRenderer.send('lens:close')
  },
  fs: {
    presets: () => ipcRenderer.invoke('fs:presets'),
    listDir: (dir) => ipcRenderer.invoke('fs:listDir', { dir }),
    mkdir: (dir, name) => ipcRenderer.invoke('fs:mkdir', { dir, name }),
    savePng: (payload) => ipcRenderer.invoke('fs:savePng', payload)
  },
  ai: {
    ensure: (model) => ipcRenderer.invoke('ai:ensure', { model }),
    infer: (payload) => ipcRenderer.invoke('ai:infer', payload),
    onEvent: (callback) => on('ai:event', callback)
  },
  onSettingsChanged: (callback) => on('settings:changed', callback)
});
