// 极简静态文件服务器（零依赖），用于本地运行游戏。
// 用法: node server.js [端口]   环境变量 AUTO_OPEN=0 可关闭自动打开浏览器。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname);
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (e) {
    res.writeHead(500); res.end('Server Error');
  }
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    const url = `http://localhost:${PORT}`;
    console.log('');
    console.log(`  [OK] Port ${PORT} is already in use.`);
    console.log('  The game is probably already running - opening browser instead.');
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    }
    process.exit(0);
  }
  console.error('  [Error]', err.message);
  process.exit(1);
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('  ================================================');
  console.log('   VOXELSPACE - Voxel Space Game server started');
  console.log('   ' + url);
  console.log('  ================================================');
  console.log('   Press Ctrl+C to stop the server');
  if (process.env.AUTO_OPEN !== '0' && process.platform === 'win32') {
    // 用 stdio:'ignore' 启动浏览器，避免阻塞服务器
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
  }
});
