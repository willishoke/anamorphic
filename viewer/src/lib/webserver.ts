/**
 * Minimal HTTP server that serves the web UI and pushes state via SSE.
 * No dependencies beyond Node stdlib.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, '../web/index.html');

let clients: http.ServerResponse[] = [];
let cachedState = '{}';

export function createWebServer(port = 7777): http.Server {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(`data: ${cachedState}\n\n`);
      clients.push(res);
      req.on('close', () => { clients = clients.filter((c) => c !== res); });
      return;
    }

    if (req.url === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(cachedState);
      return;
    }

    fs.readFile(HTML_PATH, (err, data) => {
      if (err) { res.writeHead(500); res.end('web/index.html not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  });

  server.listen(port);
  return server;
}

export function pushState(state: unknown): void {
  cachedState = JSON.stringify(state);
  const msg = `data: ${cachedState}\n\n`;
  clients.forEach((c) => { try { c.write(msg); } catch { /* client gone */ } });
}
