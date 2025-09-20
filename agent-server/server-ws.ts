// WebSocket AG-UI test server
// WS stream:  ws://localhost:3030/ag-ui/stream
// Results:    POST http://localhost:3030/ag-ui/tool_result
import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3030;

// Store connected clients
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ag-ui/stream' });

wss.on('connection', (ws) => {
  console.log('[WS] client connected');
  ws.on('close', () => console.log('[WS] client disconnected'));
});

// Accept tool_result from the renderer
app.post('/ag-ui/tool_result', (req, res) => {
  console.log('[RESULT]', JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// Helper: broadcast a tool_call to all clients
function broadcastToolCall(name: string, args: any = {}) {
  const msg = { type: 'tool_call', name, call_id: `tc-${Date.now()}`, args };
  const data = JSON.stringify(msg);
  wss.clients.forEach((client: any) => {
    if (client.readyState === 1) client.send(data);
  });
  console.log('[SEND]', data);
}

// Demo: every 12s ask for getLocation
setInterval(() => broadcastToolCall('getLocation'), 12000);

// Optional: send manual calls via HTT
