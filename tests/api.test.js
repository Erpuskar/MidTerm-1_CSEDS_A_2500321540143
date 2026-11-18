'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');

let server;
let base;
let tempDir;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-test-'));
  server = createApp({ dataFile: path.join(tempDir, 'products.json') });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function api(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

test('starts empty', async () => {
  const res = await api('GET', '/api/products');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test('creates a product with an auto ID and trims input', async () => {
  const res = await api('POST', '/api/products', { name: '  Wireless Mouse ', price: '599', category: ' Electronics ' });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: 1, name: 'Wireless Mouse', price: 599, category: 'Electronics' });
  assert.equal(res.headers.get('location'), '/api/products/1');
});

test('reuses the stored spelling of an existing category', async () => {
  const res = await api('POST', '/api/products', { name: 'USB-C Cable', price: 249.5, category: 'electronics' });
  assert.equal(res.status, 201);
  assert.equal(res.body.category, 'Electronics');
  assert.equal(res.body.price, 249.5);
});

test('reads one product and the full list', async () => {
  const one = await api('GET', '/api/products/1');
  assert.equal(one.status, 200);
  assert.equal(one.body.name, 'Wireless Mouse');

  const all = await api('GET', '/api/products');
  assert.deepEqual(all.body.map((p) => p.id), [1, 2]);
});

test('filters by search text and category', async () => {
  await api('POST', '/api/products', { name: 'Blue Pen', price: 10, category: 'Stationery' });

  const bySearch = await api('GET', '/api/products?search=cable');
  assert.deepEqual(bySearch.body.map((p) => p.name), ['USB-C Cable']);

  const byCategory = await api('GET', '/api/products?category=stationery');
  assert.deepEqual(byCategory.body.map((p) => p.name), ['Blue Pen']);

  const byId = await api('GET', '/api/products?search=1');
  assert.deepEqual(byId.body.map((p) => p.id), [1]);
});

test('updates a product and keeps its ID', async () => {
  const res = await api('PUT', '/api/products/1', { name: 'Wireless Mouse Pro', price: 799, category: 'Electronics' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { id: 1, name: 'Wireless Mouse Pro', price: 799, category: 'Electronics' });

  const again = await api('GET', '/api/products/1');
  assert.equal(again.body.price, 799);
});

test('deletes a product and never reuses its ID', async () => {
  const del = await api('DELETE', '/api/products/3');
  assert.equal(del.status, 204);

  const gone = await api('GET', '/api/products/3');
  assert.equal(gone.status, 404);

  const created = await api('POST', '/api/products', { name: 'Notebook', price: 85, category: 'Stationery' });
  assert.equal(created.body.id, 4);
});

test('rejects invalid input with field messages', async () => {
  const res = await api('POST', '/api/products', { name: '', price: 'abc', category: '' });
  assert.equal(res.status, 400);
  assert.deepEqual(Object.keys(res.body.fields).sort(), ['category', 'name', 'price']);

  const negative = await api('POST', '/api/products', { name: 'X', price: -5, category: 'Y' });
  assert.equal(negative.status, 400);
  assert.ok(negative.body.fields.price);
});

test('returns 404 for unknown products and routes', async () => {
  assert.equal((await api('PUT', '/api/products/999', { name: 'A', price: 1, category: 'B' })).status, 404);
  assert.equal((await api('DELETE', '/api/products/999')).status, 404);
  assert.equal((await api('GET', '/api/nothing')).status, 404);
});

test('rejects broken JSON and unsupported methods', async () => {
  const res = await fetch(base + '/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);

  const patch = await api('PATCH', '/api/products/1', {});
  assert.equal(patch.status, 405);
});

test('serves the frontend and blocks path traversal', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);

  const status = await new Promise((resolve, reject) => {
    const { port } = server.address();
    http
      .get({ host: '127.0.0.1', port, path: '/..%2Fserver.js' }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on('error', reject);
  });
  assert.equal(status, 403);
});
