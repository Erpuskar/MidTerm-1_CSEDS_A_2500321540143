'use strict';

/**
 * Product store: validation + CRUD on a single JSON file.
 *
 * File format:
 *   { "nextId": 9, "products": [ { "id": 1, "name": "...", "price": 120, "category": "..." } ] }
 *
 * `nextId` only ever goes up, so an ID is never reused after a delete.
 */

const fs = require('node:fs');
const path = require('node:path');

class AppError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const LIMITS = { name: 80, category: 40, maxPrice: 10_000_000 };

/** Checks user input and returns a clean { name, price, category }, or throws a 400 AppError. */
function validateProduct(input) {
  const body = input && typeof input === 'object' ? input : {};
  const fields = {};

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) fields.name = 'Enter a product name.';
  else if (name.length > LIMITS.name) fields.name = `Use ${LIMITS.name} characters or fewer.`;

  const category = typeof body.category === 'string' ? body.category.trim() : '';
  if (!category) fields.category = 'Enter a category.';
  else if (category.length > LIMITS.category) fields.category = `Use ${LIMITS.category} characters or fewer.`;

  let price = body.price;
  if (typeof price === 'string') price = price.trim() === '' ? NaN : Number(price);
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    fields.price = 'Enter the price as a number, for example 49.50.';
  } else if (price < 0) {
    fields.price = 'Price cannot be negative.';
  } else if (price > LIMITS.maxPrice) {
    fields.price = `Price cannot be more than ${LIMITS.maxPrice}.`;
  }

  if (Object.keys(fields).length > 0) {
    throw new AppError(400, 'Fix the highlighted fields and try again.', fields);
  }
  return { name, price: Math.round(price * 100) / 100, category };
}

function createStore(filePath) {
  function load() {
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return { nextId: 1, products: [] };
      throw err;
    }
    const data = JSON.parse(raw);
    const products = Array.isArray(data.products) ? data.products : [];
    const highestId = products.reduce((max, p) => Math.max(max, p.id), 0);
    return { nextId: Math.max(Number(data.nextId) || 1, highestId + 1), products };
  }

  // Write to a temp file, then rename, so a crash never leaves a half-written JSON file.
  function save(data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  }

  // "electronics" and "Electronics" should be one category: reuse the spelling already stored.
  function matchExistingCategory(products, category) {
    const existing = products.find((p) => p.category.toLowerCase() === category.toLowerCase());
    return existing ? existing.category : category;
  }

  function findIndex(products, id) {
    const index = products.findIndex((p) => p.id === id);
    if (index === -1) throw new AppError(404, 'Product not found.');
    return index;
  }

  return {
    list({ search = '', category = '' } = {}) {
      const query = search.trim().toLowerCase();
      return load()
        .products.filter((p) => {
          if (category && p.category.toLowerCase() !== category.toLowerCase()) return false;
          if (!query) return true;
          return (
            p.name.toLowerCase().includes(query) ||
            p.category.toLowerCase().includes(query) ||
            String(p.id) === query
          );
        })
        .sort((a, b) => a.id - b.id);
    },

    get(id) {
      const { products } = load();
      return products[findIndex(products, id)];
    },

    create(input) {
      const clean = validateProduct(input);
      const data = load();
      const product = {
        id: data.nextId,
        name: clean.name,
        price: clean.price,
        category: matchExistingCategory(data.products, clean.category),
      };
      data.products.push(product);
      data.nextId += 1;
      save(data);
      return product;
    },

    update(id, input) {
      const clean = validateProduct(input);
      const data = load();
      const index = findIndex(data.products, id);
      data.products[index] = {
        id,
        name: clean.name,
        price: clean.price,
        category: matchExistingCategory(data.products, clean.category),
      };
      save(data);
      return data.products[index];
    },

    remove(id) {
      const data = load();
      const index = findIndex(data.products, id);
      data.products.splice(index, 1);
      save(data);
    },
  };
}

module.exports = { createStore, validateProduct, AppError };
