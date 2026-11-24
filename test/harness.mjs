/**
 * Boot the client half of the plugin without a browser.
 *
 * `client.js` is a single-file module bundle: it registers a factory on
 * `window.__ModuleLoader__`, pulls React from the loader's `require`, and reads
 * the repository through `fetch`. The harness supplies all three — a small hook
 * runtime, a portal stub, and fixture-driven fetch — so tests drive the real
 * components and assert on what they render, never on plugin internals.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SOURCE = path.join(here, '..', 'client.js');

export const readSource = () => fs.readFileSync(SOURCE, 'utf8');

export function readCss() {
  const match = readSource().match(/const PAGE_CSS = `([\s\S]*?)`;/);
  if (match === null) throw new Error('PAGE_CSS not found in client.js');
  return match[1];
}

/** Split a stylesheet into top-level rules, keeping at-rule blocks verbatim. */
export function cssRules(css = readCss()) {
  const rules = [];
  let i = 0;
  while (i < css.length) {
    if (/\s/.test(css[i])) { i += 1; continue; }
    let j = i;
    while (j < css.length && css[j] !== '{') j += 1;
    if (j >= css.length) break;
    const head = css.slice(i, j).trim();
    let depth = 1;
    let k = j + 1;
    while (k < css.length && depth > 0) {
      if (css[k] === '{') depth += 1;
      else if (css[k] === '}') depth -= 1;
      k += 1;
    }
    rules.push({ head, body: css.slice(j + 1, k - 1).trim(), at: head.startsWith('@') });
    i = k;
  }
  return rules;
}

/** `[ids, classes-and-attributes-and-pseudo-classes, type selectors]` of a selector. */
export function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+/g) ?? []).length;
  const attrs = (selector.match(/\[[^\]]+\]/g) ?? []).length;
  const pseudo = (selector.match(/:(?!:)[\w-]+(\([^)]*\))?/g) ?? []).length;
  const notArgs = [...selector.matchAll(/:not\(([^)]*)\)/g)]
    .reduce((sum, m) => sum + (m[1].match(/\.[\w-]+/g) ?? []).length + (m[1].match(/\[[^\]]+\]/g) ?? []).length, 0);
  return [ids, classes + attrs + pseudo + notArgs, 0];
}

export const outranks = (a, b) => {
  const x = specificity(a);
  const y = specificity(b);
  for (let n = 0; n < 3; n += 1) {
    if (x[n] !== y[n]) return x[n] > y[n];
  }
  return false;
};

const h = (tag, props, ...kids) => {
  if (typeof tag === 'function') return tag(props ?? {});
  return { tag, p: props ?? {}, k: kids.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) };
};

/**
 * Evaluate the bundle once and expose the components `apply` registered plus a
 * `render` that drains effects and state updates to a stable tree.
 * @param fetchFixture - async (requestBody) => action payload.
 */
export function createPlugin(fetchFixture) {
  const portalHosts = [];
  const listeners = new Map();
  const fetched = [];
  const documentStub = {
    activeElement: { focus() {}, isConnected: true },
    body: { tag: 'BODY' },
    hidden: false,
    visibilityState: 'visible',
    querySelectorAll: () => [],
    addEventListener: (type, fn) => listeners.set(`doc:${type}`, fn),
    removeEventListener: (type) => listeners.delete(`doc:${type}`),
  };
  const windowStub = {
    __ModuleLoader__: { load: (mod) => { factory = mod.factory; } },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  let factory = null;

  globalThis.window = windowStub;
  globalThis.document = documentStub;
  globalThis.fetch = async (url, init) => {
    const body = init === undefined || init.body === undefined ? {} : JSON.parse(init.body);
    fetched.push(body);
    const data = await fetchFixture(body);
    return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
  };

  /* The panel polls on a timer; a no-op scheduler keeps tests deterministic. */
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};

  new Function('window', 'document', readSource())(windowStub, documentStub);
  if (factory === null) throw new Error('client.js did not register a factory');

  /* Hook state survives across re-renders of one mounted component. */
  let hooks = [];
  let cursor = 0;
  let dirty = false;
  let pending = [];
  const cleanups = [];

  const React = {
    createElement: h,
    Fragment: 'Fragment',
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      const slot = hooks[index];
      const set = (next) => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (value !== slot.value) { slot.value = value; dirty = true; }
      };
      return [slot.value, set];
    },
    useEffect(run, deps) {
      const index = cursor++;
      const slot = hooks[index] ?? { deps: undefined };
      hooks[index] = slot;
      const changed = slot.deps === undefined || deps === undefined
        || deps.length !== slot.deps.length
        || deps.some((dep, n) => dep !== slot.deps[n]);
      if (!changed) return;
      slot.deps = deps;
      pending.push(() => {
        const cleanup = run();
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      });
    },
    useRef(initial) {
      const index = cursor++;
      hooks[index] ??= { current: initial };
      return hooks[index];
    },
  };

  const plugin = factory((id) => {
    if (id === 'react') return React;
    if (id === 'react-dom') {
      return { createPortal: (element, host) => { portalHosts.push(host); return element; } };
    }
    throw new Error(`unexpected module: ${id}`);
  });

  const components = new Map();
  plugin.apply({
    effect: (run) => { if (typeof run === 'function') run(); },
    locale: { register: () => {}, bind: () => t },
    inject: (deps, run) => run({
      effect: (fn) => { if (typeof fn === 'function') fn(); },
      sidebarRightTabs: { register: () => {} },
    }),
    slots: {
      inject: (name, run) => { if (typeof run === 'function') run(); },
      register: (descriptor, component) => { components.set(descriptor.name, component); },
    },
  });

  /**
   * Mount one component and settle it.
   * @returns the rendered tree, `flush` to re-settle after an interaction, and
   * `update` to re-render the same mount with new props.
   */
  const render = async (component, props) => {
    hooks = [];
    cleanups.length = 0;
    let current = props;
    const settle = async () => {
      let tree = null;
      for (let pass = 0; pass < 50; pass += 1) {
        cursor = 0;
        dirty = false;
        pending = pending.slice();
        tree = h(component, current);
        while (pending.length > 0) pending.shift()();
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!dirty) break;
      }
      return tree;
    };
    const tree = await settle();
    const update = async (next) => {
      current = next;
      return settle();
    };
    return { tree, flush: settle, update };
  };

  return { plugin, components, render, portalHosts, listeners, fetched };
}

export function walk(node, visit) {
  if (node === null || typeof node !== 'object') return;
  visit(node);
  for (const kid of node.k ?? []) walk(kid, visit);
}

export function findAll(root, predicate) {
  const out = [];
  walk(root, (node) => { if (predicate(node)) out.push(node); });
  return out;
}

export const buttons = (root) => findAll(root, (n) => n.tag === 'button');
export const text = (node) => (node.k ?? []).filter((k) => typeof k === 'string').join('');
export const t = (key, vars) => (vars === undefined ? key : `${key}(${JSON.stringify(vars)})`);
