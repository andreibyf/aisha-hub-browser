
// src/main.js (hub-only production, auto-updates, manual updater menu, LLM preload)
const { app, BrowserWindow, Menu, session, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const HUB_HOST = "hub.aishacrm.app";

function getAllowlist() {
  try {
    const p = path.join(__dirname, "..", "config", "allowlist.json");
    return new Set(JSON.parse(fs.readFileSync(p, "utf8")).allowedHosts || []);
  } catch {
    return new Set([HUB_HOST]);
  }
}

function urlAllowed(url, allow) {
  try {
    const u = new URL(url);
    const ok = u.protocol === "https:" || u.protocol === "wss:";
    if (!ok) return false;
    if (allow.has(u.hostname)) return true;
    // Safe suffixes required by your stack
    return [".elevenlabs.io", ".gstatic.com", ".googleusercontent.com", ".supabase.co"]
      .some(sfx => u.hostname.endsWith(sfx));
  } catch {
    return false;
  }
}

function setupAutoUpdateMenu(win) {
  autoUpdater.autoDownload = true;
  autoUpdater.on('error', (err) => {
    dialog.showErrorBox("Updater error", (err && err.stack) ? err.stack : String(err));
  });
  autoUpdater.on('update-available', () => {
    if (win) win.webContents.send('update-available');
  });
  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      title: 'Update ready',
      message: 'An update was downloaded. Restart to apply now?'
    }).then(result => {
      if (result.response === 0) autoUpdater.quitAndInstall();
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

  // Mic/camera for voice widgets like ElevenLabs
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(permission === "media"));

  // Network allowlist
  ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !urlAllowed(details.url, allow) }));

  // Block unapproved new windows
  win.webContents.setWindowOpenHandler(({ url }) =>
    urlAllowed(url, allow) ? { action: "allow" } : { action: "deny" }
  );

  await win.loadURL(`https://${HUB_HOST}/`);

  // App menu
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
          click: () => autoUpdater.checkForUpdatesAndNotify()
        },
        {
          label: "Open Logs Folder",
          click: () => shell.openPath(app.getPath("userData"))
        }
      ]
    },
    { role: "quit" }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Auto-update check on startup
  setupAutoUpdateMenu(win);
  autoUpdater.checkForUpdatesAndNotify();

  return win;
}

app.whenReady().then(async () => {
  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
