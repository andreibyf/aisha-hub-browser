// src/main.js — hub-only browser with updater, allowlist, DevTools, AI actions
const { app, BrowserWindow, Menu, session, shell, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

const HUB_HOST = 'hub.aishacrm.app';

// ---------------- Single instance & identity ----------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  // IMPORTANT: return to stop the rest of the file from running
  // when a 2nd instance is spawned.
  // eslint-disable-next-line no-useless-return
  return;
}
app.on('second-instance', () => {
  const w = BrowserWindow.getAllWindows()[0];
  if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
});

app.setAppUserModelId('com.aisha.hubbrowser');

let isQuitting = false;

// ---------------- Updater (only when packaged) ----------------
let autoUpdater = null;
try {
  if (app.isPackaged) {
    ({ autoUpdater } = require('electron-updater'));
  }
} catch (e) {
  console.warn('electron-updater not available:', e?.message || e);
}

// ---------------- Allowlist ----------------
function getAllowlist() {
  try {
    const p = path.join(__dirname, '..', 'config', 'allowlist.json');
    return new Set(JSON.parse(fs.readFileSync(p, 'utf8')).allowedHosts || []);
  } catch {
    return new Set([HUB_HOST]);
  }
}

const GH_HOSTS = [
  '.github.com',
'.api.github.com',
'.githubusercontent.com',
'.github-releases.githubusercontent.com',
];

function isNetProtocol(u) {
  // allow devtools://, chrome://, file:// etc. to pass unfiltered
  return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'wss:';
}

function urlAllowed(url, allow) {
  try {
    const u = new URL(url);
    if (!isNetProtocol(u)) return true;
    if (u.protocol !== 'https:' && u.protocol !== 'wss:') return false;
    if (allow.has(u.hostname)) return true;
    return [
      '.elevenlabs.io',
      '.gstatic.com',
      '.googleusercontent.com',
      '.supabase.co',
      ...GH_HOSTS,
    ].some(sfx => u.hostname.endsWith(sfx));
  } catch {
    return false;
  }
}

// ---------------- Updater wiring ----------------
function setupAutoUpdate(win) {
  if (!autoUpdater) return;

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
    dialog.showErrorBox('Updater error', msg);
    win?.webContents.send('updater', { event: 'error', msg });
  });

  autoUpdater.on('update-downloaded', () => {
    // Force close & install; reduces chance of "cannot be closed" dialog.
    autoUpdater.quitAndInstall(true /* isSilent */, true /* forceRunAfter */);
  });
}

// ---------------- AI helpers (HTTP + snapshot + tool exec) ----------------
function postJSON(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const req = https.request({
        method: 'POST',
        hostname: u.hostname,
        path: (u.pathname || '') + (u.search || ''),
                                headers: { 'Content-Type': 'application/json', ...headers },
      }, res => {
        let data = '';
        res.on('data', c => { data += c; });
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

async function execInPage(win, code) {
  const wrapped = `
  (async () => {
    try {
      const result = await (async () => { ${code} })();
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: String((e && e.stack) || e) };
    }
  })()
  `;
  return win.webContents.executeJavaScript(wrapped);
}

async function getSnapshot(win) {
  const js = `
  const interactive = Array.from(document.querySelectorAll(
    'a,button,input,select,textarea,[role="button"]'
  )).slice(0, 150).map(el => {
    const t = (el.innerText || el.textContent || '').trim().slice(0,140);
    let sel = '';
    try {
      if (el.id) sel = '#' + CSS.escape(el.id);
      else if (el.name) sel = '[name="' + el.name.replace(/"/g, '\\"') + '"]';
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
  `;
  const res = await execInPage(win, js);
  if (!res.ok) throw new Error(res.error);
  return res.result;
}

function parseToolCalls(aiJson) {
  const tc = aiJson?.response?.tool_calls || [];
  return tc.map(t => {
    const name = t?.function?.name;
    let args = {};
    try { args = JSON.parse(t?.function?.arguments || '{}'); } catch {}
    return { name, args };
  }).filter(x => !!x.name);
}

function sameHost(url) {
  try { return new URL(url).hostname === HUB_HOST; } catch { return false; }
}

async function executeToolCalls(win, calls) {
  for (const c of calls) {
    if (c.name === 'nav_goto') {
      let target = c.args?.url || '/';
      if (target.startsWith('/')) target = `https://${HUB_HOST}${target}`;
        if (!sameHost(target)) throw new Error(`Blocked nav off-domain: ${target}`);
        await win.loadURL(target);
        await new Promise(r => setTimeout(r, 400));
        continue;
    }

    if (c.name === 'dom_click') {
      const sel = c.args?.selector;
      if (!sel) continue;

      const r = await execInPage(win, `
      (function() {
        const sel = ${JSON.stringify(sel)};
        let el = document.querySelector(sel);
        if (!el) throw new Error("Element not found: " + sel);

        try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch {}

        const fire = (type) => {
          const evt = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 0,
            buttons: 1,
            clientX: (el.getBoundingClientRect().left + 5),
                                     clientY: (el.getBoundingClientRect().top + 5)
          });
          el.dispatchEvent(evt);
        };

        // full pointer/mouse sequence – many frameworks listen for these
        try { el.focus({ preventScroll: true }); } catch {}
        fire('pointerdown'); fire('mousedown'); fire('pointerup'); fire('mouseup');
        // .click() as a fallback (after real events)
        if (typeof el.click === 'function') el.click();

        return true;
      })()
      `);

      if (!r.ok) throw new Error(r.error);
      await new Promise(r => setTimeout(r, 300));
      continue;
    }

    if (c.name === 'dom_type') {
      const sel = c.args?.selector; const text = c.args?.text ?? '';
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

// ---------------- Window helpers ----------------
function destroyAllWindows() {
  BrowserWindow.getAllWindows().forEach(w => {
    try {
      w.removeAllListeners();
      if (!w.isDestroyed()) w.close();
      setTimeout(() => { if (!w.isDestroyed()) w.destroy(); }, 400);
    } catch {}
  });
}

// ---- In-page overlay prompt (no window.prompt) ----
async function uiPrompt(win, message = "What should I do?", placeholder = "Create a new lead for Acme") {
  const js = `
  (async () => {
    // Remove any previous prompt
    const old = document.getElementById('__aisha_overlay');
    if (old) old.remove();

    const wrap = document.createElement('div');
    wrap.id = '__aisha_overlay';
    wrap.style.position = 'fixed';
    wrap.style.inset = '0';
    wrap.style.background = 'rgba(0,0,0,.45)';
    wrap.style.zIndex = '2147483647';
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.justifyContent = 'center';

    const box = document.createElement('div');
    box.style.background = '#111';
    box.style.color = '#fff';
    box.style.padding = '16px';
    box.style.borderRadius = '10px';
    box.style.minWidth = '380px';
    box.style.fontFamily = 'system-ui, Segoe UI, Arial, sans-serif';
    box.style.boxShadow = '0 10px 30px rgba(0,0,0,.35)';
    box.innerHTML = \`
    <div style="font-weight:600;margin-bottom:8px">\${${JSON.stringify(message)}}</div>
    <input id="__aisha_cmd_inp" style="width:100%;padding:10px;background:#222;color:#fff;border:1px solid #333;border-radius:8px" placeholder="\${${JSON.stringify(placeholder)}}" />
    <div style="margin-top:12px;text-align:right;gap:8px;display:flex;justify-content:flex-end">
    <button id="__aisha_cancel" style="background:#333;color:#fff;border:0;padding:8px 12px;border-radius:8px;cursor:pointer">Cancel</button>
    <button id="__aisha_ok" style="background:#4f8cff;color:#fff;border:0;padding:8px 12px;border-radius:8px;cursor:pointer">OK</button>
    </div>\`;

    wrap.appendChild(box);
    document.body.appendChild(wrap);

    const inp = box.querySelector('#__aisha_cmd_inp');
    const okBtn = box.querySelector('#__aisha_ok');
    const cancelBtn = box.querySelector('#__aisha_cancel');

    return await new Promise((resolve) => {
      const done = (val) => { wrap.remove(); resolve(val ?? ''); };

      okBtn.addEventListener('click', () => done(inp.value.trim()));
      cancelBtn.addEventListener('click', () => done(''));

      wrap.addEventListener('click', (e) => {
        if (e.target === wrap) done('');
      });

        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') done(inp.value.trim());
          if (e.key === 'Escape') done('');
        });

          setTimeout(() => inp.focus(), 0);
    });
  })()
  `;
  const res = await execInPage(win, js);
  if (!res.ok) throw new Error(res.error || 'Prompt failed');
  return res.result || '';
}


// ---------------- Create window ----------------
async function createWindow() {
  const allow = getAllowlist();

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Ai-SHA Hub Browser',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      partition: 'persist:aisha-ssb-prod',
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  const ses = session.fromPartition('persist:aisha-ssb-prod');

  // Mic/camera for ElevenLabs
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media'));

  // Allowlist: only filter http/https/wss; allow devtools://, file://, etc.
  ses.webRequest.onBeforeRequest((details, cb) => {
    try {
      const u = new URL(details.url);
      if (!isNetProtocol(u)) return cb({ cancel: false });
      cb({ cancel: !urlAllowed(details.url, allow) });
    } catch {
      cb({ cancel: false });
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) =>
  urlAllowed(url, allow) ? { action: 'allow' } : { action: 'deny' }
  );

  await win.loadURL(`https://${HUB_HOST}/`);

  const template = [
    {
      label: 'Auth',
      submenu: [
        {
          label: 'Logout (clear session)',
          click: async () => {
            if (isQuitting) return;
            await ses.clearStorageData();
            await ses.clearCache();
            win.loadURL(`https://${HUB_HOST}/`);
          }
        }
      ]
    },
    {
      label: 'AI',
      submenu: [
        {
          label: 'Run AI Command…',
          click: async () => {
            try {
              const focused = BrowserWindow.getFocusedWindow() || win;
              // Prompt shim (some SPAs disable window.prompt)
              const goal = await uiPrompt(
                focused,
                "What should I do? (e.g. “Create a new lead for Acme”)",
                                          "Create a new lead for Acme"
              );
              if (!goal) return; // user cancelled

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
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'toggleDevTools', accelerator: 'Ctrl+Shift+I' },
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates',
          click: () => {
            if (autoUpdater) autoUpdater.checkForUpdates();
            else dialog.showMessageBox(win, {
              type: 'info',
              message: 'Auto-update is available in the installed (Setup) build.'
            });
          }
        },
        { label: 'Open Logs Folder', click: () => shell.openPath(app.getPath('userData')) }
      ]
    },
    { role: 'quit' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  setupAutoUpdate(win);
  return win;
}

// ---------------- App lifecycle ----------------
app.whenReady().then(async () => {
  const win = await createWindow();
  // DevTools shortcuts
  globalShortcut.register('F12', () => { if (win && !win.isDestroyed()) win.webContents.toggleDevTools(); });
  globalShortcut.register('Control+Shift+I', () => { if (win && !win.isDestroyed()) win.webContents.toggleDevTools(); });
});

app.on('before-quit', () => {
  isQuitting = true;
  destroyAllWindows();
});

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
