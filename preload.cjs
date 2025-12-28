// Top-level preload diagnostics to capture load/start errors early
try {
  // avoid calling process.cwd() in sandboxed preload (may not be present)
  const safeCwd = (typeof process !== 'undefined' && typeof process.cwd === 'function') ? process.cwd() : undefined;
  console.log('preload starting', { cwd: safeCwd, hasDirname: (typeof __dirname !== 'undefined') });
  const { contextBridge, ipcRenderer } = require('electron');
  // Avoid requiring Node 'path' in the sandboxed preload (may not be available). Use simple string ops instead.

  const reportPreloadError = (err) => {
    try { console.error('preload error', err && (err.stack || err)); } catch (e) {}
    try { ipcRenderer && ipcRenderer.send && ipcRenderer.send('preload-error', String(err && (err.stack || err))); } catch (e) {}
  };

  try {
    contextBridge.exposeInMainWorld('electron', {
      getAppVersion: () => ipcRenderer.invoke('get-app-version'),
      // window controls for frameless window (use invoke for reliability)
      minimize: () => ipcRenderer.invoke('window-minimize'),
      maximize: () => ipcRenderer.invoke('window-maximize'),
      close: () => ipcRenderer.invoke('window-close'),
      isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
      onMaximize: (cb) => ipcRenderer.on('window-maximized', cb),
      onUnmaximize: (cb) => ipcRenderer.on('window-unmaximized', cb),
      // provide a reliable asset path resolver for packaged apps
      getAssetPath: (name) => {
        try {
          if (typeof __dirname !== 'undefined') {
            // build path without Node 'path' to avoid missing-module errors in sandbox
            const candidate = (__dirname.replace(/\\/g, '/').replace(/\/\/+$/, '')) + '/..' + '/dist/' + name;
            const normalized = candidate.replace(/\\/g, '/').replace(/\/\/+/, '/');
            return `file://${normalized}`;
          }
          // fallback for sandboxed preload: assume dist is relative to the served document
          return `./dist/${name}`;
        } catch (e) {
          return `./${name}`;
        }
      }
    });
  } catch (err) {
    reportPreloadError(err);
    throw err;
  }

  // Notify main that preload has loaded (debugging helper)
  try { ipcRenderer.send('preload-ready'); } catch (e) { reportPreloadError(e); }
  try { console.log('preload loaded and contextBridge registered'); } catch (err) { reportPreloadError(err); }
} catch (err) {
  // very top-level failure (e.g. require('electron') failed)
  try { console.error('preload top-level failure', err && (err.stack || err)); } catch (e) {}
  try { const { ipcRenderer } = require('electron'); ipcRenderer && ipcRenderer.send && ipcRenderer.send('preload-error', String(err && (err.stack || err))); } catch (e) {}
  throw err;
}
