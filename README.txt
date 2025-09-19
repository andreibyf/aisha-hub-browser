# AiSHA AI Agent Kit (Electron-side)

Files:
- src/agent/aiToken.js
- src/agent/aiRun.js
- src/preload.js

Wiring in main.js:

const { ipcMain, BrowserWindow } = require('electron');
const { runSteps } = require('./src/agent/aiRun');
const { getAiToken } = require('./src/agent/aiToken');

ipcMain.handle('ai:runSteps', async (evt, steps) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  await runSteps(win, steps);
  return { ok: true };
});

ipcMain.handle('ai:runGoal', async (evt, goal) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  const token = await getAiToken(); // null until your endpoint exists

  const snapshot = await win.webContents.executeJavaScript(`(function(){
    const text = document.body.innerText.slice(0,12000);
    const url = location.href; const title = document.title;
    return { url, title, text };
  })()`);

  // TODO: POST {goal, snapshot} to your backend /api/ai/run with Bearer token, then:
  // const plan = await fetch(...).then(r => r.json());
  // await runSteps(win, plan.steps);

  return { ok: !!token, note: token ? "Token ready" : "Stub: implement /api/ai/run" };
});

OpenAI: use gpt-4.1-mini for planning. Keep API key server-side.
