// Cloudflare Pages Function：LeoP2P 信令反代 + 域名白名单
// 部署：放在 Cloudflare Pages 项目根目录 /functions/signal.js
// 作用：https://p.vkk.kdns.fr/signal/*  ->  wss 代理到 KataBump 信令 ws://51.75.118.79:20065/signal/*
//       非白名单域名发起的请求一律 403

// ===== 允许使用信令的域名（白名单）=====
const ALLOWED_ORIGINS = [
  'https://p.vkk.kdns.fr',
  'https://vkk.kdns.fr',
  'http://localhost',
  'https://leolee.l.cd', // 旧主机前端兜底（如仍在使用）
];

// ===== KataBump 信令上游 =====
const UPSTREAM_HOST = '51.75.118.79';
const UPSTREAM_PORT = '20065';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // 只代理 /signal 路径，其余走静态资源
  if (!url.pathname.startsWith('/signal')) {
    return context.next();
  }

  // 白名单校验：浏览器 WS 握手必带 Origin 头（JS 无法伪造）
  const origin = request.headers.get('Origin') || request.headers.get('Referer') || '';
  const allowed = ALLOWED_ORIGINS.some(
    (o) => origin === o || origin.startsWith(o + '/')
  );
  if (!allowed) {
    return new Response('Forbidden: origin not allowed', { status: 403 });
  }

  // 转发到 KataBump（https/wss -> http/ws）
  const upstream = new URL(request.url);
  upstream.protocol = 'ws:';
  upstream.hostname = UPSTREAM_HOST;
  upstream.port = UPSTREAM_PORT;

  return fetch(new Request(upstream, request));
}
