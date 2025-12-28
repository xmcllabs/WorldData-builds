const { app, BrowserWindow, ipcMain, nativeTheme, Menu } = require('electron');
// `electron-is-dev` can be an ES module default export in some installs.
// Normalize to a boolean so packaged app doesn't mistakenly treat the app as "dev".
const _isDevModule = require('electron-is-dev');
const isDev = typeof _isDevModule === "boolean" ? _isDevModule : Boolean(_isDevModule && _isDevModule.default);
const path = require('path');
const fs = require('fs');
const log = require('electron-log');

log.transports.file.resolvePath = () => path.join(app.getPath('userData'), 'logs', 'main.log');
log.transports.file.level = 'info';
log.info('Starting main process', { argv: process.argv });

let mainWindow;

const createWindow = async () => {
  log.info('createWindow() called', { isDev });

  // create a frameless window: the renderer will draw its own custom titlebar

  // resolve preload path and verify it is readable before creating the window
  const preloadPath = path.join(__dirname, 'preload.cjs');
  let preloadToUse = undefined;
  try {
    const realPreload = fs.realpathSync(preloadPath);
    fs.accessSync(realPreload, fs.constants.R_OK);
    preloadToUse = realPreload;
    log.info('Resolved preload path', { preloadPath: realPreload });
  } catch (err) {
    log.error('Preload script missing or unreadable', { preloadPath, err: err && err.message });
  }

  mainWindow = new BrowserWindow({
    // window title shown by the native titlebar (outer bar)
    title: 'WorldData - xmcls.com',
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    // frameless: renderer will draw the titlebar and controls
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    webPreferences: {
      preload: preloadToUse,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  // log preload path and existence for debugging (show resolved/readable path)
  try {
    log.info('Preload path', { preloadRequested: preloadPath, preloadToUse: preloadToUse, exists: preloadToUse ? fs.existsSync(preloadToUse) : false });
  } catch (err) {
    log.warn('Failed to check preload path', { err: err && err.message });
  }

  // hide the native menu bar from the window and enable auto-hide
  try {
    if (typeof mainWindow.setMenuBarVisibility === 'function') {
      mainWindow.setMenuBarVisibility(false);
      mainWindow.setAutoHideMenuBar(true);
    }
  } catch (err) {
    log.warn('Failed to hide menu bar', { err: err && err.message });
  }

  let startUrl;
  if (isDev) {
    // In dev, vite may pick a different port if 5173 is taken; probe common Vite ports.
    const http = require('http');
    const tryPorts = [5173, 5174, 5175, 5176, 5177, 5178];
    const probe = (port) => new Promise(resolve => {
      const req = http.get({ host: '127.0.0.1', port, timeout: 200 }, res => { req.destroy(); resolve(true); });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    const findPort = async () => {
      for (const p of tryPorts) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await probe(p);
        if (ok) return p;
      }
      return 5173;
    };
    try {
      const port = await findPort();
      startUrl = `http://localhost:${port}`;
    } catch (err) {
      startUrl = 'http://localhost:5173';
    }
  } else {
    // resolve index file inside the packaged asar
    const candidate = path.join(__dirname, '../dist/index.html');
    log.info('Production index candidate path', { candidate, exists: fs.existsSync(candidate) });
    startUrl = `file://${candidate}`;
  }

  try {
    log.info('Loading startUrl', { startUrl });
    await mainWindow.loadURL(startUrl);
  } catch (err) {
    log.error('Failed to loadURL', { err: err && err.message, stack: err && err.stack });
    // Show a simple error HTML so app doesn't stay blank
    const errorHtml = `
      <html><body>
        <h1>Launch error</h1>
        <pre>${String(err && err.stack || err)}</pre>
        <p>Check log file: ${app.getPath('userData')}/logs/main.log</p>
      </body></html>`;
    mainWindow.loadURL(`data:text/html,${encodeURIComponent(errorHtml)}`);
  }

  mainWindow.webContents.on('did-finish-load', () => {
    log.info('Renderer finished loading');
    // check whether preload exposed the expected API
    try {
      mainWindow.webContents.executeJavaScript('typeof window.electron !== "undefined"').then(present => {
        log.info('Renderer reports electron presence', { present });
      }).catch(err => {
        log.error('Failed to execute presence check', { err: err && err.message });
      });
    } catch (err) {
      log.error('Presence check threw', { err: err && err.message });
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    log.error('did-fail-load', { errorCode, errorDescription, validatedURL });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
};

app.whenReady().then(() => {
  createWindow().catch(err => {
    log.error('createWindow() threw', { err: err && err.stack });
  });

  // completely remove the default application menu (File / Edit / View / Window / Help)
  try {
    Menu.setApplicationMenu(null);
    log.info('Application menu removed');
  } catch (err) {
    log.warn('Failed to remove application menu', { err: err && err.message });
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Preload ready signal for debugging
ipcMain.on('preload-ready', () => log.info('Preload script loaded in renderer'));
// capture preload-side errors reported from the renderer
ipcMain.on('preload-error', (e, message) => log.error('Preload reported error', { message }));

// expose app version
ipcMain.handle('get-app-version', () => app.getVersion());

// allow renderer to control the frameless window
ipcMain.handle('window-minimize', () => { log.info('IPC: window-minimize'); if (mainWindow) { mainWindow.minimize(); return true; } return false; });
ipcMain.handle('window-maximize', () => { log.info('IPC: window-maximize'); if (!mainWindow) return false; if (mainWindow.isMaximized()) { mainWindow.unmaximize(); } else { mainWindow.maximize(); } return true; });
ipcMain.handle('window-close', () => { log.info('IPC: window-close'); if (mainWindow) { mainWindow.close(); return true; } return false; });
ipcMain.handle('window-is-maximized', () => { return mainWindow ? mainWindow.isMaximized() : false; });

// forward maximize/unmaximize so the renderer can update maximize/restore UI state
app.on('browser-window-created', (e, win) => {
  win.on('maximize', () => { log.info('BrowserWindow: maximized'); win.webContents.send('window-maximized'); });
  win.on('unmaximize', () => { log.info('BrowserWindow: unmaximized'); win.webContents.send('window-unmaximized'); });
});

