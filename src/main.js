// src/main.js (hub-only, updater-safe, permissions, allowlist)
const { app, BrowserWindow, Menu, session, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const HUB_HOST = "hub.aishacrm.app";

// Load updater only when packaged; keep dev/portable from crashing
let autoUpdater = null;
try {
  if (app.isPackaged) {
    ({ autoUpdater } = require('electron-updater'));
  }
} catch (e) {
  console.warn('electron-updater not available:', e?.message || e);
}

function getAllowlist() {
  try {
    const p = path.join(__dirname, "..", "config", "allowlist.json");
    return new Set(JSON.parse(fs.readFileSync(p, "utf8")).allowedHosts || []);
  } catch {
    return new Set([HUB_HOST]);
  }
}

const GH_HOSTS = [ ".github.com", ".api.github.com", ".githubusercontent.com", ".github-releases.githubusercontent.com"        // objects.githubusercontent.com, raw…
];

function urlAllowed(url, allow) {
  try {
    const u = new URL(url);
    const ok = u.protocol === "https:" || u.protocol === "wss:";
    if (!ok) return false;
    if (allow.has(u.hostname)) return true;
    // allowed suffixes for your stack (voice, google assets, supabase)
    return [".elevenlabs.io", ".gstatic.com", ".googleusercontent.com", ".supabase.co", ...GH_HOSTS]
    .some(sfx => u.hostname.endsWith(sfx));
  } catch {
    return false;
  }
}

function setupAutoUpdate(win) {
  if (!autoUpdater) return; // not available in dev/portable

  // optional logging
  let log = null;
  try { log = require('electron-log'); } catch {}
  if (log) {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
  }

  autoUpdater.autoDownload = true;

  autoUpdater.on('error', (err) => {
    const msg = (err && err.stack) ? err.stack : String(err);
    if (log) log.error('Updater error:', msg);
    dialog.showErrorBox("Updater error", msg);
    win?.webContents.send('updater', { event: 'error', msg });
  });

  autoUpdater.on('checking-for-update', () => win?.webContents.send('updater', { event: 'checking' }));
  autoUpdater.on('update-available', (info) => win?.webContents.send('updater', { event: 'available', info }));
  autoUpdater.on('update-not-available', () => win?.webContents.send('updater', { event: 'none' }));
  autoUpdater.on('download-progress', (p) => win?.webContents.send('updater', { event: 'progress', p }));
  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
        message: 'Update ready',
        detail: `Version ${info.version} has been downloaded.`
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });
}

async function createWindow() {
  const allow = getAllowlist();

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Ai-SHA Hub Browser",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      partition: "persist:aisha-ssb-prod",
      preload: path.join(__dirname, "preload.js")
    }
  });

  const ses = session.fromPartition("persist:aisha-ssb-prod");

  // Mic/camera permission for ElevenLabs/voice widgets
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    cb(permission === "media"); // only allow mic/cam
  });

  // Network allowlist
  ses.webRequest.onBeforeRequest((details, cb) => {
    cb({ cancel: !urlAllowed(details.url, allow) });
  });

  // Block unapproved new windows
  win.webContents.setWindowOpenHandler(({ url }) =>
  urlAllowed(url, allow) ? { action: "allow" } : { action: "deny" }
  );

  await win.loadURL(`https://${HUB_HOST}/`);

  const template = [
    {
      label: "Auth",
      submenu: [
        {
          label: "Logout (clear session)",
          click: async () => {
            await ses.clearStorageData();
            await ses.clearCache();
            win.loadURL(`https://${HUB_HOST}/`);
          }
        }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Check for Updates",
          click: () => {
            if (autoUpdater) {
              autoUpdater.checkForUpdates();
            } else {
              dialog.showMessageBox(win, {
                type: 'info',
                message: 'Auto-update is available in the installed (Setup) build.'
              });
            }
          }
        },
        {
          label: "Open Logs Folder",
          click: () => shell.openPath(app.getPath("userData"))
        }
      ]
    },
    { role: "quit" }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  // Auto-update only when available
  setupAutoUpdate(win);
  if (autoUpdater) {
    autoUpdater.checkForUpdatesAndNotify();
  }

  return win;
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
