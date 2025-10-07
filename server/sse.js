const clients = new Set();

export function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`event: hello\ndata: "connected"\n\n`);

  const client = { res };
  clients.add(client);
  req.on('close', () => clients.delete(client));
}

export function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const { res } of clients) {
    try { res.write(data); } catch {}
  }
}
