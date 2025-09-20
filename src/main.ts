// src/main.ts
import { app, BrowserWindow, protocol, shell } from 'electron';
import * as path from 'path';

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // compiled preload
                          contextIsolation: true,
                          nodeIntegration: false,
                          sandbox: true
    }
  });

  win.loadURL('https://hub.aishacrm.app');

  // Optional: strip Electron from UA
  const ua = win.webContents.userAgent;
  win.webContents.setUserAgent(ua.replace(/Electron\\/[^ ]+ ?/, ''));

  win.webContents.setWindowOpenHandler(({ url }) => {
    const internal = url.startsWith('https://hub.aishacrm.app/');
    if (!internal) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
}

app.whenReady().then(() => {
  // Handle OAuth callbacks like aishahub://callback
  protocol.registerStringProtocol('aishahub', (req) => {
    win?.webContents.send('oauth-callback', req.url);
    return '';
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
