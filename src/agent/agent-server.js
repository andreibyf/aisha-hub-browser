
// src/agent/agent-server.js - starter local agent bridge
// Usage: npm run agent -> POST actions to http://127.0.0.1:4477/act
const http = require('http');
const { BrowserWindow } = require('electron'); // will be undefined if run separately
let winRef = null;

// Try to grab the first BrowserWindow if running inside the app
try {
  const all = BrowserWindow.getAllWindows();
  if (all && all.length) winRef = all[0];
} catch {}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/act') {
    let body=''; req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { action, selector, text, idx } = JSON.parse(body);
        if (!winRef) throw new Error("No BrowserWindow available");
        const code = (() => {
          if (action === 'click') return `agent.click(${JSON.stringify(selector)}, ${idx||0})`;
          if (action === 'type')  return `agent.type(${JSON.stringify(selector)}, ${JSON.stringify(text||'')}, ${idx||0})`;
          if (action === 'readText') return `agent.readText(${JSON.stringify(selector)}, ${idx||0})`;
          if (action === 'goto') return `agent.goto(${JSON.stringify(text||selector||'https://hub.aishacrm.app')})`;
          return 'false';
        })();
        const result = await winRef.webContents.executeJavaScript(code);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: true, result }));
      } catch (e) {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
  } else {
    res.writeHead(200, {'Content-Type':'text/plain'});
    res.end("POST /act with {action, selector, text, idx}");
  }
});

server.listen(4477, '127.0.0.1', ()=>{
  console.log("Agent bridge listening on http://127.0.0.1:4477/act");
});
