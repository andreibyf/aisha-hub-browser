import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3030;
let clients: express.Response[] = [];

// SSE stream
app.get('/ag-ui/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clients.push(res);
  req.on('close', () => {
    clients = clients.filter(c => c !== res);
  });
});

// Tool result endpoint
app.post('/ag-ui/tool_result', (req, res) => {
  console.log('Tool result:', req.body);
  res.sendStatus(200);
});

// Send fake tool_call every 10s
setInterval(() => {
  const call = {
    type: 'tool_call',
    name: 'getLocation',
    call_id: 'demo-' + Date.now(),
    args: {}
  };
  const data = `event: tool_call\ndata: ${JSON.stringify(call)}\n\n`;
  clients.forEach(c => c.write(data));
}, 10000);

app.listen(PORT, () => {
  console.log(`AG-UI test server running at http://localhost:${PORT}`);
});
