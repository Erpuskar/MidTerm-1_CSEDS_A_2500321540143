'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);

  /* ---------- State ---------- */

  const state = {
    products: [],
    loadError: null,
    search: '',
    category: '',
    sort: 'id-asc',
    view: localStorage.getItem('inventory-view') === 'table' ? 'table' : 'cards',
  };

  const SORTERS = {
    'id-asc': (a, b) => a.id - b.id,
    'id-desc': (a, b) => b.id - a.id,
    'name-asc': (a, b) => a.name.localeCompare(b.name),
    'price-asc': (a, b) => a.price - b.price,
    'price-desc': (a, b) => b.price - a.price,
  };

  /* ---------- Helpers ---------- */

  const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const rupeesWithPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatPrice = (value) => (Number.isInteger(value) ? rupees : rupeesWithPaise).format(value);

  // Builds a DOM element. Text is always added as text nodes, so product names can never inject HTML.
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === false || value == null) continue;
      if (key === 'class') node.className = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...children.filter((child) => child != null && child !== false));
    return node;
  }

  function hueFor(text) {
    let hue = 0;
    for (const ch of text.toLowerCase()) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
    return hue;
  }

  function categoryChip(category) {
    const chip = el('span', { class: 'chip', title: category }, category);
    chip.style.setProperty('--h', hueFor(category));
    return chip;
  }

  /* ---------- API (the C, R, U and D of CRUD) ---------- */

  class ApiError extends Error {
    constructor(message, status, fields) {
      super(message);
      this.status = status;
      this.fields = fields;
    }
  }

  async function request(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('The server isn’t responding. Start it with “npm start” and try again.', 0);
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || 'Something went wrong.', res.status, data.fields);
    return data;
  }

  const api = {
    list: () => request('GET', '/api/products'),
    create: (product) => request('POST', '/api/products', product),
    update: (id, product) => request('PUT', `/api/products/${id}`, product),
    remove: (id) => request('DELETE', `/api/products/${id}`),
  };

  async function loadProducts() {
    try {
      state.products = await api.list();
      state.loadError = null;
    } catch (err) {
      state.loadError = err.message;
    }
    render();
  }

  /* ---------- Rendering ---------- */

  function visibleProducts() {
    const query = state.search.trim().toLowerCase();
    return state.products
      .filter((p) => {
        if (state.category && p.category !== state.category) return false;
        if (!query) return true;
        return p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query) || String(p.id) === query;
      })
      .sort(SORTERS[state.sort]);
  }

  function actionButton(action, product, label) {
    return el(
      'button',
      {
        type: 'button',
        class: action === 'delete' ? 'btn-text danger' : 'btn-text',
        'data-action': action,
        'data-id': product.id,
        'aria-label': `${label} ${product.name}`,
      },
      label
    );
  }

  function productCard(p) {
    return el(
      'article',
      { class: 'card' },
      el('div', { class: 'card-top' }, el('span', { class: 'id' }, `ID ${p.id}`), categoryChip(p.category)),
      el('h2', { class: 'name' }, p.name),
      el(
        'div',
        { class: 'card-foot' },
        el('span', { class: 'price-tag' }, formatPrice(p.price)),
        el('div', { class: 'actions' }, actionButton('edit', p, 'Edit'), actionButton('delete', p, 'Delete'))
      )
    );
  }

  function productRow(p) {
    return el(
      'tr',
      {},
      el('td', { class: 'id' }, String(p.id)),
      el('td', {}, p.name),
      el('td', {}, categoryChip(p.category)),
      el('td', { class: 'num' }, formatPrice(p.price)),
      el('td', { class: 'cell-actions' }, actionButton('edit', p, 'Edit'), actionButton('delete', p, 'Delete'))
    );
  }

  function productTable(list) {
    return el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        {},
        el('caption', { class: 'sr-only' }, 'Products'),
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { scope: 'col' }, 'ID'),
            el('th', { scope: 'col' }, 'Name'),
            el('th', { scope: 'col' }, 'Category'),
            el('th', { scope: 'col', class: 'num' }, 'Price'),
            el('th', { scope: 'col', class: 'cell-actions' }, 'Actions')
          )
        ),
        el('tbody', {}, ...list.map(productRow))
      )
    );
  }

  function messageBox(title, text, buttons) {
    return el(
      'div',
      { class: 'empty' },
      el('h2', {}, title),
      el('p', {}, text),
      ...buttons.map((b) => el('button', { type: 'button', class: `btn ${b.primary ? 'btn-primary' : 'btn-secondary'}`, 'data-action': b.action }, b.label))
    );
  }

  function buildContent() {
    if (state.loadError) {
      return messageBox('Can’t load your products', state.loadError, [{ label: 'Try again', action: 'reload', primary: true }]);
    }
    if (state.products.length === 0) {
      return messageBox('No products yet', 'Add your first product to start your inventory.', [{ label: 'Add product', action: 'add', primary: true }]);
    }
    const list = visibleProducts();
    if (list.length === 0) {
      return messageBox('No matching products', 'Try a different search or choose another category.', [{ label: 'Clear filters', action: 'clear-filters' }]);
    }
    return state.view === 'table' ? productTable(list) : el('div', { class: 'grid' }, ...list.map(productCard));
  }

  function renderSummary() {
    const total = state.products.length;
    const categories = new Set(state.products.map((p) => p.category)).size;
    const shown = visibleProducts().length;
    let text;
    if (state.loadError) text = 'Products unavailable';
    else if (total === 0) text = 'No products yet';
    else if (shown !== total) text = `Showing ${shown} of ${total} products`;
    else text = `${total} ${total === 1 ? 'product' : 'products'} in ${categories} ${categories === 1 ? 'category' : 'categories'}`;
    $('#summary').textContent = text;
  }

  function renderCategoryOptions() {
    const categories = [...new Set(state.products.map((p) => p.category))].sort((a, b) => a.localeCompare(b));
    if (state.category && !categories.includes(state.category)) state.category = '';

    const select = $('#category-filter');
    select.replaceChildren(
      el('option', { value: '' }, 'All categories'),
      ...categories.map((c) => el('option', { value: c }, c))
    );
    select.value = state.category;

    $('#category-options').replaceChildren(...categories.map((c) => el('option', { value: c })));
  }

  function renderViewToggle() {
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
    });
  }

  function render() {
    renderCategoryOptions();
    renderViewToggle();
    renderSummary();
    $('#content').replaceChildren(buildContent());
  }

  /* ---------- Toast ---------- */

  let toastTimer;
  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 3000);
  }

  /* ---------- Add / edit dialog ---------- */

  const productDialog = $('#product-dialog');
  const form = $('#product-form');
  const inputs = { name: $('#field-name'), price: $('#field-price'), category: $('#field-category') };
  const saveButton = $('#save-button');
  let editingId = null;

  function clearFormErrors() {
    for (const [field, input] of Object.entries(inputs)) {
      input.removeAttribute('aria-invalid');
      $(`#error-${field}`).textContent = '';
    }
    $('#form-error').textContent = '';
  }

  function openProductForm(product) {
    editingId = product ? product.id : null;
    clearFormErrors();
    $('#form-title').textContent = product ? 'Edit product' : 'Add product';
    $('#form-id').textContent = product ? `ID ${product.id}` : 'An ID is assigned when you save.';
    saveButton.textContent = product ? 'Save changes' : 'Add product';
    inputs.name.value = product ? product.name : '';
    inputs.price.value = product ? product.price : '';
    inputs.category.value = product ? product.category : '';
    productDialog.showModal();
    inputs.name.focus();
  }

  function showFieldErrors(fields) {
    let firstInvalid = null;
    for (const [field, message] of Object.entries(fields)) {
      if (!inputs[field]) continue;
      inputs[field].setAttribute('aria-invalid', 'true');
      $(`#error-${field}`).textContent = message;
      firstInvalid = firstInvalid || inputs[field];
    }
    if (firstInvalid) firstInvalid.focus();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormErrors();
    const payload = { name: inputs.name.value, price: inputs.price.value, category: inputs.category.value };
    const wasEditing = editingId !== null;

    saveButton.disabled = true;
    try {
      if (wasEditing) await api.update(editingId, payload);
      else await api.create(payload);
      productDialog.close();
      toast(wasEditing ? 'Changes saved.' : 'Product added.');
      await loadProducts();
    } catch (err) {
      if (err.fields) showFieldErrors(err.fields);
      else $('#form-error').textContent = err.message;
    } finally {
      saveButton.disabled = false;
    }
  });

  $('#cancel-button').addEventListener('click', () => productDialog.close());

  /* ---------- Delete dialog ---------- */

  const deleteDialog = $('#delete-dialog');
  const deleteConfirm = $('#delete-confirm');
  let pendingDelete = null;

  function askToDelete(product) {
    pendingDelete = product;
    $('#delete-name').textContent = product.name;
    $('#delete-error').textContent = '';
    deleteDialog.showModal();
  }

  deleteConfirm.addEventListener('click', async () => {
    if (!pendingDelete) return;
    deleteConfirm.disabled = true;
    try {
      await api.remove(pendingDelete.id);
      deleteDialog.close();
      toast('Product deleted.');
      await loadProducts();
    } catch (err) {
      $('#delete-error').textContent = err.message;
    } finally {
      deleteConfirm.disabled = false;
    }
  });

  $('#delete-cancel').addEventListener('click', () => deleteDialog.close());

  /* ---------- Page events ---------- */

  $('#add-button').addEventListener('click', () => openProductForm(null));

  $('#content').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const product = state.products.find((p) => p.id === Number(button.dataset.id));

    switch (button.dataset.action) {
      case 'edit':
        if (product) openProductForm(product);
        break;
      case 'delete':
        if (product) askToDelete(product);
        break;
      case 'add':
        openProductForm(null);
        break;
      case 'reload':
        loadProducts();
        break;
      case 'clear-filters':
        clearFilters();
        break;
    }
  });

  function clearFilters() {
    state.search = '';
    state.category = '';
    $('#search').value = '';
    render();
  }

  $('#search').addEventListener('input', (event) => {
    state.search = event.target.value;
    render();
  });

  $('#category-filter').addEventListener('change', (event) => {
    state.category = event.target.value;
    render();
  });

  $('#sort').addEventListener('change', (event) => {
    state.sort = event.target.value;
    render();
  });

  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      localStorage.setItem('inventory-view', state.view);
      render();
    });
  });

  loadProducts();
})();
