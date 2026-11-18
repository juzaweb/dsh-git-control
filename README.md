# Git Control

A sidebar panel for the DeepSeek Harness Web GUI that reads and drives one git
repository at a time: review the changes a workspace carries, stage and commit
them, manage branches and stashes, and sync with the remote.

## Where it lives

Two surfaces.

**The composer toolbar.** A **Review code** button sits in the chat composer's
tool row, beside the mode chips. It needs no tab open: one click submits the
message `/code-review-and-quality review and fix` to the current Session, which
runs the `code-review-and-quality` skill as an ordinary turn and fixes what it
finds. The draft already in the composer is left untouched. The label collapses
to its glyph in a narrow composer.

**A tab in the right Sidebar**, next to Workspace files, Terminal,
and Session Log. The tab is scoped to the open Session's working directory, so
it follows that Session into a Git worktree and shows no picker.

Open it from the right Sidebar's **Start** (guide) page: pick the
**Git control** card. The tab chip reads **Git** and the panel keeps the
Sidebar's narrow layout.

Any directory that git recognises works: the Host resolves
`git rev-parse --show-toplevel` and every later command runs at that root. The
directory is the Session's live `workingDirectory` projection, so a Session that
`cd`-ed or moved into a linked worktree inspects that worktree; the Session
header's immutable `cwd` and the Workspace path are only the fallbacks while no
projection value has landed.

## What it does

| Panel tab | Operations |
| --- | --- |
| Changes | read status, per-file diff (staged, unstaged, or an untracked preview), a before/after image preview for image files, stage, unstage, discard, stage everything, write the commit message, commit |
| Branches | list local and remote branches, create (optionally switching), switch, delete |
| History | newest-first log, revert a commit, reset the branch to a commit with soft / mixed / hard |
| Stash | save (optionally including untracked files), list, apply, pop, drop |

Row actions, the history actions, and the sync controls are **icon-only**: each
keeps its name in `aria-label`, repeats it in the `title` hint, and stays a full
hit target. Destructive ones are drawn in the error colour. A file row itself is
a real `button`, so a diff opens from the keyboard as well as from a click, and
its `aria-current` marks the row whose diff is open.

A sync control the branch cannot run yet is *soft-blocked*: it carries
`aria-disabled`, keeps its place in the tab order, and folds the reason into its
accessible name, so a keyboard or touch user still learns why Pull or Push is
unavailable. The reason is also printed as a line under the branch bar rather
than left in a `title`, which never opens on a nudge. Work already in flight
still uses the real `disabled` attribute.

The panel paints its surfaces with `color-mix` over the theme's own label and
background aliases rather than the `bg-layer-*` fills. Those fills collapse to
the page background in the light theme, which left row hover, row selection, and
every card boundary invisible there; the mixed surfaces and the 45%-label border
stay distinguishable in both themes. A status letter sits on a tinted pill with
`label-primary` text instead of carrying its meaning in the state colour alone,
which fails text contrast (2.3:1 for success, 2.2:1 for warning on white).

The panel is a narrow column, so its layout responds to its own width through
`@container` queries rather than to the viewport: the image pair stacks and the
PR row becomes a column at 420px and 340px of panel width. Only the compact
layout is rendered, so its rules are the only ones the stylesheet carries.
Infinite motion is dropped under `prefers-reduced-motion`.

The tab strip follows the ARIA tabs pattern: it answers Arrow/Home/End, exposes
one tab in the tab order, and each tab names the panel through `aria-controls`.
The confirmation dialog is portalled to the document body — the Sidebar panel is
moved with a transform, which would otherwise confine its `position: fixed`
scrim to the panel — traps Tab inside itself, focuses Cancel rather than Run so
a stray Enter cannot confirm a destructive command, and restores the previous
focus when it closes.

Selecting an image file (`png`, `jpg`, `jpeg`, `jfif`, `gif`, `webp`, `bmp`,
`ico`, `avif`, `svg`) opens a preview instead of a textual diff: the old and the
new bytes sit side by side under **Before** / **After** captions carrying the
byte size and, once loaded, the pixel dimensions. The old side is `HEAD` for a
staged path and the index for a working-tree path; the new side is the index or
the work tree. A side that holds no file shows *Not in this version*, an
untracked image shows one **New file** pane, and a side above 8 MiB is named
rather than fetched. A conflicted image keeps the textual fallback.

The commit card is shaped by the repository state:

| State | What the card does |
| --- | --- |
| Nothing staged, commits ahead | the button becomes `Push N commit(s)` — `Publish branch` when no upstream exists — so the step after a commit is one click |
| Nothing staged, remote ahead | the button becomes `Pull N commit(s)` |
| Nothing staged, nothing queued | collapses to a *Clean* chip plus one line: nothing to commit |
| Unmerged paths | marks *N conflicted*, blocks the button, asks to resolve them first |
| Changes, none staged | marks *N unstaged* / *N untracked*, keeps the composer open |
| Staged paths | button reads `Commit N file(s)` and enables once a message exists |

Once the branch is clean, fully pushed, and is not `main`, `master`, or
`develop`, the commit card adds a **pull request** composer: a title, an optional
description, and a base-branch picker seeded with the remote's default branch.
The default is resolved from the remote, not guessed from a branch name: the
cached `refs/remotes/origin/HEAD` is used while the branch it names still exists,
and otherwise `git ls-remote --symref origin HEAD` asks the remote and writes the
answer back. When the remote is unreachable — or that probe just failed, which
is remembered for a minute so a refresh does not wait on it again — the branch
the head was created from supplies the default, and only a branch with no
recorded origin falls back to the conventional `main`, `master`, `develop` order.
A picker whose remembered choice no longer exists falls back to that default, so
the select never renders blank.
The title is filled in on its own: the newest commit subject the branch carries
over the base, or a readable form of the branch name when it has none. It stays
editable, and typing in it stops the panel from writing over it.
**Create pull request** runs `gh pr create --base <base> --head <branch>` through
the Host. An open pull request for the same branch is shown as a link instead of
a second form, and the panel never opens one on its own.

Once a pull request is open — whether it was created here or already existed —
the card offers **Merge pull request**. It runs `gh pr merge <branch> --merge`
directly, then rereads the state so the merged summary replaces the composer.

The same read asks GitHub for the pull request's mergeability
(`gh pr view <branch> --json mergeable,mergeStateStatus`). When it answers
`CONFLICTING`, or `DIRTY` for the merge state, the branch cannot merge as it
stands: the card says which base branch it conflicts with and replaces
**Merge pull request** with **Rebase \<base\>**. Pressing it sends the prompt
`Rebase <base>` to the Session the panel belongs to, so the agent performs the
rebase and resolves the conflicts. GitHub computes mergeability asynchronously,
so an `UNKNOWN` answer keeps the merge action and the slow reread picks the
conflict up on its next pass.

When `gh pr view <branch>` reports the branch's pull request as **merged**, the
card switches to a merged summary carrying the base branch and a link to the
request, plus the two ways out of the merged branch:

| Control | Shown when | What it runs |
| --- | --- | --- |
| **Delete worktree** | the session runs in a linked worktree | `ctx.workingDirectory.set` to the main checkout, then `git worktree remove --force --force -- <checkout>`, falling back to deleting the directory and `git worktree prune` when git still refuses |
| **Switch to \<base\>** | the session runs in the main checkout, the tree is clean, and the base branch exists locally or on `origin` | `git checkout <base>` (tracking `origin/<base>` when no local branch exists) and `git pull --ff-only` |

Deleting a worktree removes its directory from disk without a confirmation step.
When the checkout still holds uncommitted changes, the merged card says so and
those changes are discarded along with the directory. The Host runs the strongest
form git offers
(`--force` twice, which also overrides a lock), and when git still declines — a
registration whose `.git` file went missing, for example — it deletes the directory
itself and prunes the registration, so no worktree directory survives the action.
The registration is data read back from `.git`, so the main checkout, one of its
ancestors, and the filesystem root are refused as deletion targets. A dirty main
checkout still hides **Switch to \<base\>**, because git would refuse that checkout.
The merged state is reread on a slow timer (45 s) while the panel is visible,
because a merge happens outside this workspace.

The composer needs the GitHub CLI on the Host. A missing `gh` is named in the
card, and an installed but signed-out CLI asks for `gh auth login`.

It carries two icon controls:

- **Stage all** — one `git add --all`, so new files and deletions are included.
- **Generate message** — asks the configured commit model to write the message
  from the staged diff (the working tree when nothing is staged), fills the
  composer, and never commits on its own.

The branch bar shows fetch, pull (`--ff-only`), and push as icons carrying their
own counts, each enabled only where it can succeed:

| Control | Enabled when | Badge |
| --- | --- | --- |
| Fetch | always | — |
| Pull | an upstream exists and the remote is ahead | `↓N` |
| Push | the branch is unpublished, gone, or ahead — never while behind | `↑N` |

A branch without an upstream is published with
`git push --set-upstream origin <branch>`; a branch whose upstream is gone is
published again. A branch that is behind keeps push disabled and prints why,
instead of letting git reject it. The push dialog names the branch and the
number of commits it will send.

Most destructive actions open a confirmation dialog that prints the exact
command they will run; the dialog closes on Escape or a click outside it.
**Merge pull request** and **Delete worktree** run immediately, since both
complete a merged branch whose work is already in its base branch.

## Safety

- **Argv only.** Commands are spawned as argument arrays through
  `ctx.subprocess`; no shell, no string interpolation. Pull requests go through
  the GitHub CLI the same way, with `GH_PROMPT_DISABLED=1` so it can never wait
  on a prompt: the panel only opens one from a clean, fully pushed branch whose
  name is not `main`, `master`, or `develop`, and the title, body, and base
  branch are validated before `gh` sees them.
- **Owner only.** The two Host routes — `POST /api/git-control` for operations
  and `GET /api/git-control/blob` for image bytes — sit behind the Connection
  fence, so only the authenticated browser session reaches them.
- **Images only on the blob route.** A preview request must name an extension
  from the image allowlist; anything else is refused with 415, and a path that
  escapes the repository with 404. A work-tree side must stay inside the
  repository root, and bytes are capped at 8 MiB (413 above that). Responses
  carry `nosniff`, a sandbox CSP, and `private` caching keyed by the content
  token in the URL.
- **Path and ref validation.** Requested paths must be repository-relative,
  must not start with `-`, and must not contain `..` segments; branch names,
  commit hashes, stash references, and reset modes are matched against fixed
  patterns before git sees them.
- **No prompts.** `GIT_TERMINAL_PROMPT=0` makes a credential prompt fail fast
  instead of hanging, `GIT_PAGER=cat` keeps output plain, and
  `GIT_OPTIONAL_LOCKS=0` avoids taking optional index locks.
- **Bounded output.** Local commands time out after 30 s, network commands after
  180 s, stdout is capped at 8 MiB, stderr at 1 MiB, and the panel truncates a
  rendered diff.
- **Bounded generation.** The prompt carries at most 24 000 characters of diff,
  the call is capped at 320 output tokens and 60 s, and the reply is reduced to
  a plain message. Message generation is the only path that leaves the machine,
  it never writes to the repository, and a profile without a usable model
  reports an error instead of guessing.

## Configuration

Message generation reads one optional plugin option, `commitModel`. When it is
absent the plugin falls back to the default agent model, so an existing profile
needs no change. Set it in the profile patch (`cordis.patch.yml`) to generate
commit messages with a different model than the agent:

```yaml
- id: git-control
  name: "@local/dsh-git-control"
  config:
    commitModel:
      provider: router
      model: qd/dfmodel
      # reasoningEffort: low   # optional; the provider default applies when omitted
```

A profile patch replaces the whole matched config, so restate every option the
entry keeps. `provider` and `model` must both be non-empty strings; a malformed
`commitModel` fails the Generate action with `git-control/bad-config` instead of
silently using another model.

## Layout

```
index.js          Host half: GitControl service, validation, and the two fetch routes
client.js         Client half: the right-Sidebar tab type, its body, and its title
cordis.patch.yml  Bundle patch inserting the `git-control` row
locale/en.json    Panel dictionary and bundle display metadata
locale/zh.json    Chinese display metadata
icon.svg          Bundle icon
```

The panel keeps its own strings in `client.js` under the `gitControl` locale
namespace and translates them through `ctx.locale`. The Host half exposes
`ctx.gitControl` for other Host plugins; no agent tool is registered yet.

The tab type registers through `ctx.inject(['sidebarRightTabs'], …)` so it
survives a load order where the right Sidebar mounts after this bundle. Its body
reads the open Session id from the slot's standard props, takes that Session's
live working directory from the `workingDirectory` projection through
`useProjection`, then falls back to the Session header `cwd` from `useSessions`
and to the matching Workspace path from `useWorkspaces`. The projection is the
only source that follows a `cd` or a created worktree, because the Session header
keeps the project the Session was opened in. A Session with none of the three
shows a hint instead of calling git.
