const { app, BrowserWindow, ipcMain } = require('electron');
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

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  let startUrl;
  if (isDev) {
    startUrl = 'http://localhost:5173';
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

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// expose app version
ipcMain.handle('get-app-version', () => app.getVersion());

