# Profiles extension design

## Intent

A busy board has many tasks, and the set a person wants in view changes with what they are working
on. Today that means minimising and restoring tiles by hand each time, even though the same sets
recur. Profiles let a person save a named set of tasks and switch to it in one step. Everything
outside the set is out of the way until wanted.

## Goals

- A **profile** is a named set of tasks. A task can be in any number of profiles.
- Selecting profiles shows the union of their tasks and minimises the rest. Selecting several is
  allowed; selecting none shows every task.
- Switching is one action and one re-render, not a flicker through many minimise/restore calls.
- The extension takes over the tray strip: it shows profile pills instead of minimised-task pills.
- One **Manage profiles** dialog is the way to create, rename, delete and edit profiles.
- With the extension off, the board, tray and Minimise button behave exactly as they do today.

## Non-goals

- Automatic membership rules (by repo, label, state).
- Sharing profiles between people, or syncing the active selection between browsers.
- A quick one-off hide of a single task. With the extension on, hiding is done through profiles.

## Anti-goals

- Turning the extension on must not change the board until the person acts.
- A task must never become unreachable because it is in no profile.

## Behaviour

### The tray strip

With Profiles enabled, the extension draws the tray strip. It contains, left to right:

- an **All** pill, always first and always present. It is shown as selected when no profile is
  selected, and clicking it clears the selection and shows every task;
- one pill per profile. A plain click selects only that profile; **Shift+click** adds it to the
  selection, or removes it if it is already selected, so several can be combined;
- a **settings cog** (Lucide `settings`), which opens the Manage profiles dialog. It sits directly
  after the last profile pill and moves with it as profiles are added; it is not pinned to the
  strip's far edge.

The pills are drawn the way core draws minimised-task pills today: a row that wraps onto further
lines when there are many. There is no "More" list; every profile is always visible as a pill.

No profile selected means every task is shown, which is what **All** represents; selecting a
profile deselects **All**, and clearing the last profile reselects it. Core's own tray, including
its **Restore all** button, is not drawn while the extension is active.

### Switching

Clicking a pill, Shift+clicking one, or clicking **All** recomputes the view: the union of the
selected profiles' tasks is visible, every other task is minimised. The result is applied in a
single call. Removing the last profile with Shift+click returns to **All**. A plain click on the
only selected profile leaves it selected (**All** is how to clear the selection).

**All** is needed because profiles only add tasks to the view: a task in no profile can be reached
only through **All** (or by adding it to a profile in the dialog).

### Manage profiles dialog

One dialog is the only place profiles are created or changed. It shows every task against every
profile as a grid of checkboxes (task rows, profile columns). From it the person can:

- tick or untick a task in a profile;
- **create** a profile (it gets a name and starts empty or with whatever is ticked);
- **rename** and **delete** a profile.

Changes apply when the dialog is saved. If a selected profile's membership changed, the view
recomputes then. Opened from a task's **Manage profiles…** menu entry, the dialog is the same but scrolls
to and highlights that task's row.

### The task tile

The tile header gains no new button or icon. While the extension is active, the **Minimise** entry
in the task's three-dots menu is replaced by **Manage profiles…**, which opens the dialog on that
task. The same replacement applies to the tile's right-click menu, which carries core's Minimise
too.

### First use

Enabling the extension changes nothing. There are no profiles until the person creates one in the
dialog. Tasks minimised before enabling stay minimised until a profile selection is changed.

### New tasks

A task created after a selection was applied is not in the minimised set, so it appears in the
current view. It joins no profile until the person adds it.

### Housekeeping

A profile's archived or deleted tasks drop out of it quietly. If a profile selection leaves no live
tasks, every task is shown (core already refuses to minimise the last visible tile).

## Constraints and what exists today

- The minimised set is browser view state in `public/app.js` (`localStorage` key
  `aw.minimisedTaskIds`), not server state. The tray is drawn by core in `public/app.js`
  (the `tray-pills` strip with **Restore all**).
- Extensions today can minimise one task (`api.minimiseTask`, 1.11.0) and restore one
  (`api.openTask`, 1.24.0). They cannot set the whole minimised set at once, hide tasks from the
  tray, replace the tray, or remove core's Minimise. See `docs/extensions.md`.
- Core's Minimise is in both the task header menu and the tile's right-click menu. An existing
  mechanism drops the legacy `minimise-task` extension's item to avoid a duplicate; it does not
  let an extension remove core's own.

## Where it lives

This is a new **community extension**, installable from its own public repository in the
`psjamesh` GitHub namespace (working name `psjamesh/agent-wrangler-profiles`, following the
existing `agent-wrangler-<name>` repositories). It is not a built-in extension. Its manifest
declares `engines.wranglerApi` at the host API version that ships the core changes below.

Delivery is two pieces, in order:

1. A pull request to `agent-wrangler` (public, Apache-2.0) with the core changes below, bumping the
   host API minor version and documenting the additions in `docs/extensions.md`.
2. The extension repository, built against that version.

## Core changes required

Additions to the client extension API, as a minor host API bump:

1. A **tray slot**: an extension may draw the tray strip. When an enabled extension contributes
   it, core's strip is not drawn; when none does, today's tray is unchanged.
2. **`api.setMinimisedTasks(ids)`**: replaces the minimised set in one render, keeping core's
   guard that the board never empties and its pruning of ids that name no live tile.
3. A way for the extension that owns the tray to **replace core's Minimise menu entry** with its own
   (**Manage profiles…**) in both the three-dots menu and the right-click menu.

## Designer's calls (not discussed with the person; change freely)

- **Read model.** The tray slot is handed the ordered live task list (including the Unassigned tile)
  and the current minimised set, and is re-rendered whenever the minimised set changes. The slot is
  a mount-style contribution, not a value list.
- **The minimised set is authoritative.** Core can still change it without the extension (Focus,
  focus-mode arrow keys, `openSession`/`openTask`). A profile pill shows as selected only while the
  visible tasks equal the union of the selected profiles; after any other change the pills show as
  unselected, never stale. **All** is selected only when no task is minimised and no profile is
  selected.
- **Focus stays.** Only Minimise is replaced; the Focus action is untouched.
- **The strip is always drawn** while the extension is active, including when nothing is minimised,
  since it carries the pills and the cog.
- **Unassigned tile.** It is a task like any other here (reserved id), appears as a row in the
  dialog and can be hidden by a switch. Its menu gets the same Manage profiles… entry.
- **No single-task restore.** With no More list, a hidden task comes back by selecting a profile
  that contains it, by **All**, or by adding it to a selected profile in the dialog.
- **Dialog details.** A new profile starts empty and is not selected. Saving applies all changes at
  once; cancelling discards them. The dialog is drawn by the extension.
- **`setMinimisedTasks(ids)`** returns whether it applied, like `minimiseTask`. The extension never
  asks to minimise everything: a selection with no live tasks is turned into "show all" by the
  extension before the call.
- **Server half.** A server-side store and control messages for create, rename, delete and
  membership. Client-only `localStorage` is rejected, since the profiles are meant to be shared
  across browsers.

## Decisions made by the person

- Extension takes over the tray rather than filtering it.
- Click selects one profile, Shift+click adds to the selection (union); none selected shows
  everything, with an always-present **All** pill as the visible way back to that state and the
  only way to reach tasks that are in no profile.
- One Manage profiles dialog for everything, opened from the cog in the strip and from
  Manage profiles… in each task's menu.
- Manage profiles… replaces the Minimise entry in the task menus while the extension is on. The
  tile header gets no new button or icon.
- The strip shows every profile as a pill, like today's minimised-task pills, with no More list.
  The icon is a settings cog that floats beside the last pill.
- A task may be in several profiles.
- A new task joins the current view.

## Left to the builder (marked as the designer's guesses)

- Profiles are stored server-side in the extension's own store, shared across browsers; the active
  selection is per browser, like the minimised set.
- Pill styling, ordering of profiles, dialog layout and the exact wording of labels.
- Persistence details for the per-browser active selection.
