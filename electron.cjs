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

// ------------------------
// Indicator management IPC
// ------------------------
const KEYTAR_SERVICE = 'com.worlddata.indicators';

const ensureDir = (dir) => {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { log.warn('ensureDir failed', { dir, err: e && e.message }); }
};

/**
 * Determine where to store downloaded indicators.
 * Preference order:
 *  - In production, attempt to store next to the installed executable (installDir/indicators) if writable
 *  - Fallback to app.getPath('userData')/indicators
 */
const getIndicatorsDir = () => {
  try {
    if (!isDev) {
      // Candidate: dir next to the executable
      const execDir = path.dirname(process.execPath || '');
      if (execDir) {
        const installDirCandidate = path.join(execDir, 'indicators');
        try {
          fs.mkdirSync(installDirCandidate, { recursive: true });
          // verify writable by writing a temporary file
          const testFile = path.join(installDirCandidate, '.write_test');
          fs.writeFileSync(testFile, 'ok');
          fs.unlinkSync(testFile);
          log.info('Using install indicators dir', { installDirCandidate });
          return installDirCandidate;
        } catch (e) {
          log.warn('Install indicators dir not writable, falling back to userData', { dir: installDirCandidate, err: e && e.message });
        }
      }
    }
  } catch (e) {
    log.warn('getIndicatorsDir check failed', { err: e && e.message });
  }

  const ud = path.join(app.getPath('userData'), 'indicators');
  try { fs.mkdirSync(ud, { recursive: true }); } catch (e) { log.warn('failed to ensure userData indicators dir', { dir: ud, err: e && e.message }); }
  log.info('Using userData indicators dir', { dir: ud });
  return ud;
};

const readInstalledIndicatorVersion = async () => {
  try {
    const versionFile = path.join(getIndicatorsDir(), 'indicator_version');
    if (!fs.existsSync(versionFile)) return null;
    const txt = fs.readFileSync(versionFile, 'utf8');
    return String(txt).trim() || null;
  } catch (err) {
    log.error('readInstalledIndicatorVersion error', { err: err && err.message });
    return null;
  }
};

ipcMain.handle('get-installed-indicators-version', async () => {
  return await readInstalledIndicatorVersion();
});

ipcMain.handle('check-indicators-version', async (event, url) => {
  const https = require('https');
  log.info('IPC: check-indicators-version', { url });
  return new Promise(resolve => {
    try {
      const req = https.get(url, { timeout: 15000 }, res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => {
          const ver = String(buf || '').trim();
          log.info('check-indicators-version fetched', { url, ver });
          resolve({ success: true, version: ver });
        });
      });
      req.on('error', (err) => { log.warn('check-indicators-version error', { err: err && err.message }); resolve({ success: false, error: String(err && err.message) }); });
      req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'timeout' }); });
    } catch (err) {
      log.error('check-indicators-version threw', { err: err && err.message });
      resolve({ success: false, error: String(err && err.message) });
    }
  });
});

// Keytar-backed token management
let keytar = null;
try {
  keytar = require('keytar');
} catch (e) {
  log.warn('keytar not available; token storage will not work', { err: e && e.message });
}

ipcMain.handle('store-indicator-token', async (event, token) => {
  if (!keytar) return false;
  try {
    await keytar.setPassword(KEYTAR_SERVICE, 'indicator', String(token || ''));
    return true;
  } catch (err) {
    log.error('store-indicator-token failed', { err: err && err.message });
    return false;
  }
});

ipcMain.handle('get-indicator-token', async () => {
  if (!keytar) return null;
  try {
    return await keytar.getPassword(KEYTAR_SERVICE, 'indicator');
  } catch (err) {
    log.error('get-indicator-token failed', { err: err && err.message });
    return null;
  }
});

ipcMain.handle('delete-indicator-token', async () => {
  if (!keytar) return false;
  try {
    return await keytar.deletePassword(KEYTAR_SERVICE, 'indicator');
  } catch (err) {
    log.error('delete-indicator-token failed', { err: err && err.message });
    return false;
  }
});

// Pull indicators from GitHub and write them into the indicators dir
const performDownloadIndicators = async (opts) => {
  // opts: { owner, repo, branch, token, version }
  const owner = (opts && opts.owner) || '';
  const repo = (opts && opts.repo) || '';
  const branch = (opts && opts.branch) || 'main';
  let token = (opts && opts.token) || null;
  if (!owner || !repo) return { success: false, error: 'missing owner or repo' };

  // fallback to stored token if none provided
  if (!token && keytar) {
    try { token = await keytar.getPassword(KEYTAR_SERVICE, 'indicator'); } catch (e) { log.warn('failed to read token from keytar', { err: e && e.message }); }
  }

  const indicatorsDir = getIndicatorsDir();
  ensureDir(indicatorsDir);
  const https = require('https');
  const headers = { 'User-Agent': 'world-data-app' };
  if (token) headers.Authorization = `token ${token}`;

  const api = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

  const fetchJson = (url) => new Promise((resolve, reject) => {
    try {
      const req = https.get(url, { headers, timeout: 20000 }, res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    } catch (err) { reject(err); }
  });

  try {
    const treeResp = await fetchJson(api);
    if (!treeResp || !treeResp.tree) {
      log.warn('performDownloadIndicators: no tree found', { api, treeResp });
      return { success: false, error: 'no tree' };
    }

    // Only download JSON files located under the 'indicators/' path in the repository
    const jsonFiles = treeResp.tree.filter(i => {
      const p = String(i.path || '');
      return i && i.type === 'blob' && p.startsWith('indicators/') && p.toLowerCase().endsWith('.json');
    });
    log.info('performDownloadIndicators: found json files under indicators/', { count: jsonFiles.length });

    const downloaded = [];
    const errors = [];

    // Notify renderer that download is starting (include total files)
    try {
      const total = jsonFiles.length;
      if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('indicators-download-start', { owner, repo, branch, total });
    } catch (e) { log.warn('failed to send indicators-download-start', { err: e && e.message }); }

    let i = 0;
    for (const item of jsonFiles) {
      i++;
      try {
        const contentUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(item.path)}?ref=${branch}`;
        const fileResp = await fetchJson(contentUrl);
        if (fileResp && fileResp.content) {
          const buf = Buffer.from(fileResp.content, fileResp.encoding || 'base64');
          const outPath = path.join(indicatorsDir, item.path.replace(/\\/g,'/'));
          const outDir = path.dirname(outPath);
          ensureDir(outDir);
          fs.writeFileSync(outPath, buf);
          downloaded.push(item.path);

          // progress update
          try {
            if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('indicators-download-progress', { current: i, total: jsonFiles.length, path: item.path });
          } catch (e) { log.warn('failed to send indicators-download-progress', { err: e && e.message }); }
        } else {
          errors.push({ path: item.path, error: 'no content' });
        }
      } catch (err) {
        log.warn('performDownloadIndicators file fetch failed', { path: item.path, err: err && err.message });
        errors.push({ path: item.path, error: String(err && err.message) });
      }
    }

    // write version file if provided
    if (opts && opts.version) {
      try { fs.writeFileSync(path.join(indicatorsDir, 'indicator_version'), String(opts.version)); } catch (e) { log.warn('failed to write indicator_version', { err: e && e.message }); }
    }

    const result = { success: true, downloaded: downloaded.length, errors, dir: indicatorsDir };

    // notify renderer that download completed
    try {
      if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('indicators-download-complete', result);
    } catch (e) { log.warn('failed to send indicators-download-complete', { err: e && e.message }); }

    return result;
  } catch (err) {
    log.error('performDownloadIndicators threw', { err: err && err.message });
    try {
      if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('indicators-download-complete', { success: false, error: String(err && err.message) });
    } catch (e) { log.warn('failed to send indicators-download-complete', { err: e && e.message }); }
    return { success: false, error: String(err && err.message) };
  }
};

ipcMain.handle('download-indicators', async (event, opts) => {
  log.info('IPC: download-indicators (handler) called', { owner: opts && opts.owner, repo: opts && opts.repo, branch: opts && opts.branch });
  return await performDownloadIndicators(opts);
});

// list installed JSON files under indicators dir
ipcMain.handle('list-indicator-files', async () => {
  try {
    ensureDir(getIndicatorsDir());
    const walk = (dir, base = '') => {
      let results = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const rel = path.join(base, entry.name);
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results = results.concat(walk(full, rel));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
          results.push(rel.replace(/\\/g, '/'));
        }
      }
      return results;
    };
    return walk(getIndicatorsDir());
  } catch (err) {
    log.warn('list-indicator-files failed', { err: err && err.message });
    return [];
  }
});

// read a specific installed indicator file, returns UTF-8 text
ipcMain.handle('read-indicator-file', async (event, relPath) => {
  try {
    const p = path.join(getIndicatorsDir(), relPath);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf8');
  } catch (err) {
    log.warn('read-indicator-file failed', { path: relPath, err: err && err.message });
    return null;
  }
});

// Periodic remote indicator version check and auto-download (production only)
const REMOTE_VERSION_URL = 'https://raw.githubusercontent.com/xmcllabs/V_Indicators/refs/heads/main/Indicator_version';
const AUTO_OWNER = 'xmcllabs';
const AUTO_REPO = 'Indicators';
const CHECK_INTERVAL_MS = 1000 * 60 * 60; // hourly

const checkAndUpdateIndicators = async () => {
  try {
    log.info('checkAndUpdateIndicators: Starting version check', { url: REMOTE_VERSION_URL, isDev });
    const https = require('https');
    const fetchText = (url) => new Promise((resolve, reject) => {
      try {
        log.info('fetchText: Making HTTPS request', { url });
        const req = https.get(url, { timeout: 15000 }, res => {
          log.info('fetchText: Response received', { statusCode: res.statusCode });
          let buf = '';
          res.on('data', d => {
            buf += d;
            log.debug('fetchText: Received data chunk', { size: d.length });
          });
          res.on('end', () => {
            const result = String(buf || '').trim();
            log.info('fetchText: Response complete', { result });
            resolve(result);
          });
        });
        req.on('error', (err) => { 
          log.error('fetchText: Request error', { err: err && err.message }); 
          reject(err); 
        });
        req.on('timeout', () => { 
          log.error('fetchText: Request timeout');
          req.destroy(); 
          reject(new Error('timeout')); 
        });
      } catch (err) { 
        log.error('fetchText: Exception', { err: err && err.message });
        reject(err); 
      }
    });

    const remoteVer = await fetchText(REMOTE_VERSION_URL).catch(err => { 
      log.error('checkAndUpdateIndicators: fetch remote version failed', { err: err && err.message }); 
      return null; 
    });
    
    log.info('checkAndUpdateIndicators: Remote version fetched', { remoteVer });
    if (!remoteVer) {
      log.warn('checkAndUpdateIndicators: No remote version retrieved, aborting');
      return;
    }
    
    const installedVer = await readInstalledIndicatorVersion();
    log.info('checkAndUpdateIndicators: Comparing versions', { remoteVer, installedVer });
    
    if (installedVer === remoteVer) {
      log.info('checkAndUpdateIndicators: Versions match, no update needed');
      return;
    }

    log.info('checkAndUpdateIndicators: Version mismatch detected, starting download', { remoteVer, installedVer });

    // attempt automated download using stored token (if available)
    let token = null;
    if (keytar) {
      try { 
        token = await keytar.getPassword(KEYTAR_SERVICE, 'indicator'); 
        log.info('checkAndUpdateIndicators: Token retrieved from keytar', { hasToken: !!token });
      } catch (e) { 
        log.warn('checkAndUpdateIndicators: failed to read token from keytar', { err: e && e.message }); 
      }
    } else {
      log.warn('checkAndUpdateIndicators: keytar not available, proceeding without token');
    }

    log.info('checkAndUpdateIndicators: Calling performDownloadIndicators', { owner: AUTO_OWNER, repo: AUTO_REPO, branch: 'main', hasToken: !!token });
    const downloadResult = await performDownloadIndicators({ owner: AUTO_OWNER, repo: AUTO_REPO, branch: 'main', token, version: remoteVer });

    log.info('checkAndUpdateIndicators: Auto download completed', { success: downloadResult && downloadResult.success, downloaded: downloadResult && downloadResult.downloaded });

    // Notify renderer
    try {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('indicators-updated', { success: !!downloadResult && !!downloadResult.success, version: remoteVer, details: downloadResult });
        log.info('checkAndUpdateIndicators: Renderer notification sent');
      } else {
        log.warn('checkAndUpdateIndicators: mainWindow or webContents not available for notification');
      }
    } catch (e) { 
      log.error('checkAndUpdateIndicators: failed to send indicators-updated', { err: e && e.message }); 
    }
  } catch (err) {
    log.error('checkAndUpdateIndicators: Uncaught exception', { err: err && err.message, stack: err && err.stack });
  }
};

// Initialize periodic checks only in production
if (!isDev) {
  log.info('Production mode detected - enabling auto indicator checks');
  // immediate check on startup
  log.info('Scheduling immediate indicator version check');
  checkAndUpdateIndicators().catch(err => log.error('initial check failed', { err: err && err.message }));
  log.info('Scheduling periodic indicator version checks', { intervalMs: CHECK_INTERVAL_MS });
  setInterval(() => { checkAndUpdateIndicators().catch(err => log.error('scheduled check failed', { err: err && err.message })); }, CHECK_INTERVAL_MS);
} else {
  log.info('Development mode detected - auto indicator checks disabled');
}

// Initialize periodic checks only in production
if (!isDev) {
  // immediate check on startup
  checkAndUpdateIndicators().catch(err => log.warn('initial check failed', { err: err && err.message }));
  setInterval(() => { checkAndUpdateIndicators().catch(err => log.warn('scheduled check failed', { err: err && err.message })); }, CHECK_INTERVAL_MS);
}

