'use strict';

const {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage,
  Notification, shell, dialog, nativeTheme,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store').default || require('electron-store');
const path = require('path');

// ─── Constants ───────────────────────────────────────────────────────────────

// The web app to load. Defaults to the live ops app; FWW_OPS_URL overrides it so
// a local dev bundle (e.g. http://localhost:8971 from `apps/web` npm run dev) can
// be tested inside the real shell — needed to verify embedded <webview> views
// against local changes before they're deployed to ops.fuzzyreporting.com.
const APP_URL   = process.env.FWW_OPS_URL || 'https://ops.fuzzyreporting.com/';
const APP_NAME  = 'FWW Ops';
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');

// Persistent session partition holding the Cloudflare Access identity cookie.
// The main window AND every embedded <webview> share it, so ONE team-level CF
// Access sign-in silently covers every embedded FWW app (Booths, HQ, Pattern
// Manager, Shipping…). MUST match the <webview partition> the web app sets.
const SESSION_PARTITION = 'persist:fwwops';

// A popup/navigation whose host is Google, a Cloudflare Access team domain, or
// any *.fuzzyreporting.com app opens IN-APP (so the OAuth / CF Access login flow
// and embedded-app auth popups work); everything else goes to the OS browser.
function isInAppPopup(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return (
      u.hostname === 'accounts.google.com' ||
      u.hostname.endsWith('.cloudflareaccess.com') ||
      u.hostname === 'fuzzyreporting.com' ||
      u.hostname.endsWith('.fuzzyreporting.com')
    );
  } catch { return false; }
}

// ─── Persistent settings (window bounds only) ────────────────────────────────

const store = new Store({
  name: 'config',
  defaults: { windowBounds: { width: 1440, height: 900 } },
});

// ─── Single instance lock ─────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// ─── Globals ─────────────────────────────────────────────────────────────────

let mainWindow = null;
let tray       = null;
let quitting   = false;
let pdfWindows = [];

// ─── PDF / document windows ─────────────────────────────────────────────────────
//
// Shipping-label + packing-slip PDFs are auth-gated (Cloudflare Access), so the
// signed-out system browser can't load them — they open in an in-app window that
// SHARES the session. Each gets its own standalone window so the user simply
// closes it to return; the MAIN window is never navigated to a chromeless inline
// PDF (which has no back button and forces an app restart).

function isPdfUrl(url) {
  return /\.pdf($|[?#])/i.test(url || '');
}

function openPdfWindow(url) {
  const win = new BrowserWindow({
    width: 1000,
    height: 820,
    title: 'Document — ' + APP_NAME,
    icon: ICON_PATH,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { partition: SESSION_PARTITION },
  });
  win.setMenuBarVisibility(false);
  win.on('closed', () => { pdfWindows = pdfWindows.filter((w) => w !== win); });
  pdfWindows.push(win);
  win.loadURL(url);
  return win;
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  buildAppMenu();
  createMainWindow();
  createTray();
  setupAutoUpdater();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => {
  // Closing the window fully exits — no lingering background instance holding the
  // single-instance lock and blocking reopen.
  app.quit();
});

// ─── Embedded <webview> hardening + popup routing ──────────────────────────────
//
// Embedded apps are rendered by the web layer as <webview> tags (see the ops web
// app's embed modules). These app-level hooks apply to EVERY webview:
//   * will-attach-webview — strip any preload, force no node integration (defense
//     in depth; the embedded app is remote and untrusted-ish).
//   * web-contents-created — for webview contents, route popups: OAuth / CF Access
//     / fuzzyreporting apps open in-app; PDFs to a PDF window; everything else to
//     the OS browser. Without this an embedded app's "Sign in with Google" popup
//     would be blocked or hijacked to the external browser and auth would break.

app.on('will-attach-webview', (_event, webPreferences, params) => {
  delete webPreferences.preload;
  webPreferences.nodeIntegration = false;
  webPreferences.contextIsolation = true;
  // params.partition comes from the <webview partition="persist:fwwops"> attribute
  // (the web app sets it) so the CF Access session is shared — leave it as-is.
});

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;
  contents.setWindowOpenHandler(({ url }) => {
    if (isPdfUrl(url)) { openPdfWindow(url); return { action: 'deny' }; }
    if (isInAppPopup(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
});

// ─── Application menu ──────────────────────────────────────────────────────────

function buildAppMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
        { label: 'Home', click: () => mainWindow?.loadURL(APP_URL) },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Developer Tools', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Check for Updates', click: () => { try { autoUpdater.checkForUpdates(); } catch (_) {} } },
        { label: 'About', click: () => {
          dialog.showMessageBox(mainWindow, {
            type: 'info', title: APP_NAME,
            message: `${APP_NAME} ${app.getVersion()}`,
            detail: 'Desktop shell for ops.fuzzyreporting.com.\nSigned in via Cloudflare Access (Google); updates install automatically.',
            buttons: ['OK'],
          });
        } },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

// ─── Main window ─────────────────────────────────────────────────────────────

function createMainWindow() {
  const bounds = store.get('windowBounds');

  mainWindow = new BrowserWindow({
    width:  bounds.width,
    height: bounds.height,
    minWidth:  1000,
    minHeight: 640,
    title: APP_NAME,
    icon:  ICON_PATH,
    backgroundColor: '#0E0F12',
    show: false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      // Persist cookies so the Cloudflare Access / Google session survives
      // restarts — same approach as FWW Shipping / B2B Admin.
      partition:        SESSION_PARTITION,
      spellcheck:       true,
      // Allow <webview> tags so the web app can embed other FWW apps as left-nav
      // views. Each webview is its own top-level webContents (NOT an iframe), so
      // X-Frame-Options / frame-ancestors never apply to CF-Access apps.
      webviewTag:       true,
    },
  });

  mainWindow.on('resize', () => {
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  });

  mainWindow.on('close', () => {
    quitting = true;
    BrowserWindow.getAllWindows().forEach((w) => {
      if (w !== mainWindow) { try { w.destroy(); } catch (_) {} }
    });
    app.quit();
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Let the OAuth / Access popup (and embedded-app auth popups) open in-app; send
  // everything else to the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isPdfUrl(url)) { openPdfWindow(url); return { action: 'deny' }; }
    if (isInAppPopup(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // A plain (same-window) navigation to a PDF would strand the main window on an
  // inline PDF with no back button. Intercept ONLY PDF navigations into their own
  // window; leave all normal in-app navigation alone.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isPdfUrl(url)) {
      event.preventDefault();
      openPdfWindow(url);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.loadURL(APP_URL);
}

// ─── System tray ─────────────────────────────────────────────────────────────

function createTray() {
  const img = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: APP_NAME, enabled: false },
    { type: 'separator' },
    { label: 'Open', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Check for Updates', click: () => { try { autoUpdater.checkForUpdates(); } catch (_) {} } },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ─── IPC ───────────────────────────────────────────────────────────────────────

ipcMain.handle('app:version', () => app.getVersion());

// Native notifications + taskbar badge bridge (window.fwwOps in preload). The ops
// web app's shell-push module calls these on live chat events so a native OS
// notification fires and the taskbar shows an unread badge even when the window
// is unfocused. Clicking a notification focuses the window and forwards its route.
ipcMain.on('fwwops:notify', (_event, payload) => {
  try {
    if (!payload || typeof payload !== 'object' || !Notification.isSupported()) return;
    const n = new Notification({
      title: String(payload.title || APP_NAME),
      body:  String(payload.body || ''),
      silent: !!payload.silent,
    });
    n.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
      const route = typeof payload.url === 'string' ? payload.url : null;
      if (route) mainWindow?.webContents.send('fwwops:activate-notification', { url: route, tag: payload.tag });
    });
    n.show();
  } catch (_) { /* notifications must never crash the app */ }
});

ipcMain.on('fwwops:set-badge', (_event, count) => {
  try {
    const n = Math.max(0, Number(count) || 0);
    // Windows has no numeric dock badge; a non-empty overlay dot signals unread.
    if (typeof app.setBadgeCount === 'function') app.setBadgeCount(n);
    if (mainWindow && process.platform === 'win32') {
      if (n > 0) {
        const dot = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
        mainWindow.setOverlayIcon(dot, `${n} unread`);
      } else {
        mainWindow.setOverlayIcon(null, '');
      }
    }
  } catch (_) {}
});

// ─── Auto updater ─────────────────────────────────────────────────────────────
//
// Checks GitHub Releases on every launch ("auto-update upon open"), downloads in
// the background, and offers to restart. Anything not installed at restart is
// applied automatically on next quit.

function setupAutoUpdater() {
  if (!app.isPackaged) return; // skip in dev

  autoUpdater.autoDownload         = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] update available: ${info.version}`);
    mainWindow?.webContents.send('updater:status', { type: 'available', version: info.version });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] update downloaded: ${info.version}`);
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `${APP_NAME} ${info.version} has been downloaded.`,
      detail: 'Restart now to apply it, or it will install automatically next time you quit.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    });
    if (choice === 0) { quitting = true; autoUpdater.quitAndInstall(); }
  });

  autoUpdater.on('error', (e) => console.error('[updater] error:', e.message));

  // Check on startup, then every 4 hours while open.
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}
