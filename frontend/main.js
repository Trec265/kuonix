const { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, shell } = require('electron');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const sudo = require('sudo-prompt');
const url = require('url');
const { spawn, spawnSync } = require('child_process');
const { execFile } = require('child_process');
const kill = require('tree-kill');
let backendProcess = null; // To hold backend process reference
let backendPort = null; // Port the backend was started on for this launch
let backendStopped = false; // Set once the backend has been killed for quit
let quitting = false;
let helpWindow = null; // Track help window instance
let splashWindow = null;

const DEFAULT_BACKEND_PORT = 8081;
// First launch extracts OpenCV natives from the jar, so allow a slow start.
const BACKEND_READY_TIMEOUT_MS = 120000;
const BACKEND_STOP_TIMEOUT_MS = 5000;

/**
 * Root of the bundled runtime resources (jre/, backend/, bin/<platform>/).
 * Packaged: electron-builder extraResources, next to (not inside) app.asar.
 * Development: staging/ produced by `npm run stage`, which uses the same layout.
 */
function resourceRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, 'staging');
}

/**
 * Resolve the Java executable and backend jar. A packaged app only ever uses
 * the bundled JRE and jar; development may fall back to JAVA_HOME and the
 * Gradle output when the staging directory hasn't been populated.
 */
function resolveBackendRuntime() {
  const javaExe = process.platform === 'win32' ? 'java.exe' : 'java';
  const javaCandidates = [path.join(resourceRoot(), 'jre', 'bin', javaExe)];
  const jarCandidates = [path.join(resourceRoot(), 'backend', 'kuonix.jar')];
  if (!app.isPackaged) {
    if (process.env.JAVA_HOME) javaCandidates.push(path.join(process.env.JAVA_HOME, 'bin', javaExe));
    jarCandidates.push(path.join(__dirname, '..', 'restful', 'build', 'libs', 'kuonix.jar'));
  }
  const java = javaCandidates.find((p) => fs.existsSync(p));
  const jar = jarCandidates.find((p) => fs.existsSync(p));
  if (!java) throw new Error(`Java runtime not found. Looked for:\n${javaCandidates.join('\n')}`);
  if (!jar) throw new Error(`Backend jar not found. Looked for:\n${jarCandidates.join('\n')}`);
  return { java, jar };
}

/**
 * Get the path to the dcraw_emu binary for the current platform
 * @returns {string} Absolute path to dcraw_emu executable
 */
function getDcrawEmuPath() {
  const platform = process.platform;
  const binName = platform === 'win32' ? 'dcraw_emu.exe' : 'dcraw_emu';
  const bundled = path.join(resourceRoot(), 'bin', platform, binName);
  if (app.isPackaged || fs.existsSync(bundled)) return bundled;
  return path.join(__dirname, 'bin', platform, binName);
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

// 8081 when available; otherwise any free loopback port chosen by the OS.
async function chooseBackendPort() {
  if (await isPortFree(DEFAULT_BACKEND_PORT)) return DEFAULT_BACKEND_PORT;
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Start backend when Electron starts
function startBackend(port) {
  const { java, jar } = resolveBackendRuntime();

  // Add JVM arguments to enable native access for OpenCV
  const jvmArgs = [
    '--enable-native-access=ALL-UNNAMED',  // Allow native library loading
    '-jar',
    jar,
    `--server.port=${port}`,
    '--server.address=127.0.0.1',
    // Lets the backend exit on its own if Electron is killed without cleanup
    `--kuonix.parent-pid=${process.pid}`
  ];

  // Prepare environment variables for RAW image processing
  const dcrawPath = getDcrawEmuPath();
  const dcrawCacheDir = path.join(app.getPath('userData'), '.dcraw-cache');

  const logDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logStream = fs.createWriteStream(path.join(logDir, 'backend.log'), { flags: 'w' });
  logStream.write(`java=${java}\njar=${jar}\nport=${port}\ndcraw=${dcrawPath}\n\n`);

  backendProcess = spawn(java, jvmArgs, {
    windowsHide: true,  // Hides the console window on Windows
    stdio: ['ignore', 'pipe', 'pipe'],  // Keep stdout/stderr for logging
    env: {
      ...process.env,
      DCRAW_PATH: dcrawPath,
      DCRAW_CACHE_DIR: dcrawCacheDir
    }
  });
  backendPort = port;
  backendStopped = false;

  backendProcess.stdout.on("data", (data) => {
    logStream.write(data);
    console.log(`Backend: ${data}`);
  });

  backendProcess.stderr.on("data", (data) => {
    logStream.write(data);
    // Filter out Java 25 compatibility warnings to reduce noise
    const msg = data.toString();
    if (!msg.includes('WARNING:') && !msg.includes('sun.misc.Unsafe')) {
      console.error(`Backend Error: ${msg}`);
    }
  });

  const child = backendProcess;
  child.on('error', (err) => {
    logStream.write(`\nFailed to launch backend: ${err.message}\n`);
    console.error(`Backend failed to launch: ${err.message}`);
  });

  child.on("close", (code) => {
    console.log(`Backend stopped with code ${code}`);
    logStream.end(`\nBackend stopped with code ${code}\n`);
    if (backendProcess === child) backendProcess = null;
  });
}

function backendLogPath() {
  return path.join(app.getPath('userData'), 'logs', 'backend.log');
}

/**
 * Poll the backend health endpoint until it answers 200. Fails fast if the
 * backend process exits (e.g. the port was taken or the JRE failed).
 */
function waitForBackendHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const child = backendProcess;
  return new Promise((resolve, reject) => {
    const retry = () => setTimeout(attempt, 300);
    function attempt() {
      if (!child || child.exitCode !== null || child.signalCode !== null || backendProcess !== child) {
        return reject(new Error('The backend process exited during startup.'));
      }
      if (Date.now() > deadline) {
        return reject(new Error(`The backend did not respond within ${timeoutMs / 1000} seconds.`));
      }
      const req = http.get({ host: '127.0.0.1', port, path: '/admin/health', timeout: 1500 }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on('timeout', () => req.destroy());
      req.on('error', retry);
    }
    attempt();
  });
}

/**
 * Kill the backend and every process it spawned (dcraw_emu decodes).
 * tree-kill is needed because killing only the JVM would orphan its children.
 */
function stopBackend() {
  const child = backendProcess;
  if (!child || child.exitCode !== null) {
    backendStopped = true;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      killBackendSync();
      resolve();
    }, BACKEND_STOP_TIMEOUT_MS);
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    kill(child.pid, (err) => {
      if (err) console.error('Failed to stop backend:', err);
    });
    backendStopped = true;
  });
}

// Synchronous last-resort kill for the process 'exit' event, where async
// work (tree-kill spawns a helper) can no longer run.
function killBackendSync() {
  const child = backendProcess;
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      spawnSync('pkill', ['-KILL', '-P', String(child.pid)]);
      process.kill(child.pid, 'SIGKILL');
    }
  } catch (err) {
    console.error('Failed to kill backend:', err);
  }
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 360,
    height: 260,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    show: false,
    skipTaskbar: false,
    title: 'Kuonix',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f2121' : '#fcfcf9',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  splashWindow.loadFile('splash.html');
  splashWindow.once('ready-to-show', () => splashWindow?.show());
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
}

function createWindow () {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      // Hands the renderer the port chosen for this launch (see preload.js)
      additionalArguments: [`--kuonix-backend-port=${backendPort ?? DEFAULT_BACKEND_PORT}`]
    },
    backgroundColor: '#fcfcf9',
    titleBarStyle: 'default',
    show: false
  });

  win.loadFile('index-next.html');

  // Show window when ready to prevent visual flash
  win.once('ready-to-show', () => {
    win.show();
    closeSplashWindow();
  });

  // Open DevTools in development (uncomment if needed)
  // win.webContents.openDevTools();
}

/**
 * Launch sequence: splash → start backend on a free port → wait for its health
 * check → main window. The main UI never appears before the backend is ready.
 */
async function launch() {
  if (process.env.KUONIX_BACKEND_DISABLED) {
    createWindow();
    return;
  }

  createSplashWindow();
  try {
    const port = await chooseBackendPort();
    startBackend(port);
    await waitForBackendHealth(port, BACKEND_READY_TIMEOUT_MS);
    createWindow();
  } catch (err) {
    console.error('Backend startup failed:', err);
    await stopBackend();
    closeSplashWindow();
    if (quitting) return;  // user closed the splash; nothing to report
    const logHint = fs.existsSync(backendLogPath())
      ? `\n\nDetails are in the backend log:\n${backendLogPath()}`
      : '';
    dialog.showErrorBox('Kuonix could not start', `${err.message}${logHint}`);
    app.quit();
  }
}

/**
 * Creates a help window with proper Electron best practices
 * - Prevents white flash with backgroundColor + show: false
 * - Uses ready-to-show event for smooth appearance
 * - Implements singleton pattern to prevent multiple windows
 * - Direct navigation to help section via URL hash
 * - Proper cleanup on window close
 */
function createHelpWindow() {
  // Singleton pattern: return existing window if already open
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.focus();
    return;
  }

  // Create window with proper configuration
  helpWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#ffffff', // Match website background to prevent flash
    show: false, // Don't show until ready
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      // Security: disable web security features for external content
      webSecurity: true,
      // Allow navigation to external URL
      navigateOnDragDrop: false
    },
    title: 'Help & Documentation'
  });

  // Load the help page directly with hash to navigate to help section
  // This is the proper way to open external URLs in Electron
  const helpUrl = 'https://color-correction-helper.free.nf/#help';
  helpWindow.loadURL(helpUrl);

  // Show window only when ready to prevent white flash
  helpWindow.once('ready-to-show', () => {
    helpWindow.show();
  });

  // Handle external links properly - open in default browser
  helpWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in system browser instead of new window
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Optional: Handle navigation to external domains
  helpWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const allowedDomain = 'color-correction-helper.free.nf';

    // Allow navigation within the help domain
    if (parsedUrl.hostname !== allowedDomain) {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });

  // Clean up reference when window is closed
  helpWindow.on('closed', () => {
    helpWindow = null;
  });

  // Optional: Log when page finishes loading
  helpWindow.webContents.on('did-finish-load', () => {
    console.log('Help window loaded successfully');
  });

  // Handle load failures gracefully
  helpWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Help window failed to load:', errorCode, errorDescription);
    // Could show an error dialog here
  });
}

ipcMain.handle('dark-mode:toggle', () => {
  if (nativeTheme.shouldUseDarkColors) {
    nativeTheme.themeSource = 'light'
  } else {
    nativeTheme.themeSource = 'dark'
  }
  return nativeTheme.shouldUseDarkColors
});

ipcMain.handle('dark-mode:system', () => {
  nativeTheme.themeSource = 'system'
});

// IPC handler for opening help window
ipcMain.handle('open-help-window', () => {
  createHelpWindow();
});

// IPC handler for folder selection
ipcMain.handle('select-folder', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Output Folder for Organized Images',
    buttonLabel: 'Select Folder'
  });
  return result.canceled ? null : result.filePaths[0];
});

// IPC handler to open folder in system explorer
ipcMain.handle('open-folder', async (event, folderPath) => {
  shell.openPath(folderPath);
});

// IPC handler to open an external http/https URL in the default browser.
// Only http/https are allowed so renderer content can't launch arbitrary
// protocols/executables via shell.openExternal.
ipcMain.handle('open-external', async (event, externalUrl) => {
  try {
    const parsed = new URL(externalUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      await shell.openExternal(externalUrl);
      return { success: true };
    }
    return { success: false, error: 'Only http/https URLs are allowed' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// IPC handler for reference image selection (Color Lab)
ipcMain.handle('select-reference-image', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: 'Select Reference Image',
    buttonLabel: 'Select',
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'cr2', 'nef', 'arw', 'dng'] }
    ]
  });
  return result.canceled ? null : { filePath: result.filePaths[0] };
});

ipcMain.handle("launch-app", async (event, appPath, args) => {
  return new Promise((resolve, reject) => {
    const child = execFile(appPath, args, (error) => {
      if (error) {
        console.error("Launch error:", error);
        reject(error);
      } else {
        resolve("Launched successfully");
      }
    });
  });
});

ipcMain.handle('search-executable', async (event, filename) => {
  return searchExecutableQuick(filename);
});

// Admin deep search: ONLY used from Settings when user opts in
ipcMain.handle('search-executable-admin', async (event, filename) => {
  return searchExecutableAdmin(filename);
});

function searchExecutableQuick(filename) {
  return new Promise((resolve, reject) => {
    let cmd;

    if (process.platform === 'win32') {
      cmd = `where ${filename}`;
    } else if (process.platform === 'darwin') {
      cmd = `mdfind "kMDItemFSName == '${filename}'" | head -n 1`;
    } else {
      cmd = `which ${filename} || whereis ${filename}`;
    }

    execFile(cmd.split(' ')[0], cmd.split(' ').slice(1), (err, stdout, stderr) => {
      if (!err && stdout && stdout.trim()) {
        const first = stdout.trim().split(/\r?\n/)[0];
        return resolve(first);
      }
      reject(new Error(`Executable ${filename} not found in PATH`));
    });
  });
}

function searchExecutableAdmin(filename) {
  return new Promise((resolve, reject) => {
    const adminCmd = getAdminSearchCommand(filename);
    if (!adminCmd) {
      return reject(new Error(`No admin search command for ${filename}`));
    }

    const options = { name: 'Electron App' };

    sudo.exec(adminCmd, options, (error, out, errOut) => {
      // User can cancel → error will be non-null
      if (error || !out || !out.trim()) {
        console.error('Admin search error or cancelled:', error || errOut);
        // "Skip the search if permission is not granted" -> just reject
        return reject(new Error(errOut || 'Admin search cancelled or no result.'));
      }
      const first = out.trim().split(/\r?\n/)[0];
      resolve(first);
    });
  });
}

function getAdminSearchCommand(filename) {
  if (process.platform === 'win32') {
    // admin via PowerShell
    return `powershell -Command "Get-ChildItem -Path C:\\ -Filter '${filename}' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName"`;
  }

  // macOS & Linux: scan filesystem
  return `find / -name "${filename}" 2>/dev/null | head -n 1`;
}

app.whenReady().then(() => {
  launch();
  protocol.registerFileProtocol('img', (request, callback) => {
    const filePath = url.fileURLToPath('file://' + request.url.slice('atom://'.length))
    callback(filePath)
  })
});

// Kill backend on app exit. Quit is deferred until the backend (and any
// decodes it spawned) is gone, so nothing is left holding the port.
app.on('before-quit', (event) => {
  quitting = true;
  if (backendProcess && !backendStopped) {
    event.preventDefault();
    stopBackend().then(() => app.quit());
  }
});

// Covers exits that bypass before-quit (app.exit, fatal main-process errors).
// A hard kill of Electron runs no handlers at all; the backend's parent-PID
// watchdog handles that case.
process.on('exit', killBackendSync);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  } else {
    // macOS keeps the app alive without windows; don't keep the backend too.
    stopBackend();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (backendProcess && !backendStopped) createWindow();
    else launch();
  }
});
