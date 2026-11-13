/**
 * Client half of the Git Control bundle.
 *
 * Registers the sidebar panel entry and the centre panel that render one
 * repository's changes, branches, history, and stashes, and drives every
 * operation through the Host route `ctx.connection.fetch` serves.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-git-control',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace owned by this panel. */
    const NS = 'gitControl';
    /** Right-Sidebar tab type identity: the registry id and its kind. */
    const TAB_ID = 'git-control';
    const TAB_KIND = 'git';
    /** Host route backing every operation. */
    const ENDPOINT = 'api/git-control';
    /** Rendered diff ceiling. */
    const MAX_RENDERED_LINES = 2000;
    /** History page step. */
    const LOG_STEP = 40;
    /** Polling interval when the panel is open and visible. */
    const POLL_INTERVAL_MS = 3000;

    const DICTIONARY = {
      'type.label': 'Git',
      'guide.title': 'Git control',
      'guide.description': 'Review, stage, and commit the changes in this session\'s directory, manage branches and stashes, and sync with the remote.',
      title: 'Git Control',
      working: 'Working…',
      refresh: 'Refresh',
      refreshHint: 'Re-read the repository state',
      repository: 'Repository',
      'repository.none': 'Open a workspace to select a repository.',
      'repository.empty': 'No workspace is available yet.',
      loading: 'Reading the repository…',
      'branch.detached': 'Detached HEAD',
      'branch.noUpstream': 'No upstream',
      'branch.upstreamGone': 'Upstream is gone',
      fetch: 'Fetch',
      pull: 'Pull',
      push: 'Push',
      'tab.changes': 'Changes',
      'tab.branches': 'Branches',
      'tab.history': 'History',
      'tab.stash': 'Stash',
      'changes.clean': 'Nothing to commit. The work tree is clean.',
      'changes.noCommits': 'This repository has no commits yet.',
      'group.staged': 'Staged changes',
      'group.changes': 'Changes',
      'group.untracked': 'Untracked files',
      'group.conflicts': 'Conflicts',
      'group.count': '{count}',
      'commit.placeholder': 'Message',
      'commit.stageAll': 'Stage All',
      'commit.generate': 'Generate commit message',
      'commit.generated': 'Message written from the current diff.',
      'commit.action': 'Commit staged changes',
      'action.stage': 'Stage',
      'action.unstage': 'Unstage',
      'action.diff': 'Diff',
      'action.view': 'View',
      'action.viewAll': 'View all',
      'action.discard': 'Discard',
      'action.close': 'Close',
      'diff.staged': 'Staged diff',
      'diff.unstaged': 'Working tree diff',
      'diff.untracked': 'New file',
      'diff.binary': 'This file has no textual preview.',
      'diff.empty': 'No textual difference.',
      'diff.truncated': 'Output was shortened.',
      'diff.linesTruncated': 'Only the first {count} lines are shown.',
      'branches.new.placeholder': 'New branch name',
      'branches.new.checkout': 'Switch to the new branch',
      'branches.new.action': 'Create branch',
      'branches.current': 'current',
      'branches.switch': 'Switch',
      'branches.delete': 'Delete',
      'branches.remote': 'Remote branches',
      'branches.none': 'No local branches yet.',
      'history.empty': 'No commits yet.',
      'history.more': 'Load more',
      'history.revert': 'Revert',
      'history.reset': 'Reset',
      'stash.message.placeholder': 'Stash message (optional)',
      'stash.untracked': 'Include untracked files',
      'stash.save': 'Stash changes',
      'stash.apply': 'Apply',
      'stash.pop': 'Pop',
      'stash.drop': 'Drop',
      'stash.empty': 'No stash entries.',
      'confirm.cancel': 'Cancel',
      'confirm.run': 'Run',
      'confirm.discard': 'Discard local changes in {path}?',
      'confirm.discardUntracked': 'Delete the untracked file {path}?',
      'confirm.discardStaged': 'Discard {count} selected path(s)?',
      'confirm.deleteBranch': 'Delete branch {name}?',
      'confirm.revert': 'Create a commit that reverts {ref}?',
      'confirm.reset': 'Move {branch} to {ref}.',
      'confirm.resetSoft': 'Soft: keep the index and the work tree.',
      'confirm.resetMixed': 'Mixed: reset the index, keep the work tree.',
      'confirm.resetHard': 'Hard: discard index and work tree changes.',
      'confirm.stashDrop': 'Drop {ref}? The stash entry is lost.',
      'changes.cleanShort': 'Clean',
      'commit.stageAllHint': 'Stage every change at once',
      'commit.generateHint': 'Write a commit message from the staged diff',
      'sync.fetchHint': 'Update the remote-tracking refs',
      'sync.pullHint': 'Fast-forward {count} commit(s) from {upstream}',
      'sync.pullNoneHint': 'Up to date: there is nothing to pull',
      'sync.pushHint': 'Send {count} commit(s) to {upstream}',
      'sync.publish': 'Publish branch',
      'sync.publishHint': 'Push {branch} and set origin as its upstream',
      'sync.pushNoneHint': 'Up to date: there is nothing to push',
      'sync.pullFirstHint': 'The remote has {count} commit(s) this branch does not: pull before pushing',
      'sync.detached': 'Detached HEAD has no upstream to sync',
      'state.staged': '{count} staged',
      'state.unstaged': '{count} unstaged',
      'state.untracked': '{count} untracked',
      'state.conflict': '{count} conflicted',
      'state.behind': '↓{count}',
      'state.ahead': '↑{count}',
      'commit.blocked.conflicts': 'Resolve the conflicted files before committing.',
      'commit.blocked.empty': 'The work tree is clean. There is nothing to commit.',
      'commit.blocked.unstaged': 'Nothing is staged yet. Stage a file to include it.',
      'commit.blocked.detached': 'Detached HEAD: this commit belongs to no branch.',
      'commit.button': 'Commit {count} file(s)',
      'commit.leftOut': '{count} change(s) stay out of this commit.',
      'commit.ready': 'Ready: {count} file(s) go into the next commit.',
      'commit.readyToPush': '{count} commit(s) are waiting for the remote.',
      'commit.readyToPull': 'The remote has {count} commit(s) to bring in.',
      'commit.pushAction': 'Push {count} commit(s)',
      'commit.pullAction': 'Pull {count} commit(s)',
      'notice.failed': 'The git command failed.',
      'view.noDirectory': 'This session has no working directory to inspect.',
    };

    /**
     * Call one Host action.
     * @param body - request body naming the action and its arguments.
     * @param signal - caller cancellation.
     * @returns the action payload.
     */
    async function callApi(body, signal) {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
        credentials: 'same-origin',
      });
      if (!response.ok) {
        throw Object.assign(new Error(`HTTP ${response.status}`), { payload: { code: 'http', message: `HTTP ${response.status}` } });
      }
      const payload = await response.json();
      if (payload === null || typeof payload !== 'object') {
        throw Object.assign(new Error('Malformed response'), { payload: { code: 'malformed' } });
      }
      if (payload.ok !== true) {
        throw Object.assign(new Error(typeof payload.message === 'string' ? payload.message : 'Git command failed'), { payload });
      }
      return payload.data === undefined ? null : payload.data;
    }

    /**
     * Convert a thrown request into panel failure facts.
     * @param error - the thrown value.
     * @returns message, optional command, and optional git stderr.
     */
    function failureOf(error) {
      const payload = error?.payload ?? {};
      return {
        message: typeof payload.message === 'string' ? payload.message : (error?.message ?? 'Request failed'),
        command: typeof payload.command === 'string' ? payload.command : null,
        stderr: typeof payload.stderr === 'string' && payload.stderr !== '' ? payload.stderr : null,
      };
    }

    /**
     * Render one path comparison as coloured lines.
     * @param props - diff payload and localized copy.
     * @returns the diff block.
     */
    function DiffBody({ t, diff }) {
      const data = diff.data;
      if (data === null || data === undefined) return null;
      if (data.binary === true) {
        return h('p', { className: 'gctl-hint' }, t('diff.binary'));
      }
      const kind = data.kind;
      const prefix = kind === 'untracked';
      const lines = data.text === '' ? [] : data.text.split('\n');
      if (lines.length === 0) {
        return h('p', { className: 'gctl-hint' }, t('diff.empty'));
      }
      const shown = lines.slice(0, MAX_RENDERED_LINES);
      return h(
        'div',
        { className: 'gctl-diffBody' },
        data.truncated === true ? h('p', { className: 'gctl-hint' }, t('diff.truncated')) : null,
        h(
          'pre',
          { className: 'gctl-diffPre' },
          shown.map((line, index) => {
            const text = prefix ? `+${line}` : line;
            const tone = prefix || line.startsWith('+')
              ? 'gctl-add'
              : line.startsWith('-')
                ? 'gctl-del'
                : line.startsWith('@@')
                  ? 'gctl-hunk'
                  : null;
            return h('span', { key: index, className: tone === null ? 'gctl-line' : `gctl-line ${tone}` }, text === '' ? ' ' : text);
          }),
        ),
        lines.length > MAX_RENDERED_LINES
          ? h('p', { className: 'gctl-hint' }, t('diff.linesTruncated', { count: MAX_RENDERED_LINES }))
          : null,
      );
    }

    /**
     * Render a modal confirmation with the exact command it will run.
     * @param props - request facts and the cancel callback.
     * @returns the dialog element.
     */
    function ConfirmDialog({ t, request, onCancel }) {
      const [mode, setMode] = React.useState(request.modes === undefined ? null : request.modes[0].value);

      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
      }, [onCancel]);

      const command = typeof request.commandFor === 'function' && mode !== null
        ? request.commandFor(mode)
        : request.command;

      return h(
        'div',
        { className: 'gctl-scrim', role: 'presentation', onClick: (event) => { if (event.target === event.currentTarget) onCancel(); } },
        h(
          'div',
          { className: 'gctl-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': request.title },
          h('h2', { className: 'gctl-dialogTitle' }, request.title),
          request.description === undefined ? null : h('p', { className: 'gctl-dialogText' }, request.description),
          request.modes === undefined
            ? null
            : h(
                'div',
                { className: 'gctl-modeGroup', role: 'radiogroup', 'aria-label': request.title },
                request.modes.map((entry) => h(
                  'label',
                  { key: entry.value, className: mode === entry.value ? 'gctl-mode gctl-modeActive' : 'gctl-mode' },
                  h('input', {
                    type: 'radio',
                    name: 'gctl-reset-mode',
                    value: entry.value,
                    checked: mode === entry.value,
                    onChange: () => setMode(entry.value),
                  }),
                  h('span', null, entry.label),
                )),
              ),
          command === undefined || command === null || command === ''
            ? null
            : h('code', { className: 'gctl-command' }, command),
          h(
            'div',
            { className: 'gctl-dialogActions' },
            h('button', { type: 'button', className: 'gctl-button', onClick: onCancel }, t('confirm.cancel')),
            h(
              'button',
              {
                type: 'button',
                className: request.destructive === true ? 'gctl-button gctl-dangerSolid' : 'gctl-button gctl-primary',
                autoFocus: true,
                onClick: () => { request.onConfirm(mode); },
              },
              t('confirm.run'),
            ),
          ),
        ),
      );
    }

    /**
     * Render one sidebar panel glyph.
     * @returns the glyph element.
     */
    function GitControlIcon({ size = 18, active = false }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: active ? 2 : 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { display: 'block', color: active ? 'var(--dsw-alias-brand-primary)' : 'inherit' },
        },
        h('circle', { cx: 7, cy: 6, r: 2.4 }),
        h('circle', { cx: 7, cy: 18, r: 2.4 }),
        h('circle', { cx: 17, cy: 8.5, r: 2.4 }),
        h('path', { d: 'M7 8.4v7.2' }),
        h('path', { d: 'M17 10.9c0 3.4-2.6 4.1-6.2 4.6' }),
      );
    }

    /**
     * Glyph geometry for every icon-only control, drawn on a shared 16px grid.
     * Each entry lists the primitives of one icon.
     */
    const ICONS = {
      stage: [['path', { d: 'M8 3.5v9' }], ['path', { d: 'M3.5 8h9' }]],
      stageAll: [['path', { d: 'M8 2.5v7' }], ['path', { d: 'M5 6.7 8 9.7l3-3' }], ['path', { d: 'M2.8 12.2h10.4' }]],
      unstage: [['path', { d: 'M3.5 8h9' }]],
      trash: [
        ['path', { d: 'M2.5 5.5h11' }],
        ['path', { d: 'M6 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5' }],
        ['path', { d: 'M4 5.5v7a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5v-7' }],
      ],
      diff: [
        ['path', { d: 'M4.4 2.4h4.3l2.9 2.9v8.3H4.4z' }],
        ['path', { d: 'M8.7 2.4v2.9h2.9' }],
        ['path', { d: 'M6.3 8.4h3.4' }],
        ['path', { d: 'M6.3 10.6h3.4' }],
      ],
      file: [
        ['path', { d: 'M3.5 13.5V3.5A1 1 0 0 1 4.5 2.5h5.5l3.5 3.5v7.5a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1Z' }],
        ['path', { d: 'M10 2.5v3.5h3.5' }],
        ['path', { d: 'M5.5 6.5h2' }],
        ['path', { d: 'M5.5 9h5' }],
        ['path', { d: 'M5.5 11.5h5' }],
      ],
      revert: [
        ['path', { d: 'M6 4.5 3.5 7 6 9.5' }],
        ['path', { d: 'M4 7h5.5a3.5 3.5 0 0 1 3.5 3.5v.5a3.5 3.5 0 0 1-3.5 3.5H6.5' }],
      ],
      reset: [['path', { d: 'M6.4 3.4 3 8l3.4 4.6' }], ['path', { d: 'M12.6 3.4 9.2 8l3.4 4.6' }]],
      switch: [['path', { d: 'M2.8 8h8.2' }], ['path', { d: 'M8.4 5.4 11 8l-2.6 2.6' }], ['path', { d: 'M13.2 3.4v9.2' }]],
      fetch: [['path', { d: 'M13 8a5 5 0 1 1-1.6-3.7' }], ['path', { d: 'M13.2 2.9v2.8h-2.8' }]],
      pull: [['path', { d: 'M8 2.6v6.4' }], ['path', { d: 'M5.2 6.2 8 9l2.8-2.8' }], ['path', { d: 'M2.8 12.4h10.4' }]],
      push: [['path', { d: 'M8 9.4V3' }], ['path', { d: 'M5.2 5.8 8 3l2.8 2.8' }], ['path', { d: 'M2.8 12.4h10.4' }]],
      check: [['path', { d: 'M3.5 8.5 6.5 11.5 12.5 5.5' }]],
      apply: [['path', { d: 'M8 2.6v6' }], ['path', { d: 'M5.2 6 8 8.8 10.8 6' }], ['path', { d: 'M3.4 9.4v3.6h9.2V9.4' }]],
      pop: [['path', { d: 'M8 8.6V2.6' }], ['path', { d: 'M5.2 5.2 8 2.4l2.8 2.8' }], ['path', { d: 'M3.4 9.4v3.6h9.2V9.4' }]],
      spark: [
        ['path', { d: 'M8 2.2C8 5.4 6 7.4 2.8 8c3.2.6 5.2 2.6 5.2 5.8.6-3.2 2.6-5.2 5.8-5.8-3.2-.6-5.2-2.6-5.8-5.8Z' }],
        ['path', { d: 'M13 1.8v2.4M11.8 3h2.4' }],
        ['circle', { cx: 3.6, cy: 12.4, r: 1 }],
      ],
      chevronDown: [['path', { d: 'M4 6.5 8 10.5 12 6.5' }]],
      chevronRight: [['path', { d: 'M6.5 4 10.5 8 6.5 12' }]],
      refresh: [['path', { d: 'M13 8a5 5 0 1 1-1.6-3.7' }], ['path', { d: 'M13.2 2.9v2.8h-2.8' }]],
      close: [['path', { d: 'M4.6 4.6 11.4 11.4' }], ['path', { d: 'M11.4 4.6 4.6 11.4' }]],
    };

    /**
     * Render one glyph from the shared icon set.
     * @param props - icon name, edge size, optional style, and className.
     * @returns the svg element.
     */
    function Glyph({ name, size = 16, style = null, className = null }) {
      const primitives = ICONS[name] ?? ICONS.close;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.35,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          focusable: 'false',
          'aria-hidden': 'true',
          style: style === null ? undefined : style,
          className: className === null ? undefined : className,
        },
        primitives.map(([tag, attrs], index) => h(tag, { key: index, ...attrs })),
      );
    }

    /**
     * Split a repository-relative path into base name and directory path.
     * @param filePath - repo-relative file path.
     * @returns `{ name, dir }`.
     */
    function splitFilePath(filePath) {
      if (typeof filePath !== 'string') return { name: '', dir: null };
      const lastSlash = filePath.lastIndexOf('/');
      if (lastSlash === -1) {
        return { name: filePath, dir: null };
      }
      return {
        name: filePath.slice(lastSlash + 1),
        dir: filePath.slice(0, lastSlash),
      };
    }

    /**
     * Derive the status badge code, semantic tone, and label from git status facts.
     * @param file - status entry for one path.
     * @returns `{ code, tone, color, label }`.
     */
    function getFileStatusInfo(file) {
      if (file.conflicted) {
        return { code: 'C', tone: 'bad', color: 'var(--dsw-alias-state-error-primary, #f85149)', label: 'Conflicted' };
      }
      if (file.untracked) {
        return { code: 'U', tone: 'ok', color: 'var(--dsw-alias-state-success-primary, #3fb950)', label: 'Untracked' };
      }
      const code = file.code || '';
      if (code.includes('A')) {
        return { code: 'A', tone: 'ok', color: 'var(--dsw-alias-state-success-primary, #3fb950)', label: 'Added' };
      }
      if (code.includes('D')) {
        return { code: 'D', tone: 'bad', color: 'var(--dsw-alias-state-error-primary, #f85149)', label: 'Deleted' };
      }
      if (code.includes('R')) {
        return { code: 'R', tone: 'warn', color: 'var(--dsw-alias-state-warning-primary, #e3b341)', label: 'Renamed' };
      }
      return { code: 'M', tone: 'warn', color: 'var(--dsw-alias-state-warning-primary, #e3b341)', label: 'Modified' };
    }

    /**
     * Render one icon-only command. The label survives in `aria-label` and in
     * the hover hint, so dropping the visible text keeps the control named.
     * @param props - glyph, label, hint, optional counter badge, and state.
     * @returns the button element.
     */
    function IconButton(props) {
      const { name, label, hint = null, badge = null, onClick, disabled = false, danger = false, busy = false, size = 16 } = props;
      return h(
        'button',
        {
          type: 'button',
          className: danger ? 'gctl-iconButton gctl-iconDanger' : 'gctl-iconButton',
          title: hint === null ? label : `${label} — ${hint}`,
          'aria-label': label,
          'aria-busy': busy ? 'true' : undefined,
          disabled,
          onClick,
        },
        h(Glyph, { name, size }),
        badge === null ? null : h('span', { className: 'gctl-badge', 'aria-hidden': 'true' }, badge),
      );
    }

    /**
     * Render the repository panel.
     * @param props - slot props: localized copy, the workspace snapshot hook, and
     * an optional fixed repository path that removes the workspace selector.
     * @returns the panel element.
     */
    function GitControlPage(props) {
      const { t, useWorkspaces, fixedPath, compact = false } = props;
      const workspaces = useWorkspaces === undefined
        ? []
        : useWorkspaces((snapshot) => snapshot.items);

      const [repoPath, setRepoPath] = React.useState(null);
      const [status, setStatus] = React.useState(null);
      const [phase, setPhase] = React.useState('idle');
      const [revision, setRevision] = React.useState(0);
      const [tab, setTab] = React.useState('changes');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [message, setMessage] = React.useState('');
      const [stashMessage, setStashMessage] = React.useState('');
      const [stashUntracked, setStashUntracked] = React.useState(true);
      const [selected, setSelected] = React.useState(null);
      const [diff, setDiff] = React.useState(null);
      const prevSelectedRef = React.useRef(null);
      const isBusyOrInFlightRef = React.useRef(false);
      const [branches, setBranches] = React.useState(null);
      const [commits, setCommits] = React.useState(null);
      const [logLimit, setLogLimit] = React.useState(LOG_STEP);
      const [stashes, setStashes] = React.useState(null);
      const [newBranch, setNewBranch] = React.useState('');
      const [switchOnCreate, setSwitchOnCreate] = React.useState(true);
      const [confirm, setConfirm] = React.useState(null);
      const [generating, setGenerating] = React.useState(false);
      const [collapsedGroups, setCollapsedGroups] = React.useState({});

      const toggleGroup = (key) => setCollapsedGroups((current) => ({ ...current, [key]: !current[key] }));

      const chosenPath = fixedPath ?? repoPath ?? (workspaces.length > 0 ? workspaces[0].path : null);
      isBusyOrInFlightRef.current = busy || generating || confirm !== null || phase === 'refreshing' || phase === 'loading';

      /* Read the status of the selected repository. */
      React.useEffect(() => {
        if (chosenPath === null) {
          setStatus(null);
          setPhase('idle');
          return undefined;
        }
        const controller = new AbortController();
        setPhase((current) => (current === 'ready' ? 'refreshing' : 'loading'));
        callApi({ action: 'status', path: chosenPath }, controller.signal)
          .then((data) => {
            if (controller.signal.aborted) return;
            setStatus(data);
            setPhase('ready');
          })
          .catch((error) => {
            if (controller.signal.aborted) return;
            setStatus((current) => (current === null ? null : current));
            setPhase('error');
            setError(failureOf(error));
          });
        return () => controller.abort();
      }, [chosenPath, revision]);

      /* Auto-refresh repository state continuously while the panel is open and visible. */
      React.useEffect(() => {
        if (chosenPath === null) return undefined;

        let timer = null;
        let lastPing = Date.now();

        const ping = () => {
          if (document.hidden || isBusyOrInFlightRef.current) return;
          const now = Date.now();
          if (now - lastPing < 1000) return;
          lastPing = now;
          setRevision((current) => current + 1);
        };

        const startPolling = () => {
          if (timer === null) {
            timer = setInterval(ping, POLL_INTERVAL_MS);
          }
        };

        const stopPolling = () => {
          if (timer !== null) {
            clearInterval(timer);
            timer = null;
          }
        };

        const onVisibilityChange = () => {
          if (document.visibilityState === 'visible') {
            ping();
            startPolling();
          } else {
            stopPolling();
          }
        };

        const onFocus = () => {
          if (document.visibilityState === 'visible') {
            ping();
          }
        };

        if (document.visibilityState === 'visible') {
          startPolling();
        }

        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
          stopPolling();
          window.removeEventListener('focus', onFocus);
          document.removeEventListener('visibilitychange', onVisibilityChange);
        };
      }, [chosenPath]);

      /* Keep the selected diff target in sync with updated file status. */
      React.useEffect(() => {
        if (selected === null || status === null) return;
        const matching = status.files.find((file) => file.path === selected.path);
        if (!matching) {
          setSelected(null);
        } else if (Boolean(matching.staged) !== Boolean(selected.staged) || Boolean(matching.untracked) !== Boolean(selected.untracked)) {
          setSelected({ path: matching.path, staged: Boolean(matching.staged), untracked: Boolean(matching.untracked) });
        }
      }, [status]);

      /* Reset tab data when switching tabs or changing repository. */
      React.useEffect(() => {
        setBranches(null);
        setCommits(null);
        setStashes(null);
      }, [tab, chosenPath]);

      /* Read the active tab's own data. */
      React.useEffect(() => {
        if (chosenPath === null || status === null) return undefined;
        const controller = new AbortController();
        if (tab === 'branches') {
          callApi({ action: 'branches', path: chosenPath }, controller.signal)
            .then((data) => { if (!controller.signal.aborted) setBranches(data); })
            .catch((error) => { if (!controller.signal.aborted) setError(failureOf(error)); });
        } else if (tab === 'history') {
          callApi({ action: 'log', path: chosenPath, limit: logLimit }, controller.signal)
            .then((data) => { if (!controller.signal.aborted) setCommits(data.commits); })
            .catch((error) => { if (!controller.signal.aborted) setError(failureOf(error)); });
        } else if (tab === 'stash') {
          callApi({ action: 'stashList', path: chosenPath }, controller.signal)
            .then((data) => { if (!controller.signal.aborted) setStashes(data.stashes); })
            .catch((error) => { if (!controller.signal.aborted) setError(failureOf(error)); });
        }
        return () => controller.abort();
      }, [tab, chosenPath, revision, logLimit, status === null]);

      /* Read the selected comparison. */
      React.useEffect(() => {
        if (selected === null || chosenPath === null) {
          prevSelectedRef.current = null;
          setDiff(null);
          return undefined;
        }
        const isSameFile = prevSelectedRef.current?.path === selected.path &&
          prevSelectedRef.current?.staged === selected.staged &&
          prevSelectedRef.current?.untracked === selected.untracked;
        prevSelectedRef.current = selected;

        const controller = new AbortController();
        setDiff((current) => ({
          phase: 'loading',
          data: isSameFile ? (current?.data ?? null) : null,
        }));
        callApi({
          action: 'diff',
          path: chosenPath,
          file: selected.path,
          staged: selected.staged === true,
          untracked: selected.untracked === true,
        }, controller.signal)
          .then((data) => { if (!controller.signal.aborted) setDiff({ phase: 'ready', data }); })
          .catch((error) => { if (!controller.signal.aborted) setDiff({ phase: 'error', data: null, failure: failureOf(error) }); });
        return () => controller.abort();
      }, [selected, chosenPath, revision]);

      /**
       * Run one mutating action and fold its outcome into the panel.
       * @param body - request body.
       * @returns the action payload, or null after a failure.
       */
      const execute = async (body) => {
        setBusy(true);
        setError(null);
        try {
          const data = await callApi(body);
          if (data !== null && data.status !== undefined) setStatus(data.status);
          setRevision((current) => current + 1);
          return data;
        } catch (err) {
          setError(failureOf(err));
          return null;
        } finally {
          setBusy(false);
        }
      };

      /** Open one confirmation dialog. */
      const ask = (request) => setConfirm(request);

      /** Stage or unstage one path. */
      const toggleStage = (file) => execute({
        action: file.staged ? 'unstage' : 'stage',
        path: chosenPath,
        paths: [file.path],
      });

      /** Ask before discarding one path. */
      const askDiscard = (file) => ask({
        title: t('action.discard'),
        description: file.untracked ? t('confirm.discardUntracked', { path: file.path }) : t('confirm.discard', { path: file.path }),
        command: file.untracked ? `git clean -f -d -- ${file.path}` : `git restore -- ${file.path}`,
        destructive: true,
        onConfirm: () => {
          setConfirm(null);
          void execute({ action: 'discard', path: chosenPath, paths: [file.path], untracked: file.untracked === true });
        },
      });

      /** Commit what is staged. */
      const commit = async () => {
        const data = await execute({ action: 'commit', path: chosenPath, message });
        if (data !== null) setMessage('');
      };

      /** Stage every change at once. */
      const stageAll = () => execute({ action: 'stageAll', path: chosenPath });

      /** Ask the host for a commit message written from the current diff. */
      const generateMessage = async () => {
        setGenerating(true);
        setError(null);
        try {
          const data = await callApi({ action: 'generateCommitMessage', path: chosenPath });
          if (typeof data?.message === 'string' && data.message !== '') {
            setMessage(data.message);
          }
        } catch (err) {
          setError(failureOf(err));
        } finally {
          setGenerating(false);
        }
      };

      const files = status === null ? [] : status.files;
      const stagedFiles = files.filter((file) => file.staged);
      const changedFiles = files.filter((file) => file.unstaged && !file.untracked && !file.conflicted);
      const untrackedFiles = files.filter((file) => file.untracked);
      const conflictedFiles = files.filter((file) => file.conflicted);
      const detached = status !== null && (status.detached || status.branch === null);

      /* Facts the commit and sync controls derive their shape from. */
      const clean = status !== null && files.length === 0;
      const hasConflicts = conflictedFiles.length > 0;
      const stagedCount = stagedFiles.length;
      const looseCount = changedFiles.length + untrackedFiles.length;
      const ahead = status === null || status.detached ? 0 : status.ahead ?? 0;
      const behind = status === null || status.detached ? 0 : status.behind ?? 0;
      const unpublished = status !== null && (status.upstream === null || status.upstreamGone);
      const canPull = status !== null && !detached && !unpublished && behind > 0;
      const canPush = status !== null && !detached && (unpublished || ahead > 0) && behind === 0;

      /**
       * Why the commit button cannot run, or null when it can.
       * @returns 'conflicts', 'empty', 'unstaged', or null.
       */
      const commitBlocker = hasConflicts
        ? 'conflicts'
        : stagedCount === 0
          ? (clean ? 'empty' : 'unstaged')
          : null;

      /** Hover hint for the push control, which follows the branch's sync state. */
      const pushHint = (
        detached ? t('sync.detached')
          : behind > 0 ? t('sync.pullFirstHint', { count: behind })
            : unpublished ? t('sync.publishHint', { branch: status.branch })
              : ahead > 0 ? t('sync.pushHint', { count: ahead, upstream: status.upstream })
                : t('sync.pushNoneHint')
      );

      /** Visible warning when the branch cannot be pushed before pulling. */
      const syncHint = status !== null && !detached && behind > 0
        ? t('sync.pullFirstHint', { count: behind })
        : null;

      /** Push or publish the current branch to the remote. */
      const push = () => void execute({ action: 'push', path: chosenPath });

      /**
       * The action the commit card offers while nothing is staged: hand the
       * queued commits to the remote, or take the remote's. It replaces a
       * commit button that could not run anyway, so a commit is always followed
       * by one click that sends it.
       */
      const cardAction = stagedCount > 0 || hasConflicts
        ? null
        : ahead > 0 && canPush
          ? {
              id: 'push',
              label: unpublished ? t('sync.publish') : t('commit.pushAction', { count: ahead }),
              hint: pushHint,
              run: push,
            }
          : canPull
            ? {
                id: 'pull',
                label: t('commit.pullAction', { count: behind }),
                hint: t('sync.pullHint', { count: behind, upstream: status.upstream }),
                run: () => void execute({ action: 'pull', path: chosenPath }),
              }
            : null;

      /** One line explaining the current commit precondition. */
      const commitHint = (
        generating ? null
          : hasConflicts ? t('commit.blocked.conflicts')
            : stagedCount > 0
              ? (message.trim() === '' ? null
                : looseCount > 0 ? t('commit.leftOut', { count: looseCount })
                  : detached ? t('commit.blocked.detached')
                    : t('commit.ready', { count: stagedCount }))
              : cardAction?.id === 'push' ? t('commit.readyToPush', { count: ahead })
                : cardAction?.id === 'pull' ? t('commit.readyToPull', { count: behind })
                  : clean ? t('commit.blocked.empty')
                    : t('commit.blocked.unstaged')
      );

      /**
       * The single primary action for the commit card.
       * Adapts to the repository's sync and staging state:
       * - Conflicts present: disabled conflict alert
       * - Staged files present: commit staged changes
       * - Unstaged files present (0 staged): stage all changes
       * - Clean repository: push (if ahead) or pull (if behind)
       * - Clean and up to date: null (no action needed)
       */
      const mainAction = hasConflicts
        ? {
            id: 'conflicts',
            label: t('group.conflicts'),
            icon: 'close',
            disabled: true,
            primary: false,
            hint: t('commit.blocked.conflicts'),
            run: () => {},
          }
        : stagedCount > 0
          ? {
              id: 'commit',
              label: t('commit.button', { count: stagedCount }),
              icon: 'check',
              disabled: busy || generating || message.trim() === '' || detached,
              primary: message.trim() !== '' && !busy && !generating && !detached,
              hint: commitHint,
              run: () => void commit(),
            }
          : files.length > 0
            ? {
                id: 'stageAll',
                label: t('commit.stageAll'),
                icon: 'stage',
                disabled: busy || generating,
                primary: !busy && !generating,
                hint: t('commit.stageAllHint'),
                run: () => void stageAll(),
              }
            : cardAction !== null
              ? {
                  id: cardAction.id,
                  label: cardAction.label,
                  icon: cardAction.id === 'push' ? 'push' : 'pull',
                  disabled: busy || (cardAction.id === 'push' && !canPush),
                  primary: !busy && (cardAction.id !== 'push' || canPush),
                  hint: cardAction.hint,
                  run: cardAction.run,
                }
              : null;


      /**
       * Render error details below an input or group.
       * @returns the error element or null.
       */
      const renderError = () => (
        error === null
          ? null
          : h(
              'div',
              { className: 'gctl-inputError', role: 'alert' },
              h('div', null, error.message ?? t('notice.failed')),
              error.command === undefined || error.command === null ? null : h('code', { className: 'gctl-command' }, error.command),
              error.stderr === undefined || error.stderr === null ? null : h('pre', { className: 'gctl-stderr' }, error.stderr),
            )
      );

      /**
       * Render one file group.
       * @param group - heading, rows, and the action set for the group.
       * @returns the group element or null when empty.
       */
      const renderGroup = ({ key, title, rows, actions, headerActions = [] }) => {
        if (rows.length === 0) return null;
        const isCollapsed = collapsedGroups[key] === true;
        return h(
          'section',
          { className: 'gctl-group', key },
          h(
            'div',
            {
              className: 'gctl-groupHead',
              role: 'button',
              tabIndex: 0,
              'aria-expanded': !isCollapsed,
              onClick: () => toggleGroup(key),
              onKeyDown: (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleGroup(key);
                }
              },
            },
            h(
              'span',
              { className: 'gctl-groupTitleWrap' },
              h(Glyph, { name: isCollapsed ? 'chevronRight' : 'chevronDown', size: 14, className: 'gctl-groupChevron' }),
              h('span', { className: 'gctl-groupTitle' }, title),
              h('span', { className: 'gctl-count' }, t('group.count', { count: rows.length })),
            ),
            h(
              'span',
              { className: 'gctl-groupActions', onClick: (e) => e.stopPropagation() },
              headerActions.map((action) => h(IconButton, {
                key: action.id,
                name: action.icon,
                label: action.label,
                hint: action.hint === undefined ? null : action.hint,
                danger: action.destructive === true,
                disabled: busy,
                onClick: () => action.run(),
              })),
              h('span', { className: 'gctl-viewAll' }, t('action.viewAll')),
            ),
          ),
          isCollapsed
            ? null
            : h('ul', { className: 'gctl-rows' }, rows.map((file) => {
                const statusInfo = getFileStatusInfo(file);
                const { name: fileName, dir: fileDir } = splitFilePath(file.path);
                const originalSplit = file.originalPath ? splitFilePath(file.originalPath) : null;
                return h(
                  'li',
                  {
                    className: selected?.path === file.path ? 'gctl-row gctl-rowActive' : 'gctl-row',
                    key: `${file.code}:${file.path}`,
                    onClick: () => setSelected({ path: file.path, staged: file.staged === true, untracked: file.untracked === true }),
                  },
                  h('span', {
                    className: 'gctl-fileIcon',
                    style: { color: statusInfo.color },
                    title: `${statusInfo.label} (${statusInfo.code})`,
                  }, h(Glyph, { name: 'file', size: 16 })),
                  h(
                    'span',
                    { className: 'gctl-fileDetails', title: file.originalPath ? `${file.originalPath} → ${file.path}` : file.path },
                    h('span', { className: 'gctl-fileName' }, originalSplit ? `${originalSplit.name} → ${fileName}` : fileName),
                    fileDir ? h('span', { className: 'gctl-fileDir' }, fileDir) : null,
                  ),
                  h(
                    'span',
                    { className: 'gctl-rowTail' },
                    h(
                      'span',
                      { className: 'gctl-rowActions', onClick: (e) => e.stopPropagation() },
                      actions.map((makeAction) => makeAction(file)).map((action) => h(IconButton, {
                        key: action.id,
                        name: action.icon,
                        label: action.label,
                        hint: action.hint === undefined ? null : action.hint,
                        danger: action.destructive === true,
                        disabled: busy,
                        onClick: () => action.run(),
                      })),
                    ),
                    h('span', {
                      className: `gctl-statusTag gctl-statusTag-${statusInfo.tone}`,
                      style: { color: statusInfo.color },
                    }, statusInfo.code),
                  ),
                );
              })),
        );
      };

      const diffActions = (file) => ({
        id: 'diff',
        icon: 'diff',
        label: file.untracked ? t('action.view') : t('action.diff'),
        run: () => setSelected({ path: file.path, staged: file.staged === true, untracked: file.untracked === true }),
      });

      const stageActions = (file) => ({ id: 'stage', icon: 'stage', label: t('action.stage'), run: () => void toggleStage(file) });
      const unstageActions = (file) => ({ id: 'unstage', icon: 'unstage', label: t('action.unstage'), run: () => void toggleStage(file) });
      const discardActions = (file) => ({
        id: 'discard',
        icon: file.untracked ? 'trash' : 'revert',
        label: t('action.discard'),
        destructive: true,
        run: () => askDiscard(file),
      });

      const discardAllChanged = () => ask({
        title: t('action.discard'),
        description: t('confirm.discardStaged', { count: changedFiles.length }),
        command: `git restore -- ${changedFiles.map((f) => f.path).join(' ')}`,
        destructive: true,
        onConfirm: () => {
          setConfirm(null);
          void execute({ action: 'discard', path: chosenPath, paths: changedFiles.map((f) => f.path) });
        },
      });

      const stageAllChanged = () => execute({
        action: 'stage',
        path: chosenPath,
        paths: changedFiles.map((f) => f.path),
      });

      const discardAllUntracked = () => ask({
        title: t('action.discard'),
        description: t('confirm.discardStaged', { count: untrackedFiles.length }),
        command: `git clean -f -d -- ${untrackedFiles.map((f) => f.path).join(' ')}`,
        destructive: true,
        onConfirm: () => {
          setConfirm(null);
          void execute({ action: 'discard', path: chosenPath, paths: untrackedFiles.map((f) => f.path), untracked: true });
        },
      });

      const stageAllUntracked = () => execute({
        action: 'stage',
        path: chosenPath,
        paths: untrackedFiles.map((f) => f.path),
      });

      const unstageAllStaged = () => execute({
        action: 'unstage',
        path: chosenPath,
        paths: stagedFiles.map((f) => f.path),
      });

      const tabButton = (id, label) => h(
        'button',
        {
          key: id,
          type: 'button',
          role: 'tab',
          'aria-selected': tab === id,
          className: tab === id ? 'gctl-tab gctl-tabActive' : 'gctl-tab',
          onClick: () => {
            setTab(id);
            setError(null);
          },
        },
        label,
      );

      return h(
        'section',
        { className: compact ? 'gctl-page gctl-compact' : 'gctl-page' },
        h('style', null, PAGE_CSS),
        h(
          'div',
          { className: 'gctl-scroll' },
          h(
            'div',
            { className: 'gctl-content' },
            h(
              'div',
              { className: 'gctl-heading' },
              h('h1', { className: 'gctl-title' }, t('title'), busy ? h('span', { className: 'gctl-working' }, t('working')) : null),
              h(
                'div',
                { className: 'gctl-headingActions' },
                workspaces.length === 0 || fixedPath !== undefined
                  ? null
                  : h(
                      'label',
                      { className: 'gctl-picker' },
                      h('span', { className: 'gctl-pickerLabel' }, t('repository')),
                      h(
                        'select',
                        {
                          className: 'gctl-select',
                          value: chosenPath ?? '',
                          onChange: (event) => {
                            setRepoPath(event.target.value);
                            setSelected(null);
                            setError(null);
                          },
                        },
                        workspaces.map((workspace) => h('option', { key: workspace.workspaceId, value: workspace.path }, workspace.title)),
                      ),
                    ),
                h(IconButton, {
                  name: 'refresh',
                  label: t('refresh'),
                  hint: t('refreshHint'),
                  disabled: busy || chosenPath === null,
                  onClick: () => setRevision((current) => current + 1),
                }),
              ),
            ),

            chosenPath === null
              ? h('p', { className: 'gctl-hint' }, t('repository.none'))
              : null,

            phase === 'loading' && status === null
              ? h('p', { className: 'gctl-hint' }, t('loading'))
              : null,

            phase === 'error' && status === null
              ? h('p', { className: 'gctl-hint gctl-hintBad' }, error?.message ?? t('notice.failed'))
              : null,

            status === null
              ? null
              : h(
                  'div',
                  { className: 'gctl-repo' },
                  h('code', { className: 'gctl-root', title: status.root }, `${status.name} · ${status.root}`),
                  h(
                    'div',
                    { className: 'gctl-branchBar' },
                    h(
                      'span',
                      { className: 'gctl-branch' },
                      h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': 'true' },
                        h('circle', { cx: 7, cy: 6, r: 2.2 }), h('circle', { cx: 7, cy: 18, r: 2.2 }), h('circle', { cx: 17, cy: 8.5, r: 2.2 }),
                        h('path', { d: 'M7 8.4v7.2' }), h('path', { d: 'M17 10.9c0 3.4-2.6 4.1-6.2 4.6' })),
                      detached ? t('branch.detached') : status.branch,
                    ),
                    h(
                      'span',
                      { className: 'gctl-tracking' },
                      status.upstream === null
                        ? t('branch.noUpstream')
                        : status.upstreamGone
                          ? t('branch.upstreamGone')
                          : `${status.upstream} · ↑${status.ahead} ↓${status.behind}`,
                    ),
                    h(
                      'span',
                      { className: 'gctl-branchActions' },
                      h(IconButton, {
                        name: 'fetch',
                        label: t('fetch'),
                        hint: t('sync.fetchHint'),
                        disabled: busy,
                        onClick: () => void execute({ action: 'fetch', path: chosenPath }),
                      }),
                      h(IconButton, {
                        name: 'pull',
                        label: t('pull'),
                        hint: canPull ? t('sync.pullHint', { count: behind, upstream: status.upstream }) : t('sync.pullNoneHint'),
                        badge: canPull ? t('state.behind', { count: behind }) : null,
                        disabled: busy || !canPull,
                        onClick: () => void execute({ action: 'pull', path: chosenPath }),
                      }),
                      h(IconButton, {
                        name: 'push',
                        label: unpublished ? t('sync.publish') : t('push'),
                        hint: pushHint,
                        badge: ahead > 0 ? t('state.ahead', { count: ahead }) : null,
                        disabled: busy || !canPush,
                        onClick: push,
                      }),
                    ),
                  ),
                  syncHint === null ? null : h('p', { className: 'gctl-hint gctl-hintBad' }, syncHint),
                ),

            status === null
              ? null
              : h(
                  'div',
                  { className: 'gctl-tabs', role: 'tablist' },
                  tabButton('changes', t('tab.changes')),
                  tabButton('branches', t('tab.branches')),
                  tabButton('history', t('tab.history')),
                  tabButton('stash', `${t('tab.stash')}${status.stashCount === 0 ? '' : ` (${status.stashCount})`}`),
                ),

            status === null
              ? null
              : h(
                  'div',
                  { className: 'gctl-body', role: 'tabpanel' },
                  tab === 'changes'
                    ? h(
                        'div',
                        null,
                        status.noCommits ? h('p', { className: 'gctl-hint' }, t('changes.noCommits')) : null,
                        h(
                          'div',
                          { className: clean ? 'gctl-commit gctl-commitIdle' : 'gctl-commit' },
                          h(
                            'div',
                            { className: 'gctl-commitTools' },
                            h(
                              'span',
                              { className: 'gctl-chips' },
                              clean ? h('span', { key: 'clean', className: 'gctl-chip gctl-chipOk' }, t('changes.cleanShort')) : null,
                              stagedCount === 0 ? null : h('span', { key: 'staged', className: 'gctl-chip gctl-chipOk' }, t('state.staged', { count: stagedCount })),
                              changedFiles.length === 0 ? null : h('span', { key: 'unstaged', className: 'gctl-chip' }, t('state.unstaged', { count: changedFiles.length })),
                              untrackedFiles.length === 0 ? null : h('span', { key: 'untracked', className: 'gctl-chip' }, t('state.untracked', { count: untrackedFiles.length })),
                              hasConflicts ? h('span', { key: 'conflicts', className: 'gctl-chip gctl-chipBad' }, t('state.conflict', { count: conflictedFiles.length })) : null,
                            ),
                          ),
                          clean
                            ? null
                            : h(
                                'div',
                                { className: 'gctl-textareaWrap' },
                                h('textarea', {
                                  className: `${generating ? 'gctl-textarea gctl-textareaGenerating' : 'gctl-textarea'}${error !== null ? ' gctl-textareaError' : ''}`,
                                  rows: 3,
                                  value: message,
                                  placeholder: t('commit.placeholder'),
                                  'aria-label': t('commit.placeholder'),
                                  readOnly: generating,
                                  onChange: (event) => {
                                    setMessage(event.target.value);
                                    if (error !== null) setError(null);
                                  },
                                  onKeyDown: (event) => {
                                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                                      if (mainAction !== null && !mainAction.disabled) {
                                        event.preventDefault();
                                        mainAction.run();
                                      }
                                    }
                                  },
                                }),
                                h(
                                  'span',
                                  { className: 'gctl-textareaSpark' },
                                  h(IconButton, {
                                    name: 'spark',
                                    label: t('commit.generate'),
                                    hint: t('commit.generateHint'),
                                    busy: generating,
                                    disabled: busy || generating || files.length === 0,
                                    onClick: () => void generateMessage(),
                                  }),
                                ),
                              ),
                          renderError(),
                          mainAction === null
                            ? null
                            : h(
                                'div',
                                { className: 'gctl-mainActionRow' },
                                h(
                                  'button',
                                  {
                                    type: 'button',
                                    className: `gctl-mainActionButton${mainAction.primary ? ' gctl-primary' : ''}`,
                                    title: mainAction.hint ?? mainAction.label,
                                    disabled: mainAction.disabled,
                                    onClick: () => mainAction.run(),
                                  },
                                  h(Glyph, { name: mainAction.icon, size: 14 }),
                                  h('span', null, mainAction.label),
                                ),
                              ),
                          commitHint === null || (clean && mainAction === null)
                            ? null
                            : h(
                                'div',
                                { className: 'gctl-commitHintRow' },
                                h(
                                  'span',
                                  { className: commitBlocker === 'conflicts' ? 'gctl-hint gctl-hintBad' : 'gctl-hint' },
                                  commitHint,
                                ),
                              ),
                        ),
                        renderGroup({
                          key: 'conflicts',
                          title: t('group.conflicts'),
                          rows: conflictedFiles,
                          actions: [stageActions, diffActions],
                          headerActions: [],
                        }),
                        renderGroup({
                          key: 'staged',
                          title: t('group.staged'),
                          rows: stagedFiles,
                          actions: [unstageActions, diffActions],
                          headerActions: [
                            { id: 'unstage-all', icon: 'unstage', label: t('action.unstage'), hint: t('action.unstage'), run: unstageAllStaged },
                          ],
                        }),
                        renderGroup({
                          key: 'changes',
                          title: t('group.changes'),
                          rows: changedFiles,
                          actions: [stageActions, diffActions, discardActions],
                          headerActions: [
                            { id: 'discard-changes', icon: 'revert', label: t('action.discard'), hint: t('action.discard'), destructive: true, run: discardAllChanged },
                            { id: 'stage-changes', icon: 'stage', label: t('action.stage'), hint: t('action.stage'), run: stageAllChanged },
                          ],
                        }),
                        renderGroup({
                          key: 'untracked',
                          title: t('group.untracked'),
                          rows: untrackedFiles,
                          actions: [stageActions, diffActions, discardActions],
                          headerActions: [
                            { id: 'discard-untracked', icon: 'trash', label: t('action.discard'), hint: t('action.discard'), destructive: true, run: discardAllUntracked },
                            { id: 'stage-untracked', icon: 'stage', label: t('action.stage'), hint: t('action.stage'), run: stageAllUntracked },
                          ],
                        }),
                        files.length === 0 ? h('p', { className: 'gctl-hint' }, t('changes.clean')) : null,
                        selected === null
                          ? null
                          : h(
                              'section',
                              { className: 'gctl-diff' },
                              h(
                                'div',
                                { className: 'gctl-diffHead' },
                                h('span', { className: 'gctl-diffTitle' }, `${selected.path} · ${selected.untracked ? t('diff.untracked') : selected.staged ? t('diff.staged') : t('diff.unstaged')}`),
                                h(IconButton, { name: 'close', label: t('action.close'), onClick: () => setSelected(null) }),
                              ),
                              diff === null || (diff.phase === 'loading' && diff.data === null)
                                ? h('p', { className: 'gctl-hint' }, t('loading'))
                                : diff.phase === 'error'
                                  ? h('p', { className: 'gctl-hint' }, diff.failure.message)
                                  : h(DiffBody, { t, diff }),
                            ),
                      )
                    : null,

                  tab === 'branches'
                    ? h(
                        'div',
                        null,
                        h(
                          'div',
                          { className: 'gctl-createRow' },
                          h('input', {
                            type: 'text',
                            className: `gctl-input${error !== null ? ' gctl-inputErrorState' : ''}`,
                            value: newBranch,
                            placeholder: t('branches.new.placeholder'),
                            'aria-label': t('branches.new.placeholder'),
                            onChange: (event) => {
                              setNewBranch(event.target.value);
                              if (error !== null) setError(null);
                            },
                          }),
                          h(
                            'label',
                            { className: 'gctl-check' },
                            h('input', {
                              type: 'checkbox',
                              checked: switchOnCreate,
                              onChange: (event) => setSwitchOnCreate(event.target.checked),
                            }),
                            t('branches.new.checkout'),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'gctl-button gctl-primary',
                              disabled: busy || newBranch.trim() === '',
                              onClick: async () => {
                                const data = await execute({ action: 'createBranch', path: chosenPath, name: newBranch.trim(), checkout: switchOnCreate });
                                if (data !== null) setNewBranch('');
                              },
                            },
                            t('branches.new.action'),
                          ),
                        ),
                        renderError(),
                        branches === null
                          ? h('p', { className: 'gctl-hint' }, t('loading'))
                          : h(
                              'div',
                              null,
                              branches.local.length === 0 ? h('p', { className: 'gctl-hint' }, t('branches.none')) : null,
                              h(
                                'ul',
                                { className: 'gctl-rows' },
                                branches.local.map((branch) => h(
                                  'li',
                                  { className: 'gctl-row', key: branch.name },
                                  h('span', { className: branch.current ? 'gctl-code gctl-codeCurrent' : 'gctl-code' }, branch.current ? '●' : '○'),
                                  h(
                                    'span',
                                    { className: 'gctl-path' },
                                    branch.name,
                                    branch.upstream === null ? null : h('span', { className: 'gctl-meta' }, branch.upstream),
                                  ),
                                  h(
                                    'span',
                                    { className: 'gctl-rowActions' },
                                    branch.current
                                      ? h('span', { className: 'gctl-meta' }, t('branches.current'))
                                      : h(IconButton, {
                                          name: 'switch',
                                          label: t('branches.switch'),
                                          disabled: busy,
                                          onClick: () => void execute({ action: 'checkout', path: chosenPath, name: branch.name }),
                                        }),
                                    branch.current
                                      ? null
                                      : h(IconButton, {
                                          name: 'trash',
                                          label: t('branches.delete'),
                                          danger: true,
                                          disabled: busy,
                                          onClick: () => ask({
                                            title: t('branches.delete'),
                                            description: t('confirm.deleteBranch', { name: branch.name }),
                                            command: `git branch -D ${branch.name}`,
                                            destructive: true,
                                            onConfirm: () => {
                                              setConfirm(null);
                                              void execute({ action: 'deleteBranch', path: chosenPath, name: branch.name, force: true });
                                            },
                                          }),
                                        }),
                                  ),
                                )),
                              ),
                              branches.remote.length === 0
                                ? null
                                : h(
                                    'details',
                                    { className: 'gctl-details' },
                                    h('summary', { className: 'gctl-detailsSummary' }, t('branches.remote'), h('span', { className: 'gctl-count' }, t('group.count', { count: branches.remote.length }))),
                                    h(
                                      'ul',
                                      { className: 'gctl-rows' },
                                      branches.remote.map((branch) => h(
                                        'li',
                                        { className: 'gctl-row', key: branch.name },
                                        h('span', { className: 'gctl-path' }, branch.name),
                                        h('span', { className: 'gctl-meta' }, branch.subject),
                                      )),
                                    ),
                                  ),
                            ),
                      )
                    : null,

                  tab === 'history'
                    ? h(
                        'div',
                        null,
                        renderError(),
                        commits === null
                          ? h('p', { className: 'gctl-hint' }, t('loading'))
                          : commits.length === 0
                            ? h('p', { className: 'gctl-hint' }, t('history.empty'))
                            : h(
                                'ul',
                                { className: 'gctl-rows' },
                                commits.map((entry) => h(
                                  'li',
                                  { className: 'gctl-row gctl-commitRow', key: entry.hash },
                                  h('code', { className: 'gctl-hash' }, entry.short),
                                  h(
                                    'span',
                                    { className: 'gctl-path' },
                                    entry.subject,
                                    h('span', { className: 'gctl-meta' }, `${entry.author} · ${formatDate(entry.date)}`),
                                  ),
                                  h(
                                    'span',
                                    { className: 'gctl-rowActions' },
                                    h(IconButton, {
                                      name: 'revert',
                                      label: t('history.revert'),
                                      disabled: busy,
                                      onClick: () => ask({
                                        title: t('history.revert'),
                                        description: t('confirm.revert', { ref: entry.short }),
                                        command: `git revert --no-edit ${entry.hash}`,
                                        onConfirm: () => {
                                          setConfirm(null);
                                          void execute({ action: 'revert', path: chosenPath, ref: entry.hash });
                                        },
                                      }),
                                    }),
                                    h(IconButton, {
                                      name: 'reset',
                                      label: t('history.reset'),
                                      danger: true,
                                      disabled: busy || detached,
                                      onClick: () => ask({
                                        title: t('history.reset'),
                                        description: t('confirm.reset', { branch: status.branch, ref: entry.short }),
                                        modes: [
                                          { value: 'soft', label: t('confirm.resetSoft') },
                                          { value: 'mixed', label: t('confirm.resetMixed') },
                                          { value: 'hard', label: t('confirm.resetHard') },
                                        ],
                                        commandFor: (mode) => `git reset --${mode} ${entry.hash}`,
                                        destructive: true,
                                        onConfirm: (mode) => {
                                          setConfirm(null);
                                          void execute({ action: 'reset', path: chosenPath, ref: entry.hash, mode });
                                        },
                                      }),
                                    }),
                                  ),
                                )),
                              ),
                        commits !== null && commits.length >= logLimit && logLimit < 200
                          ? h(
                              'div',
                              { className: 'gctl-more' },
                              h('button', {
                                type: 'button',
                                className: 'gctl-button',
                                onClick: () => setLogLimit((current) => Math.min(current + LOG_STEP, 200)),
                              }, t('history.more')),
                            )
                          : null,
                      )
                    : null,

                  tab === 'stash'
                    ? h(
                        'div',
                        null,
                        h(
                          'div',
                          { className: 'gctl-createRow' },
                          h('input', {
                            type: 'text',
                            className: `gctl-input${error !== null ? ' gctl-inputErrorState' : ''}`,
                            value: stashMessage,
                            placeholder: t('stash.message.placeholder'),
                            'aria-label': t('stash.message.placeholder'),
                            onChange: (event) => {
                              setStashMessage(event.target.value);
                              if (error !== null) setError(null);
                            },
                          }),
                          h(
                            'label',
                            { className: 'gctl-check' },
                            h('input', {
                              type: 'checkbox',
                              checked: stashUntracked,
                              onChange: (event) => setStashUntracked(event.target.checked),
                            }),
                            t('stash.untracked'),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'gctl-button gctl-primary',
                              disabled: busy || files.length === 0,
                              onClick: async () => {
                                const data = await execute({
                                  action: 'stashSave',
                                  path: chosenPath,
                                  message: stashMessage,
                                  untracked: stashUntracked,
                                });
                                if (data !== null) setStashMessage('');
                              },
                            },
                            t('stash.save'),
                          ),
                        ),
                        renderError(),
                        stashes === null
                          ? h('p', { className: 'gctl-hint' }, t('loading'))
                          : stashes.length === 0
                            ? h('p', { className: 'gctl-hint' }, t('stash.empty'))
                            : h(
                                'ul',
                                { className: 'gctl-rows' },
                                stashes.map((entry) => h(
                                  'li',
                                  { className: 'gctl-row', key: entry.ref },
                                  h('code', { className: 'gctl-hash' }, entry.ref),
                                  h(
                                    'span',
                                    { className: 'gctl-path' },
                                    entry.subject,
                                    h('span', { className: 'gctl-meta' }, entry.when),
                                  ),
                                  h(
                                    'span',
                                    { className: 'gctl-rowActions' },
                                    h(IconButton, {
                                      name: 'apply',
                                      label: t('stash.apply'),
                                      disabled: busy,
                                      onClick: () => void execute({ action: 'stashApply', path: chosenPath, ref: entry.ref, pop: false }),
                                    }),
                                    h(IconButton, {
                                      name: 'pop',
                                      label: t('stash.pop'),
                                      disabled: busy,
                                      onClick: () => void execute({ action: 'stashApply', path: chosenPath, ref: entry.ref, pop: true }),
                                    }),
                                    h(IconButton, {
                                      name: 'trash',
                                      label: t('stash.drop'),
                                      danger: true,
                                      disabled: busy,
                                      onClick: () => ask({
                                        title: t('stash.drop'),
                                        description: t('confirm.stashDrop', { ref: entry.ref }),
                                        command: `git stash drop ${entry.ref}`,
                                        destructive: true,
                                        onConfirm: () => {
                                          setConfirm(null);
                                          void execute({ action: 'stashDrop', path: chosenPath, ref: entry.ref });
                                        },
                                      }),
                                    }),
                                  ),
                                )),
                              ),
                      )
                    : null,
                ),
          ),
        ),
        confirm === null
          ? null
          : h(ConfirmDialog, { t, request: confirm, onCancel: () => setConfirm(null) }),
      );
    }

    /**
     * Format one ISO timestamp for the panel.
     * @param value - ISO 8601 string from git.
     * @returns a localized short date, or the raw value.
     */
    function formatDate(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    }

    /** Panel stylesheet, injected by the page element so unmounting removes it. */
    const PAGE_CSS = `
.gctl-page{width:100%;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6;display:flex;overflow:hidden}
.gctl-scroll{scrollbar-gutter:stable;flex:1;min-height:0;overflow:auto}
.gctl-content{max-width:1000px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 56px}
.gctl-heading{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:16px;margin-bottom:18px;padding-top:28px;display:flex}
.gctl-title{flex:0 auto;min-width:0;max-width:100%;align-items:baseline;gap:10px;margin:0;font-size:20px;font-weight:500;line-height:28px;display:flex}
.gctl-working{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:400}
.gctl-headingActions{align-items:center;gap:10px;display:flex;flex:none}
.gctl-picker{align-items:center;gap:8px;display:flex;min-width:0}
.gctl-pickerLabel{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.gctl-select{height:30px;max-width:260px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:0 8px}
.gctl-select:hover{border-color:var(--dsw-alias-border-l1)}
.gctl-button{height:30px;border:.5px solid var(--dsw-alias-border-l2);border-radius:15px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;align-items:center;gap:6px;padding:0 12px;display:inline-flex;white-space:nowrap}
.gctl-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.gctl-button:disabled{color:var(--dsw-alias-state-idle-primary);cursor:default}
.gctl-button:focus-visible,.gctl-tab:focus-visible,.gctl-input:focus-visible,.gctl-textarea:focus-visible,.gctl-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.gctl-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.gctl-dangerSolid{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.gctl-notice{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);margin-bottom:16px;padding:10px 12px;font-size:13px}
.gctl-noticeError{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.gctl-inputError{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.4;margin:6px 0;overflow-wrap:anywhere}
.gctl-inputError .gctl-command{margin-top:4px;font-size:11px;opacity:.85}
.gctl-inputError .gctl-stderr{margin-top:4px;font-size:11px;color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);border-radius:6px;padding:6px 8px;max-height:120px}
.gctl-textareaError,.gctl-inputErrorState{border-color:var(--dsw-alias-state-error-primary)!important}
.gctl-command,.gctl-stderr,.gctl-diffPre,.gctl-hash,.gctl-root{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.gctl-command{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin-top:6px;font-size:12px;display:block}
.gctl-stderr{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;margin:6px 0 0;font-size:12px;overflow:auto}
.gctl-repo{margin-bottom:14px}
.gctl-root{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;font-size:12px;display:block}
.gctl-branchBar{flex-wrap:wrap;align-items:center;gap:8px 14px;margin-top:6px;display:flex}
.gctl-branch{color:var(--dsw-alias-label-primary);align-items:center;gap:6px;font-size:14px;display:inline-flex}
.gctl-tracking{color:var(--dsw-alias-label-secondary);font-size:12px}
.gctl-branchActions{align-items:center;gap:2px;margin-left:auto;display:flex}
.gctl-tabs{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:4px;margin-bottom:18px;display:flex}
.gctl-tab{border:0;border-bottom:2px solid transparent;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;cursor:pointer;padding:8px 10px;margin-bottom:-1px}
.gctl-tab:hover{color:var(--dsw-alias-label-primary)}
.gctl-tabActive{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.gctl-body{min-height:0;padding-bottom:8px}
.gctl-hint{color:var(--dsw-alias-label-secondary);margin:10px 0;font-size:13px}
.gctl-commit{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);margin-bottom:18px;padding:12px}
.gctl-commitIdle{background:var(--dsw-alias-bg-base)}
.gctl-commitTools{margin-bottom:8px;justify-content:space-between;align-items:flex-start;gap:10px;display:flex}
.gctl-commitTools .gctl-hint{margin:0}
.gctl-chips{flex-wrap:wrap;align-items:center;gap:6px;display:flex;min-width:0}
.gctl-chip{border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:nowrap;padding:0 7px;font-size:11px;line-height:18px}
.gctl-chipOk{color:var(--dsw-alias-state-success-primary)}
.gctl-chipBad{color:var(--dsw-alias-state-error-primary)}
.gctl-hintBad{color:var(--dsw-alias-state-error-primary)}
.gctl-toolGroup{flex:none;align-items:center;gap:4px;display:inline-flex}
.gctl-iconButton{border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);min-width:28px;height:26px;color:var(--dsw-alias-label-secondary);cursor:pointer;justify-content:center;align-items:center;gap:2px;padding:0 4px;display:inline-flex}
.gctl-iconButton:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gctl-iconButton:disabled{color:var(--dsw-alias-state-idle-primary);cursor:default}
.gctl-iconButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.gctl-iconButton[aria-busy=true]{color:var(--dsw-alias-brand-primary);animation:gctl-pulse 1.1s var(--ds-ease-in-out) infinite}
.gctl-iconDanger,.gctl-iconDanger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}
.gctl-badge{color:var(--dsw-alias-brand-primary);font-variant-numeric:tabular-nums;font-size:10px;line-height:1}
@keyframes gctl-pulse{50%{opacity:.45}}
.gctl-textarea,.gctl-input{box-sizing:border-box;width:100%;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:8px 10px;resize:vertical;display:block;transition:border-color .2s ease,box-shadow .2s ease,background .2s ease}
.gctl-textarea:focus,.gctl-input:focus{border-color:var(--dsw-alias-brand-primary)}
.gctl-textareaGenerating{border-color:var(--dsw-alias-brand-primary);background:linear-gradient(90deg,var(--dsw-alias-bg-base) 0%,color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-base)) 50%,var(--dsw-alias-bg-base) 100%);background-size:200% 100%;animation:gctl-shimmer 2s linear infinite,gctl-glow 2s ease-in-out infinite;cursor:progress}
@keyframes gctl-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
@keyframes gctl-glow{0%,100%{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 50%,var(--dsw-alias-border-l2));box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent),0 0 6px color-mix(in srgb,var(--dsw-alias-brand-primary) 15%,transparent)}50%{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary),0 0 14px color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}}
.gctl-textareaWrap{position:relative;width:100%;box-sizing:border-box}
.gctl-textareaWrap .gctl-textarea{padding-right:38px}
.gctl-textareaSpark{position:absolute;top:6px;right:6px;z-index:2}
.gctl-mainActionRow{margin-top:10px;display:flex}
.gctl-mainActionButton{box-sizing:border-box;width:100%;height:32px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0 12px;gap:8px}
.gctl-mainActionButton:hover:not(:disabled){background:var(--dsw-alias-bg-layer-3)}
.gctl-mainActionButton:disabled{color:var(--dsw-alias-state-idle-primary);border-color:var(--dsw-alias-border-l2);cursor:default}
.gctl-mainActionButton.gctl-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.gctl-commitHintRow{margin-top:8px;display:flex;align-items:center;justify-content:center;text-align:center}
.gctl-commitHintRow .gctl-hint{margin:0;font-size:12px}
.gctl-group{margin-bottom:18px}
.gctl-groupHead{display:flex;align-items:center;justify-content:space-between;padding:4px 6px;margin:8px 0 4px;border-radius:6px;cursor:pointer;user-select:none}
.gctl-groupHead:hover{background:var(--dsw-alias-bg-layer-1)}
.gctl-groupTitleWrap{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.gctl-groupChevron{color:var(--dsw-alias-label-secondary);flex:none}
.gctl-groupTitle{float:none;margin:0}
.gctl-groupActions{display:inline-flex;align-items:center;gap:2px}
.gctl-viewAll{font-size:12px;color:var(--dsw-alias-label-secondary);margin-left:4px;cursor:pointer}
.gctl-viewAll:hover{color:var(--dsw-alias-label-primary)}
.gctl-count{border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;padding:0 6px;line-height:18px}
.gctl-rows{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px}
.gctl-row{border-radius:8px;align-items:center;gap:8px;padding:5px 8px;display:flex;cursor:pointer}
.gctl-row:hover{background:var(--dsw-alias-bg-layer-1)}
.gctl-rowActive{background:var(--dsw-alias-bg-layer-2)}
.gctl-fileIcon{width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;flex:none}
.gctl-fileDetails{flex:1;min-width:0;display:flex;align-items:baseline;gap:8px;overflow:hidden}
.gctl-fileName{color:var(--dsw-alias-label-primary);font-size:13px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.gctl-fileDir{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.gctl-rowTail{flex:none;display:flex;align-items:center;gap:8px;margin-left:auto}
.gctl-statusTag{font-weight:700;font-size:12px;min-width:14px;text-align:right}
.gctl-statusTag-ok{color:var(--dsw-alias-state-success-primary)}
.gctl-statusTag-warn{color:var(--dsw-alias-state-warning-primary)}
.gctl-statusTag-bad{color:var(--dsw-alias-state-error-primary)}
.gctl-code{width:22px;flex:none;color:var(--dsw-alias-label-secondary);text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;letter-spacing:-.5px}
.gctl-codeCurrent{color:var(--dsw-alias-state-success-primary)}
.gctl-path{flex:1;min-width:0;overflow-wrap:anywhere;font-size:13px}
.gctl-meta{color:var(--dsw-alias-label-secondary);margin-left:8px;font-size:12px}
.gctl-rowActions{flex:none;align-items:center;gap:2px;display:inline-flex}
.gctl-commitRow{align-items:flex-start}
.gctl-hash{flex:none;color:var(--dsw-alias-brand-primary);font-size:12px;padding-top:2px}
.gctl-createRow{flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:18px;display:flex}
.gctl-createRow .gctl-input{flex:1;min-width:180px;width:auto}
.gctl-check{color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;font-size:13px;display:inline-flex;cursor:pointer}
.gctl-details{margin-top:14px}
.gctl-detailsSummary{color:var(--dsw-alias-label-secondary);cursor:pointer;align-items:center;gap:8px;font-size:13px;display:flex}
.gctl-more{margin-top:14px}
.gctl-diff{border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);margin-top:20px;overflow:hidden}
.gctl-diffHead{border-bottom:.5px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:12px;padding:8px 12px;display:flex}
.gctl-diffTitle{overflow-wrap:anywhere;font-size:13px}
.gctl-diffBody{padding:8px 0}
.gctl-diffPre{max-height:520px;color:var(--dsw-alias-label-primary);white-space:pre;margin:0;padding:0 12px;font-size:12px;line-height:1.5;overflow:auto;display:block}
.gctl-line{display:block}
.gctl-add{color:var(--dsw-alias-state-success-primary)}
.gctl-del{color:var(--dsw-alias-state-error-primary)}
.gctl-hunk{color:var(--dsw-alias-label-secondary)}
.gctl-scrim{position:fixed;inset:0;z-index:60;background:color-mix(in srgb,var(--dsw-alias-label-primary) 28%,transparent);align-items:center;justify-content:center;display:flex;padding:24px}
.gctl-dialog{width:min(520px,100%);max-height:80vh;border:.5px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 12px 32px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);padding:18px;overflow:auto}
.gctl-dialogTitle{margin:0;font-size:16px;font-weight:500}
.gctl-dialogText{color:var(--dsw-alias-label-secondary);margin:8px 0 0;font-size:13px}
.gctl-modeGroup{flex-direction:column;gap:6px;margin-top:12px;display:flex}
.gctl-mode{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;color:var(--dsw-alias-label-secondary);align-items:center;gap:8px;padding:6px 10px;font-size:13px;display:flex;cursor:pointer}
.gctl-mode:hover{background:var(--dsw-alias-bg-layer-2)}
.gctl-modeActive{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.gctl-dialogActions{justify-content:flex-end;gap:10px;margin-top:18px;display:flex}
.gctl-compact .gctl-content{max-width:none;padding:0 12px 28px}
.gctl-compact .gctl-heading{gap:8px;margin-bottom:10px;padding-top:12px}
.gctl-compact .gctl-title{font-size:15px;line-height:22px}
.gctl-compact .gctl-root{font-size:11px}
.gctl-compact .gctl-branchBar{gap:4px 8px;margin-top:2px}
.gctl-compact .gctl-branch{font-size:13px}
.gctl-compact .gctl-branchActions{margin-left:0;flex-wrap:wrap}
.gctl-compact .gctl-tabs{gap:0;margin-bottom:12px;overflow-x:auto}
.gctl-compact .gctl-tab{padding:6px 8px;font-size:13px;white-space:nowrap}
.gctl-compact .gctl-row{flex-wrap:wrap;gap:4px;padding:4px 6px}
.gctl-compact .gctl-rowActions{margin-left:auto}
.gctl-compact .gctl-path{font-size:12px}
.gctl-compact .gctl-commit{padding:10px}
.gctl-compact .gctl-chip{font-size:10px;line-height:16px;padding:0 6px}
.gctl-compact .gctl-iconButton{min-width:24px;height:22px;padding:0 3px}
.gctl-compact .gctl-rowActions{gap:0}
.gctl-compact .gctl-mainActionButton{height:28px;font-size:12px;padding:0 8px}
.gctl-compact .gctl-textarea{font-size:12px}
.gctl-compact .gctl-groupTitle{font-size:12px}
.gctl-compact .gctl-button{height:26px;font-size:12px;padding:0 10px}
@media (width<=760px){.gctl-content{padding:0 20px 48px}.gctl-headingActions{width:100%;justify-content:space-between}.gctl-select{max-width:100%}}
`;

    /**
     * Render the right-Sidebar tab body for the open Session's working
     * directory. The directory the Session runs in is the repository the panel
     * drives, so a Session that moved into a Git worktree inspects that
     * worktree instead of the Workspace it was opened from. The Workspace path
     * is the fallback for a Session that reports no directory yet.
     * @param props - slot props: localized copy, the workspace and session
     * selector hooks, and the Session id.
     * @returns the compact panel, or a hint when no directory is known.
     */
    function GitRightPane(props) {
      const { t, useWorkspaces, useSessions, sessionId } = props;
      const workspaces = useWorkspaces === undefined
        ? []
        : useWorkspaces((snapshot) => snapshot.items);
      const sessionDirectory = useSessions === undefined
        ? undefined
        : useSessions((sessions) => sessions.byId[sessionId]?.cwd);
      const workspace = workspaces.find((entry) => entry.sessionIds.includes(sessionId));
      const directory = typeof sessionDirectory === 'string' && sessionDirectory !== ''
        ? sessionDirectory
        : workspace?.path;

      if (typeof directory !== 'string' || directory === '') {
        return h(
          'section',
          { className: 'gctl-page gctl-compact' },
          h('style', null, PAGE_CSS),
          h('div', { className: 'gctl-content' }, h('p', { className: 'gctl-hint' }, t('view.noDirectory'))),
        );
      }
      return h(GitControlPage, { t, useWorkspaces, fixedPath: directory, compact: true });
    }

    /**
     * Render the right-Sidebar tab chip: the branch glyph beside the tab title.
     * @param props - tab information hook supplied by the tab seat.
     * @returns the chip contents.
     */
    function GitRightTitle({ useTabInfo }) {
      const { tab } = useTabInfo();
      return h(React.Fragment, null, h(GitControlIcon, { size: 14 }), tab.title);
    }

    /**
     * Register the right-Sidebar tab type, its body, and its title.
     * @param ctx - Client plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, 'en', DICTIONARY), 'git-control: dictionary');
      const t = ctx.locale.bind(NS);

      /*
       * The tab type is what puts the entry on the right Sidebar's Guide page.
       * It waits for the registry instead of reading it once, because the
       * Sidebar's own plugin may mount after this one.
       */
      ctx.inject(['sidebarRightTabs'], (scope) => {
        scope.effect(() => scope.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          priority: 'extension',
          title: () => t('type.label'),
          guide: [{
            id: 'workspace',
            order: 20,
            title: () => t('guide.title'),
            description: () => t('guide.description'),
            icon: GitControlIcon,
          }],
        }), 'git-control: tab type');
      });

      ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: TAB_ID,
        locale: NS,
      }, GitRightPane));
      ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: TAB_ID,
        locale: NS,
      }, GitRightTitle));
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
