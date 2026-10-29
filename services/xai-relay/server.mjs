import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { bridge, createTicketConsumer } from './bridge.mjs';
import { relayConfiguration } from './config.mjs';

const { secret, key, audience, origins } = relayConfiguration(process.env);
const consume = createTicketConsumer();
const server = createServer((req, res) => {
  res.writeHead(req.url === '/health' ? 200 : 404, {
    'Cache-Control': 'no-store'
  });
  res.end();
});
const sockets = new WebSocketServer({
  noServer: true,
  maxPayload: 16_384,
  perMessageDeflate: false
});
server.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin;
  if (
    request.url !== '/stt' ||
    !origins.has(origin) ||
    sockets.clients.size >= 32
  ) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  sockets.handleUpgrade(request, socket, head, (client) => {
    bridge(client, {
      origin,
      audience,
      secret,
      key,
      consume,
      dial: (target, options) => new WebSocket(target, options)
    });
  });
});
server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
// No request, frame, audio, transcript, credential or provider-error logging.
process.on('SIGTERM', () => {
  for (const client of sockets.clients) client.terminate();
  server.close();
});
