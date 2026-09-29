'use strict';
// LeoP2P 零依赖信令服务器（PeerJS 协议兼容，无第三方包，node index.js 直接跑）
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 20065);
const PATH = '/signal';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ===== 域名白名单（防滥用）：只允许这些页面使用信令 =====
const ALLOWED_ORIGINS = [
  'https://p.vkk.kdns.fr',
  'https://vkk.kdns.fr',
  'http://localhost',
  'https://leolee.l.cd',
];

function originAllowed(req) {
  const o = req.headers['origin'] || req.headers['referer'] || '';
  if (!o) return false; // 无来源一律拒绝
  return ALLOWED_ORIGINS.some((a) => o === a || o.startsWith(a + '/'));
}

const peers = new Map(); // id -> socket

function genId() {
  return crypto.randomBytes(8).toString('hex').slice(0, 12);
}

function sendFrame(socket, opcode, payload) {
  payload = payload || Buffer.alloc(0);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function sendText(socket, text) {
  sendFrame(socket, 0x1, Buffer.from(text, 'utf8'));
}

function sendPong(socket) {
  sendFrame(socket, 0xA, Buffer.alloc(0));
}

function handleFrame(id, buf) {
  let i = 0;
  const opcode = buf[i] & 0x0f; i++;
  const masked = (buf[i] & 0x80) !== 0;
  let len = buf[i] & 0x7f; i++;
  if (len === 126) { len = buf.readUInt16BE(i); i += 2; }
  else if (len === 127) { len = Number(buf.readBigUInt64BE(i)); i += 8; }
  let mask;
  if (masked) { mask = buf.slice(i, i + 4); i += 4; }
  let payload = buf.slice(i, i + len);
  if (masked) {
    const out = Buffer.alloc(len);
    for (let j = 0; j < len; j++) out[j] = payload[j] ^ mask[j % 4];
    payload = out;
  }
  if (opcode === 8) { peers.delete(id); const s = peers.get(id); if (s) sendFrame(s, 0x8, Buffer.alloc(0)); return null; }  // close
  if (opcode === 9) { const s = peers.get(id); if (s) sendPong(s); return null; }  // ping -> pong
  if (opcode === 1) return payload.toString('utf8');  // text
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!originAllowed(req)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden: origin not allowed');
    return;
  }
  if (url.pathname === PATH + '/peerjs/id') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(genId());
    return;
  }
  res.writeHead(404);
  res.end();
});

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== PATH + '/peerjs') { socket.destroy(); return; }
  if (!originAllowed(req)) { socket.destroy(); console.log('[leo-signal] rejected (origin):', req.headers['origin'] || 'none'); return; }
  const id = url.searchParams.get('id');
  const pkey = url.searchParams.get('key');
  const secKey = req.headers['sec-websocket-key'];
  if (!id || !pkey || !secKey) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(secKey + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  peers.set(id, socket);
  sendText(socket, JSON.stringify({ type: 'OPEN' }));
  console.log('[leo-signal] connected:', id);
  socket.on('data', (d) => {
    const msg = handleFrame(id, d);
    if (msg === null) return;
    let parsed;
    try { parsed = JSON.parse(msg); } catch { return; }
    if (parsed.type === 'HEARTBEAT') { sendText(socket, JSON.stringify({ type: 'PONG' })); return; }
    if (parsed.type === 'OPEN') return;
    const dst = parsed.dst;
    if (dst && peers.has(dst)) {
      sendText(peers.get(dst), JSON.stringify(parsed));
    }
  });
  socket.on('close', () => { peers.delete(id); console.log('[leo-signal] disconnected:', id); });
  socket.on('error', () => { peers.delete(id); });
});

server.listen(PORT, () => {
  console.log('[leo-signal] running on ' + PORT + PATH);
});
