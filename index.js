/**
 * Host half of the Git Control bundle.
 *
 * One `GitControl` service owns every git invocation the panel performs: it
 * runs git through `ctx.subprocess` (argv arrays only, never a shell) inside a
 * validated repository, and one authenticated Fetch route exposes those
 * operations to the Client panel.
 */

import path from 'node:path';

/** Ceiling for a local git read or write. */
const LOCAL_TIMEOUT_MS = 30_000;
/** Ceiling for operations that talk to a remote. */
const NETWORK_TIMEOUT_MS = 180_000;
/** Collected output ceilings; git output is read once after exit. */
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;
/** Diff text ceilings handed to the panel. */
const MAX_DIFF_CHARS = 400_000;
const MAX_UNTRACKED_CHARS = 200_000;
/** Largest image the panel previews; larger files are named instead of read. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Extensions the panel previews as images, mapped to their media type. */
const IMAGE_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['jfif', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['bmp', 'image/bmp'],
  ['ico', 'image/x-icon'],
  ['avif', 'image/avif'],
  ['svg', 'image/svg+xml'],
]);
/** History page size and the cap on listed remote branches. */
const DEFAULT_LOG_LIMIT = 40;
const MAX_LOG_LIMIT = 200;
const MAX_REMOTE_BRANCHES = 300;

/** Ceiling for one generated commit message. */
const MESSAGE_MAX_TOKENS = 320;
const MESSAGE_MAX_CHARS = 4000;
/** Diff text sent to the model; enough context without flooding the prompt. */
const PROMPT_DIFF_CHARS = 24_000;
/** Ceiling for one message-generation call. */
const MESSAGE_TIMEOUT_MS = 60_000;

/**
 * Model selection used for generated commit messages.
 * @typedef {object} CommitModelSelection
 * @property {string} provider - registered provider route.
 * @property {string} model - provider-owned model id.
 * @property {string} [reasoningEffort] - adapter-owned reasoning effort.
 */

/** Authenticated Client route backing the panel. */
const ROUTE_PATH = '/api/git-control';
/** Authenticated route serving one image side as raw bytes. */
const BLOB_PATH = '/api/git-control/blob';

/** Branch names that the panel may create, switch to, or delete. */
const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
/** Commit references that the panel may reset to or revert. */
const COMMIT_REF = /^[0-9a-fA-F]{4,40}$/;
/** Stash entries the panel may apply or drop. */
const STASH_REF = /^stash@\{\d{1,3}\}$/;
/** Accepted `git reset` modes. */
const RESET_MODES = new Set(['soft', 'mixed', 'hard']);
/** Field and record separators used by every `--format` this service reads. */
const FIELD_SEPARATOR = '\x1f';
const RECORD_SEPARATOR = '\x1e';
/** Porcelain codes that describe an unresolved merge conflict. */
const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/** Every action the Client route may dispatch. */
const ACTIONS = new Set([
  'status',
  'diff',
  'stage',
  'unstage',
  'discard',
  'commit',
  'log',
  'branches',
  'createBranch',
  'checkout',
  'deleteBranch',
  'fetch',
  'pull',
  'push',
  'stashSave',
  'stashList',
  'stashApply',
  'stashDrop',
  'revert',
  'reset',
  'stageAll',
  'generateCommitMessage',
]);

/** Actions that change the work tree, index, refs, or the remote. */
const MUTATING_ACTIONS = new Set([
  'stage',
  'unstage',
  'discard',
  'commit',
  'createBranch',
  'checkout',
  'deleteBranch',
  'fetch',
  'pull',
  'push',
  'stashSave',
  'stashApply',
  'stashDrop',
  'revert',
  'reset',
  'stageAll',
]);

/**
 * Build a failure carrying the machine code and git context the panel shows.
 * @param code - stable machine code.
 * @param message - human-readable explanation.
 * @param extra - additional fields merged into the failure.
 * @returns the error to throw.
 */
function gitFailure(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

/**
 * Validate one absolute repository path supplied by the Client.
 * @param value - candidate path.
 * @returns the accepted path.
 */
function requireRepoPath(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw gitFailure('git-control/bad-request', 'A repository directory is required.');
  }
  if (value.length > 4096 || value.includes('\0')) {
    throw gitFailure('git-control/bad-request', 'The repository directory is not a valid path.');
  }
  if (!path.isAbsolute(value)) {
    throw gitFailure('git-control/bad-request', 'The repository directory must be absolute.');
  }
  return value;
}

/**
 * Validate repository-relative paths so a request can never address anything
 * outside the repository it names.
 * @param value - candidate path list.
 * @returns the accepted paths.
 */
function requireRelativePaths(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw gitFailure('git-control/bad-request', 'Select at least one path.');
  }
  if (value.length > 500) {
    throw gitFailure('git-control/bad-request', 'Too many paths in one request.');
  }
  return value.map((entry) => {
    if (typeof entry !== 'string' || entry === '' || entry.length > 2048) {
      throw gitFailure('git-control/bad-request', 'A requested path is not valid.');
    }
    if (/[\0\r\n]/.test(entry)) {
      throw gitFailure('git-control/bad-request', 'A requested path contains a control character.');
    }
    if (path.isAbsolute(entry) || entry.startsWith('-')) {
      throw gitFailure('git-control/bad-request', `Only repository-relative paths are accepted: ${entry}`);
    }
    if (entry.split('/').includes('..')) {
      throw gitFailure('git-control/bad-request', `A requested path leaves the repository: ${entry}`);
    }
    return entry;
  });
}

/**
 * Validate a branch name before it reaches git.
 * @param value - candidate name.
 * @returns the accepted name.
 */
function requireBranchName(value) {
  if (typeof value !== 'string' || !BRANCH_NAME.test(value) || value.includes('..')) {
    throw gitFailure('git-control/bad-request', 'That branch name is not accepted.');
  }
  return value;
}

/**
 * Validate a commit hash before it reaches git.
 * @param value - candidate reference.
 * @returns the accepted reference.
 */
function requireCommitRef(value) {
  if (typeof value !== 'string' || !COMMIT_REF.test(value)) {
    throw gitFailure('git-control/bad-request', 'That commit reference is not accepted.');
  }
  return value;
}

/**
 * Validate a stash entry reference such as `stash@{0}`.
 * @param value - candidate reference.
 * @returns the accepted reference.
 */
function requireStashRef(value) {
  if (typeof value !== 'string' || !STASH_REF.test(value)) {
    throw gitFailure('git-control/bad-request', 'That stash reference is not accepted.');
  }
  return value;
}

/**
 * Media type for a repository path the panel previews as an image.
 * @param file - repository-relative path.
 * @returns the media type, or null when the extension is not a known image.
 */
function imageMimeOf(file) {
  const dot = file.lastIndexOf('.');
  if (dot === -1 || dot === file.length - 1) return null;
  return IMAGE_TYPES.get(file.slice(dot + 1).toLowerCase()) ?? null;
}

/**
 * Build one plain-text response for the image route.
 * @param status - HTTP status code.
 * @param message - explanation for the panel's log.
 * @returns the response.
 */
function imageFailure(status, message) {
  return new Response(`${message}\n`, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * Read records rendered by a `--format` that separates fields with the unit
 * separator and records with the record separator.
 * @param stdout - raw git output.
 * @returns one field array per record.
 */
function readRecords(stdout) {
  return stdout
    .split('\x1e')
    .map((record) => record.trim())
    .filter((record) => record !== '')
    .map((record) => record.split('\x1f'));
}

/**
 * Parse `git status --porcelain=v1 -z --branch` into work-tree facts.
 * @param stdout - NUL-separated porcelain stream.
 * @returns branch tracking facts and one row per changed path.
 */
function parseStatus(stdout) {
  const parts = stdout.split('\0');
  const files = [];
  let branch = null;
  let upstream = null;
  let upstreamGone = false;
  let ahead = 0;
  let behind = 0;
  let detached = false;
  let noCommits = false;

  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index];
    if (entry === '') continue;

    if (entry.startsWith('## ')) {
      const header = entry.slice(3);
      if (header.startsWith('No commits yet on ')) {
        branch = header.slice('No commits yet on '.length);
        noCommits = true;
      } else if (header.startsWith('HEAD (no branch)')) {
        detached = true;
      } else {
        /* The tracking block is `[ahead 1, behind 2]`: read the whole header,
           because splitting on spaces truncates it at the first word. */
        const [refs] = header.split(' ');
        const [head, remote] = refs.split('...');
        branch = head;
        upstream = remote === undefined ? null : remote;
        const aheadMatch = /ahead (\d+)/.exec(header);
        const behindMatch = /behind (\d+)/.exec(header);
        ahead = aheadMatch === null ? 0 : Number(aheadMatch[1]);
        behind = behindMatch === null ? 0 : Number(behindMatch[1]);
        upstreamGone = header.includes('[gone]');
      }
      continue;
    }

    if (entry.length < 4) continue;
    const x = entry[0];
    const y = entry[1];
    const filePath = entry.slice(3);
    let originalPath;
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      originalPath = parts[index + 1];
      index += 1;
    }
    const code = x + y;
    if (x === '!' && y === '!') continue;
    const untracked = code === '??';
    const conflicted = CONFLICT_CODES.has(code);
    files.push({
      path: filePath,
      originalPath: originalPath === undefined || originalPath === '' ? null : originalPath,
      code,
      untracked,
      conflicted,
      staged: !untracked && !conflicted && x !== ' ' && x !== '?',
      unstaged: !untracked && !conflicted && y !== ' ' && y !== '?',
    });
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return { branch, upstream, upstreamGone, ahead, behind, detached, noCommits, files };
}

/**
 * Reduce a model reply to a commit message.
 * @param value - raw model output.
 * @returns the trimmed message, at most `MESSAGE_MAX_CHARS` characters.
 */
function cleanCommitMessage(value) {
  let text = String(value).replace(/\r\n/gu, '\n').trim();
  const fenced = /^```[A-Za-z]*\n([\s\S]*?)\n?```$/u.exec(text);
  if (fenced !== null) text = fenced[1].trim();
  text = text.replace(/^(?:commit message|message)\s*:\s*/iu, '');
  text = text.replace(/^["'`]+/u, '').replace(/["'`]+$/u, '').trim();
  return text.slice(0, MESSAGE_MAX_CHARS).trim();
}

/**
 * Read the configured commit-message model.
 * @param raw - the plugin's `commitModel` config value, if any.
 * @returns the validated selection, or null when the plugin config leaves it unset.
 * @throws a `git-control/bad-config` failure when the value is present but malformed.
 */
function configuredCommitModel(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw gitFailure('git-control/bad-config', 'commitModel must be an object with provider and model.');
  }
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : '';
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  if (provider === '' || model === '') {
    throw gitFailure('git-control/bad-config', 'commitModel.provider and commitModel.model must both be non-empty strings.');
  }
  const effort = raw.reasoningEffort;
  if (effort !== undefined && effort !== null && typeof effort !== 'string') {
    throw gitFailure('git-control/bad-config', 'commitModel.reasoningEffort must be a string when set.');
  }
  const reasoningEffort = typeof effort === 'string' && effort.trim() !== '' ? effort.trim() : undefined;
  return reasoningEffort === undefined ? { provider, model } : { provider, model, reasoningEffort };
}

/**
 * Take the first non-empty line of git output.
 * @param text - git output.
 * @returns the line, or an empty string.
 */
function firstLine(text) {
  const line = text.split('\n').map((entry) => entry.trim()).find((entry) => entry !== '');
  return line === undefined ? '' : line;
}

/**
 * Take the last non-empty line of git output.
 * @param text - git output.
 * @returns the line, or an empty string.
 */
function lastLine(text) {
  const lines = text.split('\n').map((entry) => entry.trim()).filter((entry) => entry !== '');
  return lines.length === 0 ? '' : lines[lines.length - 1];
}

/** One git service over the process and filesystem providers of this context. */
class GitControl {
  /**
   * @param ctx - plugin context carrying `subprocess` and `fs`.
   * @param logger - plugin logger for unexpected failures.
   * @param commitModel - raw `commitModel` plugin config, validated on use.
   */
  constructor(ctx, logger, commitModel = null) {
    this.ctx = ctx;
    this.logger = logger;
    this.commitModel = commitModel;
  }

  /**
   * Run one git command and collect its output.
   * @param cwd - directory git runs in.
   * @param args - argv tail, never shell-interpreted.
   * @param options - signal, timeout, accepted exit codes, and whether stdout is
   * raw bytes (`binary: true`) instead of decoded text.
   * @returns exit code plus collected stdout (text) or bytes, and stderr.
   */
  async run(cwd, args, options = {}) {
    const { signal, timeoutMs = LOCAL_TIMEOUT_MS, acceptCodes = [0], binary = false } = options;
    if (signal?.aborted) {
      throw gitFailure('git-control/cancelled', 'The request was cancelled.');
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      let handle;
      try {
        handle = this.ctx.subprocess.spawn({
          argv: ['git', ...args],
          cwd,
          stdio: {
            stdin: 'ignore',
            stdout: binary ? 'pipe' : { maxBytes: MAX_STDOUT_BYTES },
            stderr: { maxBytes: MAX_STDERR_BYTES },
          },
          graceMs: 2000,
          signal: controller.signal,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_PAGER: 'cat',
            GIT_OPTIONAL_LOCKS: '0',
          },
        });
      } catch (error) {
        throw gitFailure('git-control/spawn-failed', `git could not start: ${error instanceof Error ? error.message : String(error)}`);
      }

      /* A piped stdout must be drained while the process runs, or the pipe
         buffer fills and git blocks forever. */
      const chunks = [];
      let totalBytes = 0;
      let overflow = false;
      const drain = binary
        ? (async () => {
            if (handle.stdout === undefined) return;
            for await (const chunk of handle.stdout) {
              const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              totalBytes += buffer.length;
              if (totalBytes > MAX_IMAGE_BYTES) {
                overflow = true;
                handle.terminate();
                return;
              }
              chunks.push(buffer);
            }
          })()
        : Promise.resolve();

      let outcome;
      try {
        [, outcome] = await Promise.all([drain, handle.done]);
      } catch (error) {
        if (timedOut) {
          throw gitFailure('git-control/timeout', `git ${args[0]} timed out.`);
        }
        if (signal?.aborted) {
          throw gitFailure('git-control/cancelled', 'The request was cancelled.');
        }
        throw gitFailure('git-control/spawn-failed', `git ${args[0]} failed to run: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (overflow) {
        throw gitFailure('git-control/too-large', `git ${args[0]} produced more than ${MAX_IMAGE_BYTES} bytes.`);
      }

      const stderr = handle.collected?.stderr === undefined ? '' : handle.collected.stderr.readFrom(0).text;
      const exitCode = outcome.exitCode === null || outcome.exitCode === undefined ? -1 : outcome.exitCode;
      if (!acceptCodes.includes(exitCode)) {
        throw gitFailure(
          'git-control/command-failed',
          firstLine(stderr) || `git ${args[0]} failed (exit ${exitCode}).`,
          { exitCode, command: ['git', ...args].join(' '), stderr: stderr.slice(0, 4000) },
        );
      }
      if (binary) {
        return { exitCode, bytes: Buffer.concat(chunks), stderr };
      }
      const stdout = handle.collected?.stdout === undefined ? '' : handle.collected.stdout.readFrom(0).text;
      return { exitCode, stdout, stderr };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Resolve the repository root that holds one directory.
   * @param repoPath - absolute directory inside (or at the root of) a repository.
   * @param signal - caller cancellation.
   * @returns the absolute repository root.
   */
  async root(repoPath, signal) {
    const directory = requireRepoPath(repoPath);
    const result = await this.run(directory, ['rev-parse', '--show-toplevel'], { signal, acceptCodes: [0, 128] });
    const root = result.stdout.trim();
    if (result.exitCode !== 0 || root === '') {
      throw gitFailure('git-control/not-a-repository', `${directory} is not inside a git repository.`);
    }
    return root;
  }

  /**
   * Read branch tracking facts and every changed path.
   * @param input - `{ path }` naming the repository.
   * @param signal - caller cancellation.
   * @returns the status payload the panel renders.
   */
  async status(input, signal) {
    const root = await this.root(input?.path, signal);
    const [statusResult, headResult, stashResult] = await Promise.all([
      this.run(root, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'], { signal }),
      this.run(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], { signal, acceptCodes: [0, 1, 128] }),
      this.run(root, ['stash', 'list', '--format=%gd'], { signal }),
    ]);

    const parsed = parseStatus(statusResult.stdout);
    return {
      root,
      name: path.basename(root),
      branch: parsed.branch,
      upstream: parsed.upstream,
      upstreamGone: parsed.upstreamGone,
      ahead: parsed.ahead,
      behind: parsed.behind,
      detached: parsed.detached,
      noCommits: parsed.noCommits || headResult.exitCode !== 0,
      stashCount: stashResult.stdout.split('\n').filter((line) => line.trim() !== '').length,
      files: parsed.files,
    };
  }

  /**
   * Render one path comparison for the panel.
   * @param input - `{ path, file, staged, untracked, conflicted, originalPath }`.
   * @param signal - caller cancellation.
   * @returns an image comparison, diff text, or an untracked file preview.
   */
  async diff(input, signal) {
    const root = await this.root(input?.path, signal);
    const file = requireRelativePaths([input?.file])[0];

    const originalPath = typeof input?.originalPath === 'string' && input.originalPath !== ''
      ? requireRelativePaths([input.originalPath])[0]
      : null;
    const image = await this.imageInfo(root, file, {
      staged: input?.staged === true,
      untracked: input?.untracked === true,
      conflicted: input?.conflicted === true,
      originalPath,
    }, signal);
    if (image !== null) return image;

    if (input?.untracked === true) {
      return this.readUntracked(root, file);
    }

    const staged = input?.staged === true;
    const result = await this.run(root, [
      'diff',
      '--no-color',
      '--unified=3',
      ...(staged ? ['--cached'] : []),
      '--',
      file,
    ], { signal });

    return {
      kind: staged ? 'staged' : 'unstaged',
      text: result.stdout.slice(0, MAX_DIFF_CHARS),
      truncated: result.stdout.length > MAX_DIFF_CHARS,
    };
  }

  /**
   * Describe one image comparison for the panel: the old and the new side, each
   * with the repository path, byte size, and content token the preview URL
   * carries.
   * @param root - repository root.
   * @param file - repository-relative path.
   * @param options - `{ staged, untracked, conflicted, originalPath }`.
   * @param signal - caller cancellation.
   * @returns the image payload, or null when the path is not a previewable image.
   */
  async imageInfo(root, file, options, signal) {
    const mime = imageMimeOf(file);
    if (mime === null || options.conflicted === true) return null;

    if (options.untracked === true) {
      const current = await this.worktreeImage(root, file, signal);
      if (current === null) return null;
      return { kind: 'image', root, mime, untracked: true, staged: false, old: null, new: current };
    }

    const staged = options.staged === true;
    const beforePath = options.originalPath ?? file;
    const [old, current] = await Promise.all([
      this.objectImage(root, staged ? `HEAD:${beforePath}` : `:${beforePath}`, staged ? 'head' : 'index', beforePath, signal),
      staged
        ? this.objectImage(root, `:${file}`, 'index', file, signal)
        : this.worktreeImage(root, file, signal),
    ]);
    if (old === null && current === null) return null;
    return { kind: 'image', root, mime, untracked: false, staged, old, new: current };
  }

  /**
   * Facts about one blob revision, or null when that side holds no blob.
   * @param root - repository root.
   * @param rev - revision expression such as `HEAD:logo.png` or `:logo.png`.
   * @param side - which side of the comparison this revision is.
   * @param file - repository-relative path the revision names.
   * @param signal - caller cancellation.
   * @returns `{ side, path, size, token, previewable }`, or null.
   */
  async objectImage(root, rev, side, file, signal) {
    const [resolved, sizeResult] = await Promise.all([
      this.run(root, ['rev-parse', '--verify', '--quiet', rev], { signal, acceptCodes: [0, 1, 128] }),
      this.run(root, ['cat-file', '-s', rev], { signal, acceptCodes: [0, 1, 128] }),
    ]);
    const oid = resolved.stdout.trim();
    const size = Number(sizeResult.stdout.trim());
    if (resolved.exitCode !== 0 || !/^[0-9a-f]{4,64}$/.test(oid)) return null;
    if (sizeResult.exitCode !== 0 || !Number.isSafeInteger(size) || size < 0) return null;
    return { side, path: file, size, token: oid, previewable: size <= MAX_IMAGE_BYTES };
  }

  /**
   * Facts about the work-tree copy of one image, or null when it is absent.
   * @param root - repository root.
   * @param file - repository-relative path.
   * @param signal - caller cancellation.
   * @returns `{ side, path, size, token, previewable }`, or null.
   */
  async worktreeImage(root, file, signal) {
    try {
      const target = await this.ctx.fs.resolve(file, { cwd: root, signal });
      const info = await this.ctx.fs.stat(target, signal);
      if (info === undefined || info.type !== 'file') return null;
      const size = info.size ?? 0;
      return { side: 'worktree', path: file, size, token: String(info.version), previewable: size <= MAX_IMAGE_BYTES };
    } catch {
      return null;
    }
  }

  /**
   * Serve one image side as raw bytes for the panel's preview.
   * @param url - request URL carrying `path`, `file`, `side`, and a cache token.
   * @param signal - request cancellation.
   * @returns the image response, or a plain failure.
   */
  async serveImage(url, signal) {
    const directory = url.searchParams.get('path') ?? '';
    const file = url.searchParams.get('file') ?? '';
    const side = url.searchParams.get('side') ?? '';

    let mime;
    let bytes;
    try {
      const root = await this.root(directory, signal);
      const relative = requireRelativePaths([file])[0];
      mime = imageMimeOf(relative);
      if (mime === null) return imageFailure(415, 'That path is not a previewable image.');
      if (side === 'worktree') {
        bytes = await this.worktreeBytes(root, relative, signal);
      } else if (side === 'index') {
        bytes = await this.objectBytes(root, `:${relative}`, signal);
      } else if (side === 'head') {
        bytes = await this.objectBytes(root, `HEAD:${relative}`, signal);
      } else {
        return imageFailure(400, 'Unknown image side.');
      }
      if (bytes === null) return imageFailure(404, 'The image is not present on that side.');
    } catch (error) {
      const tooLarge = error?.code === 'git-control/too-large' || error?.code === 'FS_TOO_LARGE';
      return imageFailure(tooLarge ? 413 : 404, error instanceof Error ? error.message : 'The image could not be read.');
    }

    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': mime,
        'content-length': String(bytes.byteLength),
        'cache-control': 'private, max-age=60, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  }

  /**
   * Read the work-tree bytes of one image.
   * @param root - repository root.
   * @param file - repository-relative path.
   * @param signal - caller cancellation.
   * @returns the bytes, or null when the path is absent or not a regular file.
   */
  async worktreeBytes(root, file, signal) {
    const rootTarget = await this.ctx.fs.resolve(root, { signal });
    const target = await this.ctx.fs.resolve(file, { cwd: root, signal });
    if (!this.ctx.fs.contains(rootTarget, target)) return null;
    const info = await this.ctx.fs.stat(target, signal);
    if (info === undefined || info.type !== 'file') return null;
    if ((info.size ?? 0) > MAX_IMAGE_BYTES) {
      throw gitFailure('git-control/too-large', `The image is larger than ${MAX_IMAGE_BYTES} bytes.`);
    }
    return this.ctx.fs.readBytes(target, signal, MAX_IMAGE_BYTES);
  }

  /**
   * Read one blob from the object store as raw bytes.
   * @param root - repository root.
   * @param rev - revision expression naming a blob.
   * @param signal - caller cancellation.
   * @returns the bytes, or null when the revision holds no blob.
   */
  async objectBytes(root, rev, signal) {
    const result = await this.run(root, ['cat-file', 'blob', rev], { signal, binary: true, acceptCodes: [0, 128] });
    if (result.exitCode !== 0) return null;
    return result.bytes;
  }

  /**
   * Read a file git does not track yet, so the panel can show its content.
   * @param root - repository root.
   * @param file - repository-relative path.
   * @returns preview text.
   */
  async readUntracked(root, file) {
    try {
      const target = await this.ctx.fs.resolve(file, { cwd: root });
      const info = await this.ctx.fs.stat(target);
      if (info === undefined || info.type !== 'file') {
        return { kind: 'untracked', text: '', binary: true, truncated: false };
      }
      const text = await this.ctx.fs.readText(target);
      return {
        kind: 'untracked',
        text: text.slice(0, MAX_UNTRACKED_CHARS),
        truncated: text.length > MAX_UNTRACKED_CHARS,
      };
    } catch {
      return { kind: 'untracked', text: '', binary: true, truncated: false };
    }
  }

  /**
   * Stage the given paths.
   * @param input - `{ path, paths }`.
   * @param signal - caller cancellation.
   * @returns a one-line summary.
   */
  async stage(input, signal) {
    const root = await this.root(input?.path, signal);
    const paths = requireRelativePaths(input?.paths);
    await this.run(root, ['add', '--', ...paths], { signal });
    return { message: `Staged ${paths.length} path${paths.length === 1 ? '' : 's'}.` };
  }

  /**
   * Remove the given paths from the index without touching the work tree.
   * @param input - `{ path, paths }`.
   * @param signal - caller cancellation.
   * @returns a one-line summary.
   */
  async unstage(input, signal) {
    const root = await this.root(input?.path, signal);
    const paths = requireRelativePaths(input?.paths);
    const result = await this.run(root, ['restore', '--staged', '--', ...paths], { signal, acceptCodes: [0, 1, 128] });
    if (result.exitCode !== 0) {
      // A repository without commits cannot restore from HEAD; drop the index entries instead.
      await this.run(root, ['rm', '--cached', '--quiet', '--', ...paths], { signal });
    }
    return { message: `Unstaged ${paths.length} path${paths.length === 1 ? '' : 's'}.` };
  }

  /**
   * Throw away work-tree changes for the given paths.
   * @param input - `{ path, paths, untracked }`.
   * @param signal - caller cancellation.
   * @returns a one-line summary.
   */
  async discard(input, signal) {
    const root = await this.root(input?.path, signal);
    const paths = requireRelativePaths(input?.paths);
    if (input?.untracked === true) {
      await this.run(root, ['clean', '-f', '-d', '--', ...paths], { signal });
    } else {
      await this.run(root, ['restore', '--', ...paths], { signal });
    }
    return { message: `Discarded changes in ${paths.length} path${paths.length === 1 ? '' : 's'}.` };
  }

  /**
   * Commit what is staged.
   * @param input - `{ path, message }`.
   * @param signal - caller cancellation.
   * @returns the new commit hash.
   */
  async commit(input, signal) {
    const root = await this.root(input?.path, signal);
    const message = typeof input?.message === 'string' ? input.message.trim() : '';
    if (message === '') {
      throw gitFailure('git-control/bad-request', 'A commit message is required.');
    }
    await this.run(root, ['commit', '--no-gpg-sign', '-m', message], { signal });
    const head = await this.run(root, ['rev-parse', 'HEAD'], { signal });
    return { message: 'Committed staged changes.', head: head.stdout.trim() };
  }

  /**
   * Read commit history.
   * @param input - `{ path, limit }`.
   * @param signal - caller cancellation.
   * @returns newest-first commit rows.
   */
  async log(input, signal) {
    const root = await this.root(input?.path, signal);
    const requested = Number(input?.limit);
    const limit = Number.isSafeInteger(requested) && requested > 0
      ? Math.min(requested, MAX_LOG_LIMIT)
      : DEFAULT_LOG_LIMIT;
    const result = await this.run(root, [
      'log',
      '--no-color',
      `--max-count=${limit}`,
      `--format=%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%s${RECORD_SEPARATOR}`,
    ], { signal, acceptCodes: [0, 128] });
    if (result.exitCode !== 0) return { commits: [] };
    return {
      commits: readRecords(result.stdout).map(([hash, short, author, date, subject]) => ({
        hash, short, author, date, subject,
      })),
    };
  }

  /**
   * List local and remote branches.
   * @param input - `{ path }`.
   * @param signal - caller cancellation.
   * @returns branch rows.
   */
  async branches(input, signal) {
    const root = await this.root(input?.path, signal);
    const [local, remote] = await Promise.all([
      this.run(root, [
        'branch',
        '--list',
        '--no-color',
        `--format=%(refname:short)${FIELD_SEPARATOR}%(HEAD)${FIELD_SEPARATOR}%(upstream:short)${FIELD_SEPARATOR}%(committerdate:iso-strict)${FIELD_SEPARATOR}%(subject)${RECORD_SEPARATOR}`,
      ], { signal }),
      this.run(root, [
        'branch',
        '--remotes',
        '--no-color',
        `--format=%(refname:short)${FIELD_SEPARATOR}%(committerdate:iso-strict)${FIELD_SEPARATOR}%(subject)${RECORD_SEPARATOR}`,
      ], { signal }),
    ]);

    return {
      local: readRecords(local.stdout).map(([name, head, upstream, date, subject]) => ({
        name,
        current: head === '*',
        upstream: upstream === undefined || upstream === '' ? null : upstream,
        date,
        subject,
      })),
      remote: readRecords(remote.stdout).slice(0, MAX_REMOTE_BRANCHES).map(([name, date, subject]) => ({
        name, date, subject,
      })),
    };
  }

  /**
   * Create a branch, optionally switching to it.
   * @param input - `{ path, name, checkout }`.
   * @param signal - caller cancellation.
   * @returns a one-line summary.
   */
  async createBranch(input, signal) {
    const root = await this.root(input?.path, signal);
    const name = requireBranchName(input?.name);
    if (input?.checkout === true) {
      await this.run(root, ['checkout', '-b', name], { signal });
      return { message: `Created and switched to ${name}.` };
    }
    await this.run(root, ['branch', name], { signal });
    return { message: `Created ${name}.` };
  }

  /**
   * Switch to an existing branch.
   * @param input - `{ path, name }`.
   * @param signal - caller cancellation.
   * @returns a one-line summary.
   */
  async checkout(input, signal) {
    const root = await this.root(input?.path, signal);
    const name = requireBranchName(input?.name);
    await this.run(root, ['checkout', name], { signal });
    return { message: `Switched to ${name}.` };
  }

  /**
   * Delete a branch.
   * @param input - `{ path, name, force }`.
   * @param signal - caller cancellation.
   * @returns a one-line summary.
   */
  async deleteBranch(input, signal) {
    const root = await this.root(input?.path, signal);
    const name = requireBranchName(input?.name);
    await this.run(root, ['branch', input?.force === true ? '-D' : '-d', name], { signal });
    return { message: `Deleted ${name}.` };
  }

  /**
   * Fetch every configured remote and prune deleted refs.
   * @param input - `{ path }`.
   * @param signal - caller cancellation.
   * @returns git's own summary.
   */
  async fetch(input, signal) {
    const root = await this.root(input?.path, signal);
    const result = await this.run(root, ['fetch', '--all', '--prune'], { signal, timeoutMs: NETWORK_TIMEOUT_MS });
    return { message: lastLine(result.stderr) || 'Fetched all remotes.' };
  }

  /**
   * Fast-forward the current branch from its upstream.
   * @param input - `{ path }`.
   * @param signal - caller cancellation.
   * @returns git's own summary.
   */
  async pull(input, signal) {
    const root = await this.root(input?.path, signal);
    const result = await this.run(root, ['pull', '--ff-only'], { signal, timeoutMs: NETWORK_TIMEOUT_MS });
    return { message: lastLine(result.stdout) || lastLine(result.stderr) || 'Pulled from upstream.' };
  }

  /**
   * Push the current branch, setting its upstream when it has none.
   * @param input - `{ path }`.
   * @param signal - caller cancellation.
   * @returns git's own summary.
   */
  async push(input, signal) {
    const root = await this.root(input?.path, signal);
    const status = await this.status({ path: root }, signal);
    if (status.detached || status.branch === null) {
      throw gitFailure('git-control/no-branch', 'Check out a branch before pushing.');
    }
    const unpublished = status.upstream === null || status.upstreamGone;
    const args = unpublished
      ? ['push', '--set-upstream', 'origin', status.branch]
      : ['push'];
    const result = await this.run(root, args, { signal, timeoutMs: NETWORK_TIMEOUT_MS });
    return { message: lastLine(result.stderr) || lastLine(result.stdout) || 'Pushed.' };
  }

  /**
   * Stash the whole work tree.
   * @param input - `{ path, message, untracked }`.
   * @param signal - caller cancellation.
   * @returns a one-line summary.
   */
  async stashSave(input, signal) {
    const root = await this.root(input?.path, signal);
    const message = typeof input?.message === 'string' ? input.message.trim() : '';
    const args = ['stash', 'push'];
    if (input?.untracked === true) args.push('--include-untracked');
    if (message !== '') args.push('-m', message);
    await this.run(root, args, { signal });
    return { message: 'Stashed the working changes.' };
  }

  /**
   * List stash entries.
   * @param input - `{ path }`.
   * @param signal - caller cancellation.
   * @returns stash rows, newest first.
   */
  async stashList(input, signal) {
    const root = await this.root(input?.path, signal);
    const result = await this.run(root, [
      'stash',
      'list',
      '--no-color',
      `--format=%gd${FIELD_SEPARATOR}%gs${FIELD_SEPARATOR}%cr${RECORD_SEPARATOR}`,
    ], { signal });
    return {
      stashes: readRecords(result.stdout).map(([ref, subject, when]) => ({ ref, subject, when })),
    };
  }

  /**
   * Apply or pop one stash entry.
   * @param input - `{ path, ref, pop }`.
   * @param signal - caller cancellation.
   * @returns a one-line summary.
   */
  async stashApply(input, signal) {
    const root = await this.root(input?.path, signal);
    const ref = requireStashRef(input?.ref);
    const pop = input?.pop === true;
    await this.run(root, ['stash', pop ? 'pop' : 'apply', ref], { signal });
    return { message: `${pop ? 'Popped' : 'Applied'} ${ref}.` };
  }

  /**
   * Drop one stash entry.
   * @param input - `{ path, ref }`.
   * @param signal - caller cancellation.
   * @returns a one-line summary.
   */
  async stashDrop(input, signal) {
    const root = await this.root(input?.path, signal);
    const ref = requireStashRef(input?.ref);
    await this.run(root, ['stash', 'drop', ref], { signal });
    return { message: `Dropped ${ref}.` };
  }

  /**
   * Revert one commit with an automatic message.
   * @param input - `{ path, ref }`.
   * @param signal - caller cancellation.
   * @returns a one-line summary.
   */
  async revert(input, signal) {
    const root = await this.root(input?.path, signal);
    const ref = requireCommitRef(input?.ref);
    await this.run(root, ['revert', '--no-edit', ref], { signal });
    return { message: `Reverted ${ref}.` };
  }

  /**
   * Move the current branch to a commit.
   * @param input - `{ path, ref, mode }`.
   * @param signal - caller cancellation.
   * @returns a one-line summary.
   */
  async reset(input, signal) {
    const root = await this.root(input?.path, signal);
    const ref = requireCommitRef(input?.ref);
    const mode = input?.mode === undefined ? 'mixed' : String(input.mode);
    if (!RESET_MODES.has(mode)) {
      throw gitFailure('git-control/bad-request', 'A reset mode must be soft, mixed, or hard.');
    }
    await this.run(root, ['reset', `--${mode}`, ref], { signal });
    return { message: `Reset (${mode}) to ${ref}.` };
  }

  /**
   * Stage every change, deletions and untracked files included.
   * @param input - `{ path }`.
   * @param signal - caller cancellation.
   * @returns a one-line summary.
   */
  async stageAll(input, signal) {
    const root = await this.root(input?.path, signal);
    await this.run(root, ['add', '--all'], { signal });
    return { message: 'Staged every change.' };
  }

  /**
   * Collect the material one commit message is written from.
   * @param root - repository root.
   * @param status - the current status payload.
   * @param signal - caller cancellation.
   * @returns staged or working-tree diff text plus recent subjects.
   */
  async commitContext(root, status, signal) {
    const files = status.files.map((file) => `${file.code} ${file.path}`).join('\n');
    let diff = '';
    let scope = 'staged';
    if (status.files.some((file) => file.staged)) {
      const staged = await this.run(root, ['diff', '--cached', '--no-color', '--unified=1'], { signal, acceptCodes: [0, 128] });
      diff = staged.stdout;
    }
    if (diff.trim() === '') {
      const working = await this.run(root, ['diff', '--no-color', '--unified=1'], { signal, acceptCodes: [0, 128] });
      diff = working.stdout;
      scope = 'working tree';
    }
    if (diff.trim() === '') {
      // Only untracked files exist, so their names are the whole story.
      scope = 'new files';
      diff = status.files.filter((file) => file.untracked).map((file) => file.path).join('\n');
    }
    const log = await this.run(root, ['log', '--no-color', '--max-count=10', '--format=%s'], { signal, acceptCodes: [0, 128] });
    return {
      files,
      scope,
      diff: diff.slice(0, PROMPT_DIFF_CHARS),
      truncated: diff.length > PROMPT_DIFF_CHARS,
      recent: log.stdout.trim(),
      branch: status.branch,
      name: status.name,
    };
  }

  /**
   * Ask the configured model for one commit message.
   * @param selection - provider, model, and optional reasoning effort.
   * @param context - the material gathered by `commitContext`.
   * @param signal - caller cancellation.
   * @returns the cleaned message.
   */
  async completeCommitMessage(selection, context, signal) {
    const llm = this.ctx.get('llm');
    if (llm === undefined) {
      throw gitFailure('git-control/no-model', 'The llm service is unavailable, so no message can be generated.');
    }

    const prompt = [
      `Repository: ${context.name}`,
      context.branch === null ? 'Branch: detached HEAD' : `Branch: ${context.branch}`,
      `Diff scope: ${context.scope}`,
      '',
      'Changed paths:',
      context.files,
      '',
      context.recent === '' ? '' : `Recent commit subjects for style:\n${context.recent}\n`,
      context.truncated ? 'Diff (truncated):' : 'Diff:',
      context.diff,
    ].filter((line) => line !== null).join('\n');

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, MESSAGE_TIMEOUT_MS);

    let raw = '';
    try {
      const stream = llm.stream({
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
        system: [
          'You write one git commit message for the staged change described below.',
          'Reply with the message only: no preamble, no explanation, no code fences, no quotes.',
          'First line: imperative mood, at most 72 characters, no trailing period.',
          'Add a short body after one blank line only when the change needs the detail.',
          'Use Conventional Commit prefixes (feat, fix, refactor, docs, test, chore) when they fit.',
          'Write in English and describe only what the diff shows.',
        ].join(' '),
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        maxTokens: MESSAGE_MAX_TOKENS,
        temperature: 0.2,
        signal: controller.signal,
      });

      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') {
          raw += chunk.text;
          if (raw.length > MESSAGE_MAX_CHARS * 2) break;
        } else if (chunk.type === 'finish') {
          if (chunk.reason.kind === 'error') {
            throw gitFailure('git-control/model-failed', chunk.reason.failure.message);
          }
          if (chunk.reason.kind === 'aborted') {
            throw timedOut
              ? gitFailure('git-control/timeout', 'Message generation timed out.')
              : gitFailure('git-control/cancelled', 'Message generation was cancelled.');
          }
        }
      }
    } catch (error) {
      if (timedOut) throw gitFailure('git-control/timeout', 'Message generation timed out.');
      if (signal?.aborted) throw gitFailure('git-control/cancelled', 'Message generation was cancelled.');
      if (typeof error?.code === 'string' && error.code.startsWith('git-control/')) throw error;
      throw gitFailure('git-control/model-failed', error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    const message = cleanCommitMessage(raw);
    if (message === '') {
      throw gitFailure('git-control/empty-message', 'The model returned no usable commit message.');
    }
    return { message, scope: context.scope, truncated: context.truncated };
  }

  /**
   * Generate a commit message for the current change.
   * @param input - `{ path }`.
   * @param signal - caller cancellation.
   * @returns the generated message.
   */
  async generateCommitMessage(input, signal) {
    const root = await this.root(input?.path, signal);
    const status = await this.status({ path: root }, signal);
    if (status.files.length === 0) {
      throw gitFailure('git-control/clean', 'There is nothing to describe: the work tree is clean.');
    }
    const configured = configuredCommitModel(this.commitModel);
    const selection = configured ?? this.ctx.get('agentDefaultModel')?.currentSelection();
    if (selection === undefined || selection === null) {
      throw gitFailure(
        'git-control/no-model',
        'No commit message model is configured: set the plugin\'s commitModel or a default agent model.',
      );
    }
    const context = await this.commitContext(root, status, signal);
    return this.completeCommitMessage(selection, context, signal);
  }

  /**
   * Run one panel action and return its outcome.
   * @param input - request body naming the action and its arguments.
   * @param signal - request cancellation.
   * @returns a discriminated outcome the panel can render.
   */
  async dispatch(input, signal) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return { ok: false, code: 'git-control/bad-request', message: 'The request body must be a JSON object.' };
    }
    const action = typeof input.action === 'string' ? input.action : '';
    if (!ACTIONS.has(action)) {
      return { ok: false, code: 'git-control/unknown-action', message: `Unknown action: ${action || '(none)'}` };
    }

    try {
      const data = await this[action](input, signal);
      if (MUTATING_ACTIONS.has(action)) {
        data.status = await this.status({ path: input.path }, signal);
      }
      return { ok: true, action, data };
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'git-control/failed';
      if (code === 'git-control/failed') {
        this.logger.warn(`git control: ${action} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return {
        ok: false,
        action,
        code,
        message: error instanceof Error ? error.message : String(error),
        command: error?.command,
        stderr: error?.stderr,
        exitCode: error?.exitCode,
      };
    }
  }
}

export const name = 'git-control';

/** Services the Host half cannot run without. */
export const inject = ['subprocess', 'fs', 'connection'];

/**
 * Mount the git service and its Client routes.
 * @param ctx - plugin context.
 * @param config - plugin options; `commitModel` overrides the model used for
 * message generation, and its absence falls back to the default agent model.
 */
export function apply(ctx, config = {}) {
  const service = new GitControl(ctx, ctx.logger, config?.commitModel ?? null);
  ctx.provide('gitControl', service);

  ctx.effect(() => {
    const disposers = [
      ctx.connection.fetch.register({
        path: ROUTE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let body;
          try {
            body = await request.json();
          } catch {
            return Response.json(
              { ok: false, code: 'git-control/bad-request', message: 'The request body must be JSON.' },
              { status: 400, headers: { 'cache-control': 'no-store' } },
            );
          }
          const outcome = await service.dispatch(body, request.signal);
          return Response.json(outcome, { headers: { 'cache-control': 'no-store' } });
        },
      }),
      ctx.connection.fetch.register({
        path: BLOB_PATH,
        methods: ['GET', 'HEAD'],
        requestBody: 'buffered',
        fetch: async (request) => service.serveImage(new URL(request.url), request.signal),
      }),
    ];
    return () => {
      for (const dispose of disposers) void dispose().catch(() => {});
    };
  }, 'git-control: routes');
}
