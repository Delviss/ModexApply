/**
 * DOM helpers.
 *
 * Everything renders through `h()`, which sets text through `textContent` and
 * never assembles markup from strings. That is not a style preference: the
 * admin consoles below take free text from whoever is entering a university,
 * store it in the browser and render it back on the public pages, so a template
 * built by concatenation would be a stored-XSS hole in the one surface that
 * exists to be trusted.
 */

export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = String(value);
    else if (key === 'html') throw new Error('Refused: build nodes, do not paste markup.');
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') {
      element[key] = value;
    } else element.setAttribute(key, value === true ? '' : String(value));
  }
  append(element, children);
  return element;
}

export function append(parent, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export const frag = (...children) => append(document.createDocumentFragment(), children);
export const clear = (node) => { while (node.firstChild) node.firstChild.remove(); return node; };

/** An in-app link. Hash routing, so a deep link survives a static host. */
export function link(href, text, props = {}) {
  return h('a', { href: `#${href}`, ...props }, text);
}

export function button(text, onClick, variant = 'secondary', props = {}) {
  return h('button', { type: 'button', class: `btn btn-${variant}`, onClick, ...props }, text);
}

export function badge(text, tone = 'neutral', title) {
  return h('span', { class: `badge badge-${tone}`, ...(title ? { title } : {}) }, text);
}

export function card(...children) {
  return h('section', { class: 'card' }, ...children);
}

export function notice(tone, ...children) {
  return h('p', { class: `notice notice-${tone}` }, ...children);
}

export function empty(message, action) {
  return h('div', { class: 'empty' }, h('p', {}, message), action);
}

export function kpi(label, value, sub) {
  return h('div', { class: 'card kpi' },
    h('span', { class: 'label' }, label),
    h('span', { class: 'value' }, value),
    sub ? h('span', { class: 'small muted' }, sub) : null);
}

export function field(label, control, hint) {
  return h('label', { class: 'field' }, label, hint ? h('span', { class: 'hint' }, hint) : null, control);
}

export function table(headers, rows) {
  return h('div', { class: 'table-scroll' },
    h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, headers.map((header) =>
        h('th', { class: header.numeric ? 'numeric' : null, scope: 'col' }, header.label ?? header)))),
      h('tbody', {}, rows.map((row) => h('tr', {}, row.map((cell, index) =>
        h('td', { class: headers[index]?.numeric ? 'numeric' : null },
          cell instanceof Node || cell === null ? cell : String(cell))))))));
}

// --- Formatting -------------------------------------------------------------

export function money(minor, currency, options = {}) {
  if (minor === null || minor === undefined || currency === null) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
    ...options,
  }).format(minor / 100);
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const DATETIME = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const formatDate = (value) => (value ? DATE.format(new Date(value)) : '—');
export const formatDateTime = (value) => (value ? DATETIME.format(new Date(value)) : '—');

export function relativeDays(value, now = new Date()) {
  if (!value) return null;
  return Math.round((new Date(value).getTime() - now.getTime()) / 86_400_000);
}

export function countdown(value, now = new Date()) {
  const days = relativeDays(value, now);
  if (days === null) return '—';
  if (days < 0) return `${Math.abs(days)} days ago`;
  if (days === 0) return 'today';
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

export const titleCase = (value) =>
  String(value).replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());

// --- Feedback ---------------------------------------------------------------

export function toast(message) {
  const host = document.getElementById('toast-host');
  if (host === null) return;
  const node = h('output', { class: 'toast' }, message);
  host.append(node);
  setTimeout(() => node.remove(), 4200);
}

/** A confirmation sheet. Resolves true only on the affirmative action. */
export function confirmDialog({ title, body, confirmLabel = 'Confirm', tone = 'primary' }) {
  return new Promise((resolve) => {
    let answered = false;
    const sheet = h('dialog', { 'aria-labelledby': 'dialog-title' },
      h('div', { class: 'body' },
        h('h2', { id: 'dialog-title' }, title),
        typeof body === 'string' ? h('p', { class: 'muted' }, body) : body,
        h('div', { class: 'row', style: 'justify-content:flex-end' },
          button('Cancel', () => sheet.close(), 'ghost'),
          button(confirmLabel, () => { answered = true; sheet.close(); }, tone))));
    sheet.addEventListener('close', () => { sheet.remove(); resolve(answered); });
    document.body.append(sheet);
    sheet.showModal();
  });
}

/** Downloads generated JSON. The admin export is the path back into the repo. */
export function downloadJson(filename, payload) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = h('a', { href: url, download: filename });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
