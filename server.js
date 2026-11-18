'use strict';

/**
 * Product Inventory server (Node.js built-in modules only, no npm install needed).
 *
 *   GET    /api/products        list products   (?search=pen&category=Stationery)
 *   POST   /api/products        create a product
 *   GET    /api/products/:id    read one product
 *   PUT    /api/products/:id    update a product
 *   DELETE /api/products/:id    delete a product
 *
 * Everything else is served from the /public folder.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createStore, AppError } = require('./src/store');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readJson(req, limit = 100_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        reject(new AppError(413, 'The request is too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new AppError(400, 'The request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(store, req, res, url) {
  const match = url.pathname.match(/^\/api\/products(?:\/(\d+))?\/?$/);
  if (!match) throw new AppError(404, 'API route not found.');

  const id = match[1] ? Number(match[1]) : null;
  const { method } = req;

  if (id === null) {
    if (method === 'GET') {
      return sendJson(
        res,
        200,
        store.list({
          search: url.searchParams.get('search') || '',
          category: url.searchParams.get('category') || '',
        })
      );
    }
    if (method === 'POST') {
      const product = store.create(await readJson(req));
      res.setHeader('Location', `/api/products/${product.id}`);
      return sendJson(res, 201, product);
    }
    res.setHeader('Allow', 'GET, POST');
    throw new AppError(405, 'Method not allowed.');
  }

  if (method === 'GET') return sendJson(res, 200, store.get(id));
  if (method === 'PUT') return sendJson(res, 200, store.update(id, await readJson(req)));
  if (method === 'DELETE') {
    store.remove(id);
    res.writeHead(204);
    return res.end();
  }
  res.setHeader('Allow', 'GET, PUT, DELETE');
  throw new AppError(405, 'Method not allowed.');
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError(405, 'Method not allowed.');

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new AppError(400, 'Bad request.');
  }
  if (pathname.includes('\0')) throw new AppError(400, 'Bad request.');
  if (pathname.endsWith('/')) pathname += 'index.html';

  // Block path traversal such as /..%2Fserver.js
  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) throw new AppError(403, 'Forbidden.');

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return sendText(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

function createApp({ dataFile, seedFile } = {}) {
  if (!dataFile) throw new Error('createApp needs a dataFile path.');

  // First run: copy the sample products into the live data file.
  if (seedFile && !fs.existsSync(dataFile) && fs.existsSync(seedFile)) {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.copyFileSync(seedFile, dataFile);
  }

  const store = createStore(dataFile);

  return http.createServer(async (req, res) => {
    setSecurityHeaders(res);
    const isApi = req.url.startsWith('/api/');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (isApi) await handleApi(store, req, res, url);
      else serveStatic(req, res, url);
    } catch (err) {
      if (res.headersSent) return res.destroy();
      if (err instanceof AppError) {
        if (isApi) return sendJson(res, err.status, { error: err.message, fields: err.fields });
        return sendText(res, err.status, err.message);
      }
      console.error(err);
      if (isApi) return sendJson(res, 500, { error: 'Something went wrong on the server.' });
      return sendText(res, 500, 'Something went wrong on the server.');
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const dataFile = process.env.DATA_FILE || path.join(__dirname, 'data', 'products.json');
  const seedFile = path.join(__dirname, 'data', 'seed.json');

  const server = createApp({ dataFile, seedFile });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Stop the other app or run: PORT=4000 npm start`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(`Product inventory is running at http://localhost:${port}`);
  });
}

module.exports = { createApp };
