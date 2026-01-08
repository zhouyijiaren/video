'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, 'client');
const port = process.env.PORT ? Number(process.env.PORT) : 8080;

const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const safePath = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.join(rootDir, safePath);

  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {'Content-Type': mime[ext] || 'application/octet-stream'});
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`client static server on :${port}`);
});
