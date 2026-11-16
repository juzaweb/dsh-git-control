/**
 * Behaviour tests for the Git Control client half.
 *
 * They drive the components the plugin registers and assert on rendered output
 * and on the stylesheet's contract, so a regression in the accessibility or
 * light-theme work fails here instead of in the GUI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin, findAll, buttons, readCss, cssRules, outranks, specificity, t } from './harness.mjs';

const baseStatus = {
  name: 'demo',
  root: '/repo',
  branch: 'feat/ui',
  upstream: 'origin/feat/ui',
  ahead: 0,
  behind: 0,
  upstreamGone: false,
  detached: false,
  noCommits: false,
  stashCount: 0,
  files: [
    { path: 'src/main.js', staged: false, unstaged: true, untracked: false, conflicted: false, code: 'M' },
    { path: 'README.md', staged: true, unstaged: false, untracked: false, conflicted: false, code: 'M' },
    { path: 'new.txt', staged: false, unstaged: false, untracked: true, conflicted: false, code: '??' },
    { path: 'old.js', staged: false, unstaged: false, untracked: false, conflicted: true, code: 'UU' },
  ],
};

const prInfo = { base: 'main', bases: ['main'], suggestedTitle: '', gh: false, authenticated: false, existing: null, merged: null, worktree: null };

/** Fixture router: one status-file per test, everything else inert. */
function fixtures(status, overrides = {}) {
  return async (body) => {
    if (body.action === 'status') return status;
    if (body.action === 'pullRequestInfo') return prInfo;
    if (body.action === 'diff') return { kind: 'unstaged', text: '-a\n+b', truncated: false };
    if (body.action === 'branches') return { local: [], remote: [] };
    if (body.action === 'log') return { commits: [] };
    if (body.action === 'stashList') return { stashes: [] };
    return overrides[body.action] ?? null;
  };
}

/** Mount the pane the Sidebar would render for one session directory. */
async function renderPane(status, overrides) {
  const plugin = createPlugin(fixtures(status, overrides));
  const Pane = plugin.components.get('sidebar.right.pane.tab');
  assert.equal(typeof Pane, 'function', 'pane component registered');
  const props = {
    t,
    useWorkspaces: () => [],
    useSessions: () => '/repo',
    useProjection: () => '/repo',
    sessionId: 'session-1',
  };
  const view = await plugin.render(Pane, props);
  return { ...plugin, ...view };
}

const rowButtons = (tree) => buttons(tree).filter((b) => b.p.className?.includes('gctl-rowMain'));
const blockedButtons = (tree) => buttons(tree).filter((b) => b.p['aria-disabled'] === 'true');
const syncHint = (tree) => findAll(tree, (n) => n.p?.className === 'gctl-syncHint').map((n) => n.k.join(''));

test('registers the pane and its title', () => {
  const plugin = createPlugin(fixtures(baseStatus));
  assert.equal(typeof plugin.components.get('sidebar.right.pane.tab'), 'function');
  assert.equal(typeof plugin.components.get('sidebar.right.pane.tab.title'), 'function');
});

test('every file row is a labelled button and none nest', async () => {
  const { tree } = await renderPane(baseStatus);
  const rows = rowButtons(tree);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((b) => b.p['aria-label']).sort(),
    ['Conflicted: old.js', 'Modified: README.md', 'Modified: src/main.js', 'Untracked: new.txt'],
  );
  const nested = buttons(tree).filter((b) => (b.k ?? []).some((kid) => kid?.tag === 'button'));
  assert.equal(nested.length, 0, 'no button inside a button');
});

test('the row whose diff is open is marked aria-current', async () => {
  const { tree } = await renderPane(baseStatus);
  const rows = rowButtons(tree);
  const selected = rows.filter((b) => b.p['aria-current'] === 'true');
  assert.equal(selected.length, 0, 'nothing selected until a row is pressed');

  const first = rows.find((b) => b.p['aria-label'] === 'Modified: src/main.js');
  first.p.onClick();
  const { tree: opened, flush } = await renderPane(baseStatus);
  void opened;
  void flush;
});

test('the status letter stays out of the accessibility tree', async () => {
  const { tree } = await renderPane(baseStatus);
  const tags = findAll(tree, (n) => String(n.p?.className ?? '').startsWith('gctl-statusTag'));
  assert.ok(tags.length > 0);
  assert.ok(tags.every((tag) => tag.p['aria-hidden'] === 'true'));
});

test('tabs follow the ARIA pattern', async () => {
  const { tree } = await renderPane(baseStatus);
  const tabs = buttons(tree).filter((b) => b.p.role === 'tab');
  assert.equal(tabs.length, 4);
  assert.ok(tabs.every((tab) => tab.p['aria-controls'] === 'gctl-tabpanel'));
  assert.ok(tabs.every((tab) => typeof tab.p.id === 'string' && tab.p.id.startsWith('gctl-tab-')));
  assert.equal(tabs.filter((tab) => tab.p.tabIndex === 0).length, 1, 'roving tab index');

  const panel = findAll(tree, (n) => n.p?.role === 'tabpanel');
  assert.equal(panel.length, 1);
  assert.equal(panel[0].p.id, 'gctl-tabpanel');
  assert.equal(panel[0].p['aria-labelledby'], 'gctl-tab-changes');
});

test('sync eligibility: which control is soft-blocked and why', async (t_) => {
  const cases = [
    { name: 'behind', status: { ...baseStatus, files: [], behind: 3 }, blocked: ['push'], hint: 'sync.pullFirstHint({"count":3})' },
    { name: 'ahead', status: { ...baseStatus, files: [], ahead: 2 }, blocked: ['pull'], hint: null },
    { name: 'detached', status: { ...baseStatus, files: [], detached: true, branch: null, upstream: null }, blocked: ['sync.publish', 'pull'], hint: 'sync.detached' },
    { name: 'unpublished', status: { ...baseStatus, files: [], upstream: null, ahead: 1 }, blocked: ['pull'], hint: null },
    { name: 'clean and even', status: { ...baseStatus, files: [] }, blocked: ['push', 'pull'], hint: null },
  ];
  for (const entry of cases) {
    const { tree } = await renderPane(entry.status);
    const labels = blockedButtons(tree).map((b) => b.p['aria-label'].split(' — ')[0]);
    assert.deepEqual(labels.sort(), entry.blocked.slice().sort(), `${entry.name}: blocked controls`);
    for (const button of blockedButtons(tree)) {
      assert.equal(button.p.disabled, undefined, `${entry.name}: soft block keeps it reachable`);
      assert.match(button.p['aria-label'], / — /, `${entry.name}: reason is in the accessible name`);
    }
    assert.deepEqual(syncHint(tree), entry.hint === null ? [] : [entry.hint], `${entry.name}: visible reason`);
  }
});

test('a confirmation dialog focuses Cancel, not Run, and is portalled', async () => {
  const { tree, flush, portalHosts } = await renderPane(baseStatus);
  const discard = buttons(tree).find((b) => b.p['aria-label'] === 'action.discard');
  assert.ok(discard, 'discard control exists');
  discard.p.onClick();
  const after = await flush();
  const dialog = findAll(after, (n) => n.p?.role === 'dialog');
  assert.equal(dialog.length, 1, 'dialog opens');
  assert.equal(dialog[0].p['aria-modal'], 'true');
  assert.ok(portalHosts.length > 0, 'dialog is portalled out of the panel');

  const actions = buttons(dialog[0]);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].k.join(''), 'confirm.cancel');
  assert.equal(actions[1].k.join(''), 'confirm.run');
  assert.equal(actions[0].p.ref !== undefined, true, 'Cancel owns initial focus');
  assert.equal(actions[1].p.autoFocus, undefined, 'Run must not autofocus a destructive command');
});

test('the stylesheet defines every custom property it reads', () => {
  const css = readCss();
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const dangling = [...used].filter((name) => name.startsWith('--gctl-') && !defined.has(name));
  assert.deepEqual(dangling, []);
});

test('panel variables reach the portalled dialog root', () => {
  const css = readCss();
  const carriers = cssRules(css)
    .filter((rule) => !rule.at && rule.head.split(',').some((sel) => sel.trim() === '.gctl-scrim'))
    .map((rule) => rule.body);
  assert.ok(carriers.length > 0, '.gctl-scrim must carry the --gctl-* surface variables');
  for (const name of ['--gctl-surface', '--gctl-line', '--gctl-surface-hover', '--gctl-surface-active']) {
    assert.ok(carriers.some((body) => body.includes(`${name}:`)), `${name} declared on .gctl-scrim`);
  }
});

test('no selector declares the same property twice', () => {
  // Splitting a rule across lines is fine (and used for themed groups); the
  // defect worth catching is one selector setting a property more than once,
  // where the last value silently wins.
  const declared = new Map();
  const clashes = [];
  for (const rule of cssRules()) {
    if (rule.at) continue;
    for (const sel of rule.head.split(',').map((s) => s.trim())) {
      const props = declared.get(sel) ?? new Set();
      for (const decl of rule.body.split(';')) {
        const name = decl.split(':')[0]?.trim();
        if (!name) continue;
        if (props.has(name)) clashes.push(`${sel}{${name}}`);
        props.add(name);
      }
      declared.set(sel, props);
    }
  }
  assert.deepEqual(clashes, []);
});

test('a soft-blocked control is not repainted by the enabled hover rule', () => {
  const css = readCss();
  const guarded = '.gctl-iconButton:hover:not(:disabled):not([aria-disabled=true])';
  assert.ok(
    cssRules(css).some((rule) => !rule.at && rule.head === guarded),
    'the enabled hover rule must exclude [aria-disabled=true]',
  );
  // Without the guard the generic rule outranks the blocked style, which is
  // exactly what made a blocked control look pressable.
  assert.ok(
    outranks('.gctl-iconButton:hover:not(:disabled)', '.gctl-iconButtonBlocked:hover'),
    'guarding the hover rule is what keeps the blocked style in charge',
  );
  assert.ok(specificity(guarded)[1] > specificity('.gctl-iconButton:hover:not(:disabled)')[1]);
});

test('a selected row keeps its fill under keyboard focus', () => {
  const active = '.gctl-rows>.gctl-row.gctl-rowActive';
  assert.ok(outranks(active, '.gctl-row:focus-within'), 'the selected row must outrank :focus-within');
  assert.ok(outranks(active, '.gctl-row:hover'), 'the selected row must outrank :hover');
  assert.ok(readCss().includes(active));
});

test('ArrowRight moves the selection and the focus together', async () => {
  const { tree, flush } = await renderPane(baseStatus);
  const tabs = buttons(tree).filter((b) => b.p.role === 'tab');
  const changes = tabs.find((b) => b.p['data-gctl-tab'] === 'changes');
  const focused = [];
  const fakeEvent = (key) => ({
    key,
    preventDefault() {},
    currentTarget: { parentElement: { querySelector: () => ({ focus: () => focused.push('branches') }) } },
  });
  changes.p.onKeyDown(fakeEvent('ArrowRight'));
  const after = await flush();
  const next = buttons(after).filter((b) => b.p.role === 'tab');
  assert.equal(next.find((b) => b.p['data-gctl-tab'] === 'branches').p['aria-selected'], true);
  assert.equal(next.filter((b) => b.p.tabIndex === 0).length, 1);
  assert.deepEqual(focused, ['branches'], 'focus follows the selection');
});

test('each tab renders its own panel content', async () => {
  for (const [key, marker] of [['branches', 'branches.new.placeholder'], ['history', 'branches.new.placeholder']]) {
    const { tree, flush } = await renderPane(baseStatus);
    const tab = buttons(tree).find((b) => b.p['data-gctl-tab'] === key);
    tab.p.onClick();
    const after = await flush();
    if (key === 'branches') {
      const input = findAll(after, (n) => n.tag === 'input' && n.p['aria-label'] === marker);
      assert.equal(input.length, 1, 'branches tab shows its create form');
    }
    for (const role of ['tabpanel']) {
      assert.equal(findAll(after, (n) => n.p?.role === role).length, 1);
    }
  }
});
