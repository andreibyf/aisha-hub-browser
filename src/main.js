// src/main.js — hub-only, updater-safe, AI runner with safe renderer execution
const { app, BrowserWindow, Menu, session, shell, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

const HUB_HOST = "hub.aishacrm.app";

// ---------- Allowlist (site + assets + GitHub for updater) ----------
function getAllowlist() {
  try {
    const p = path.join(__dirname, "..", "config", "allowlist.json");
    return new Set(JSON.parse(fs.readFileSync(p, "utf8")).allowedHosts || []);
  } catch {
    return new Set([HUB_HOST]);
  }
}

const GH_HOSTS = [
  ".github.com",
".api.github.com",
".githubusercontent.com",
".github-releases.githubusercontent.com",
];

function urlAllowed(url, allow) {
  try {
    const u = new URL(url);
    const ok = u.protocol === "https:" || u.protocol === "wss:";
    if (!ok) return false;
    if (allow.has(u.hostname)) return true;
    // external suffixes you rely on (voice/Google assets/Supabase/updates)
    return [".elevenlabs.io", ".gstatic.com", ".googleusercontent.com", ".supabase.co", ...GH_HOSTS]
    .some(sfx => u.hostname.endsWith(sfx));
  } catch {
    return false;
  }
}

// ---------- Auto-updater (only when packaged) ----------
let autoUpdater = null;
try {
  if (app.isPackaged) {
    ({ autoUpdater } = require('electron-updater'));
  }
} catch (e) {
  console.warn('electron-updater not available:', e?.message || e);
}
function setupAutoUpdate(win) {
  if (!autoUpdater) return;
  let log = null;
  try { log = require('electron-log'); } catch {}
  if (log) { log.transports.file.level = 'info'; autoUpdater.logger = log; }
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

// ---------- Small HTTP helper for Base44 functions ----------
function postJSON(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const req = https.request({
        method: 'POST',
        hostname: u.hostname,
        path: (u.pathname || '') + (u.search || ''),
                                headers: { 'Content-Type': 'application/json', ...headers }
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(data || '{}') }); }
          catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(JSON.stringify(body || {}));
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function getAiToken() {
  const url = `https://${HUB_HOST}/api/functions/aiToken`;
  const { status, json } = await postJSON(url, {});
  if (status === 200 && json?.ok && json?.token) return json.token;
  throw new Error(`aiToken failed (${status}): ${json?.error || 'no token'}`);
}

// ---------- Safe renderer execution wrapper ----------
async function execInPage(win, code) {
  const wrapped = `
  (async () => {
    try {
      const result = await (async () => { ${code} })();
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: String(e && e.stack || e) };
    }
  })()
  `;
  return await win.webContents.executeJavaScript(wrapped);
}

// ---------- Snapshot (uses execInPage so errors bubble up) ----------
async function getSnapshot(win) {
  const r = await execInPage(win, `
  const interactive = Array.from(document.querySelectorAll('a,button,input,select,textarea,[role="button"]'))
  .slice(0, 150)
  .map(el => {
    const t = (el.innerText || el.textContent || '').trim().slice(0,140);
    let sel = '';
    try {
      if (el.id) sel = '#' + CSS.escape(el.id);
      else if (el.name) sel = '[name="' + String(el.name).replace(/"/g,'\\"') + '"]';
      else if (el.getAttribute('data-testid')) sel = '[data-testid="' + el.getAttribute('data-testid') + '"]';
      else sel = el.tagName.toLowerCase();
    } catch {}
    return { tag: el.tagName.toLowerCase(), selector: sel, text: t };
  });
  return {
    url: location.href,
    title: document.title,
    text: document.body.innerText.slice(0, 18000),
                             interactive_elements: interactive
  };
  `);
  if (!r.ok) throw new Error("Snapshot failed in page: " + r.error);
  return r.result;
}

// ---------- Tool parsing + execution ----------
function parseToolCalls(aiJson) {
  const tc = aiJson?.response?.tool_calls || [];
  return tc.map(t => {
    const name = t?.function?.name;
    let args = {};
    try { args = JSON.parse(t?.function?.arguments || '{}'); } catch {}
    return name ? { name, args } : null;
  }).filter(Boolean);
}

function sameHost(url) {
  try { return new URL(url).hostname === HUB_HOST; } catch { return false; }
}

async function executeToolCalls(win, calls) {
  for (const c of calls) {
    if (c.name === 'nav.goto') {
      let target = c.args?.url || '/';
      if (target.startsWith('/')) target = `https://${HUB_HOST}${target}`;
        if (!sameHost(target)) throw new Error(`Blocked nav off-domain: ${target}`);
        await win.loadURL(target);
        await new Promise(r => setTimeout(r, 400));
        continue;
    }

    if (c.name === 'dom.click') {
      const sel = c.args?.selector;
      if (!sel) continue;
      const r = await execInPage(win, `
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) throw new Error("Element not found: ${sel}");
      el.click(); true;
      `);
      if (!r.ok) throw new Error(r.error);
      await new Promise(r => setTimeout(r, 250));
      continue;
    }

    if (c.name === 'dom.type') {
      const sel = c.args?.selector, text = c.args?.text ?? '';
      if (!sel) continue;
      const r = await execInPage(win, `
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) throw new Error("Element not found: ${sel}");
      const setVal = (node, val) => {
        node.focus();
        node.value = val;
        node.dispatchEvent(new Event('input', { bubbles:true }));
        node.dispatchEvent(new Event('change', { bubbles:true }));
      };
      setVal(el, ${JSON.stringify(text)}); true;
      `);
      if (!r.ok) throw new Error(r.error);
      await new Promise(r => setTimeout(r, 250));
      continue;
    }
  }
}

// ---------- Window ----------
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
    cb(permission === "media");
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

  // ----- Menus -----
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
      label: "AI",
      submenu: [
        {
          label: "Run AI Command…",
          click: async () => {
            try {
              const focused = BrowserWindow.getFocusedWindow();
              if (!focused) return;

              // prompt for goal (safe)
              const promptResp = await execInPage(focused, `
              return window.prompt("What should I do? (e.g. 'Create a new lead for Acme')");
              `);
              if (!promptResp.ok) throw new Error("Prompt failed in page: " + promptResp.error);
              const goal = promptResp.result;
              if (!goal) return;

              const token = await getAiToken();
              const snapshot = await getSnapshot(focused);

              const { status, json } = await postJSON(
                `https://${HUB_HOST}/api/functions/aiRun`,
                { goal, snapshot },
                { Authorization: `Bearer ${token}` }
              );
              if (status !== 200 || !json?.ok) {
                throw new Error(json?.error || `aiRun failed (${status})`);
              }

              const calls = parseToolCalls(json);
              if (!calls.length) {
                dialog.showMessageBox(focused, { type: 'info', message: 'No actions returned by AI.' });
                return;
              }

              await executeToolCalls(focused, calls);
            } catch (e) {
              dialog.showErrorBox('AI Command failed', String(e?.message || e));
            }
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
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "toggleDevTools", accelerator: "Ctrl+Shift+I" }
      ]
    },
    { role: "quit" }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  // Updater
  setupAutoUpdate(win);
  if (autoUpdater) autoUpdater.checkForUpdatesAndNotify();

  return win;
}

// ---------- App lifecycle ----------
app.whenReady().then(async () => {
  const win = await createWindow();
  // DevTools shortcuts anywhere
  globalShortcut.register('F12', () => { win && win.webContents.toggleDevTools(); });
  globalShortcut.register('Control+Shift+I', () => { win && win.webContents.toggleDevTools(); });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
