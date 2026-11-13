# Git Control

A sidebar panel for the DeepSeek Harness Web GUI that reads and drives one git
repository at a time: review the changes a workspace carries, stage and commit
them, manage branches and stashes, and sync with the remote.

## Where it lives

One surface: a **tab in the right Sidebar**, next to Workspace files, Terminal,
and Session Log. The tab is scoped to the open Session's working directory, so
it follows that Session into a Git worktree and shows no picker.

Open it from the right Sidebar's **Start** (guide) page: pick the
**Git control** card. The tab chip reads **Git** and the panel keeps the
Sidebar's narrow layout.

Any directory that git recognises works: the Host resolves
`git rev-parse --show-toplevel` and every later command runs at that root. The
directory is the one the Session reports, so a Session moved into a linked
worktree inspects that worktree; the Workspace path is only the fallback while
the Session reports none.

## What it does

| Panel tab | Operations |
| --- | --- |
| Changes | read status, per-file diff (staged, unstaged, or an untracked preview), stage, unstage, discard, stage everything, write the commit message, commit |
| Branches | list local and remote branches, create (optionally switching), switch, delete |
| History | newest-first log, revert a commit, reset the branch to a commit with soft / mixed / hard |
| Stash | save (optionally including untracked files), list, apply, pop, drop |

Row actions, the history actions, and the sync controls are **icon-only**: each
keeps its name in `aria-label`, repeats it in the `title` hint, and stays a full
hit target. Destructive ones are drawn in the error colour.

The commit card is shaped by the repository state:

| State | What the card does |
| --- | --- |
| Nothing staged, commits ahead | the button becomes `Push N commit(s)` — `Publish branch` when no upstream exists — so the step after a commit is one click |
| Nothing staged, remote ahead | the button becomes `Pull N commit(s)` |
| Nothing staged, nothing queued | collapses to a *Clean* chip plus one line: nothing to commit |
| Unmerged paths | marks *N conflicted*, blocks the button, asks to resolve them first |
| Changes, none staged | marks *N unstaged* / *N untracked*, keeps the composer open |
| Staged paths | button reads `Commit N file(s)` and enables once a message exists |

It carries two icon controls:

- **Stage all** — one `git add --all`, so new files and deletions are included.
- **Generate message** — asks the default agent model to write the message from
  the staged diff (the working tree when nothing is staged), fills the composer,
  and never commits on its own.

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

Every destructive action opens a confirmation dialog that prints the exact
command it will run. The dialog closes on Escape or a click outside it.

## Safety

- **Argv only.** Commands are spawned as argument arrays through
  `ctx.subprocess`; no shell, no string interpolation.
- **Owner only.** The single Host route `POST /api/git-control` sits behind the
  Connection fence, so only the authenticated browser session reaches it.
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
  it never writes to the repository, and a profile without a default model
  reports an error instead of guessing.

## Layout

```
index.js          Host half: GitControl service, validation, and the fetch route
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
working directory from `useSessions`, and falls back to the matching Workspace
path from `useWorkspaces` while the Session reports no directory. A Session with
neither shows a hint instead of calling git.
