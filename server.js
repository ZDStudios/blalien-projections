#!/usr/bin/env node
/*
 * Blalien Projections: local network server (no dependencies, Node 16+).
 *   node server.js [port] [--open]
 * Serves the app, stores uploads in ./media, keeps the show in ./data/state.json,
 * and live-syncs every connected browser (phones, laptops, projector) over SSE.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const ROOT = __dirname;
const MEDIA = path.join(ROOT, 'media');
const DATA = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA, 'state.json');
const args = process.argv.slice(2);
let PORT = parseInt(process.env.PORT || args.find((a) => /^\d+$/.test(a)) || '8080', 10);
const OPEN = args.includes('--open');

for (const d of [MEDIA, DATA]) fs.mkdirSync(d, { recursive: true });

let state = null;
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { /* first run */ }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg', '.mkv': 'video/x-matroska',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|ogv|mkv)$/i;

function lanUrls(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if ((i.family === 'IPv4' || i.family === 4) && !i.internal) out.push(`http://${i.address}:${port}/`);
    }
  }
  out.push(`http://localhost:${port}/`);
  return out;
}

// ------------------------------------------------------------ live sync (Server-Sent Events)
const clients = new Set();
function sse(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(event, data) { for (const c of clients) sse(c, event, data); }
function peers() { broadcast('peers', { n: clients.size }); }
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 20000);

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(state), (err) => { if (!err) fs.rename(tmp, STATE_FILE, () => {}); });
  }, 400);
}

// ------------------------------------------------------------ helpers
function send(res, code, body, type = 'application/json') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(data);
}
function readBody(req, limit = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': file.startsWith(MEDIA) ? 'public, max-age=31536000' : 'no-cache' };
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (m && !m[1] && m[2]) { start = st.size - parseInt(m[2], 10); end = st.size - 1; }
      if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, Object.assign(headers, { 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 }));
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, Object.assign(headers, { 'Content-Length': st.size }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}
const safeName = (n) => String(n || 'file').replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '').slice(-80) || 'file';

// ------------------------------------------------------------ routes
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://local'); } catch (e) { return send(res, 400, 'Bad request', 'text/plain'); }
  const p = decodeURIComponent(url.pathname);

  try {
    if (p === '/api/info') return send(res, 200, { server: 'blalien', version: 1, urls: lanUrls(PORT), port: PORT });

    if (p === '/api/state' && req.method === 'GET') return send(res, 200, state || {});
    if (p === '/api/state' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!body || !body.state || !Array.isArray(body.state.surfaces)) return send(res, 400, { error: 'bad state' });
      state = body.state;
      broadcast('state', { from: body.from, state });
      saveSoon();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/msg' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 1024 * 1024));
      broadcast('msg', body);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 1500\n\n');
      clients.add(res);
      peers();
      req.on('close', () => { clients.delete(res); peers(); });
      return;
    }
    if (p === '/api/upload' && req.method === 'POST') {
      const name = safeName(url.searchParams.get('name'));
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const file = `${id}-${name}`;
      const dest = path.join(MEDIA, file);
      const out = fs.createWriteStream(dest);
      req.pipe(out);
      out.on('finish', () => {
        const kind = VIDEO_EXT.test(name) || /^video\//.test(req.headers['content-type'] || '') ? 'video' : 'image';
        console.log(`  + uploaded ${name} (${(out.bytesWritten / 1048576).toFixed(1)} MB)`);
        send(res, 200, { id, file, url: 'media/' + encodeURIComponent(file), kind });
      });
      out.on('error', (e) => send(res, 500, { error: e.message }));
      req.on('aborted', () => { out.destroy(); fs.unlink(dest, () => {}); });
      return;
    }
    if (p === '/api/media' && req.method === 'GET') {
      return send(res, 200, fs.readdirSync(MEDIA).filter((f) => !f.startsWith('.')));
    }
    if (p === '/api/media' && req.method === 'DELETE') {
      const f = path.basename(url.searchParams.get('file') || '');
      if (f) fs.unlink(path.join(MEDIA, f), () => {});
      return send(res, 200, { ok: true });
    }

    // static files
    let rel = p === '/' ? '/index.html' : p;
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep) || /[\\/]\./.test(rel) || file.startsWith(DATA) || /server\.js$/.test(file)) {
      return send(res, 403, 'Forbidden', 'text/plain');
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) return serveFile(req, res, path.join(file, 'index.html'));
    return serveFile(req, res, file);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
});
server.requestTimeout = 0;   // big video uploads over slow Wi-Fi
server.headersTimeout = 60000;

function start() {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE') { console.log(`Port ${PORT} busy, trying ${PORT + 1}…`); PORT++; start(); }
    else throw e;
  });
  server.listen(PORT, '0.0.0.0', () => {
    const urls = lanUrls(PORT);
    const lan = urls.filter((u) => !u.includes('localhost'));
    console.log('\n  \x1b[95mBlalien Projections\x1b[0m is running\n');
    console.log(`  This computer:     \x1b[96mhttp://localhost:${PORT}/\x1b[0m`);
    lan.forEach((u) => console.log(`  On your network:   \x1b[96m${u}\x1b[0m`));
    console.log(`  Projector output:  ${(lan[0] || urls[0])}?output`);
    console.log('\n  Open the link on any phone or laptop on the same Wi-Fi to control it.');
    console.log('  Press Ctrl+C to stop.\n');
    if (OPEN) {
      const u = `http://localhost:${PORT}/`;
      const cmd = process.platform === 'win32' ? `start "" "${u}"` : process.platform === 'darwin' ? `open "${u}"` : `xdg-open "${u}"`;
      exec(cmd, () => {});
    }
  });
}
start();
