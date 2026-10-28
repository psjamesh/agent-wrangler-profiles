# Profiles for Agent Wrangler

Save named sets of tasks and switch the board between them. Profiles is a standalone community
extension for [Agent Wrangler](https://github.com/PortSwigger/agent-wrangler), requiring host API
**1.53.0 or later within 1.x**.

## Install

In **Settings → Extensions → + Add extension → Git URL**, enter
`https://github.com/psjamesh/agent-wrangler-profiles`. Review its capabilities and install.
Profiles is enabled by default. Enabling it preserves the browser's existing minimised tasks.

The extension reads task metadata, requests board rebuilds and broadcasts save results. It runs
with the host's machine access, as other Agent Wrangler extensions do. Its runtime dependency is
pinned by `package-lock.json` and installed through the host's lockfile checks.

## Use

- Click a profile pill to show its tasks. **Shift+click** adds or removes a profile from the union.
- Click **All** to restore every task, including tasks in no profile. An empty selection shows all.
- Click the settings cog directly after the last pill to open **Manage profiles**.
- Both a task's three-dots menu and its right-click menu offer **Manage profiles…**, opening the
  same dialog with that task's row highlighted. The three-dots menu keeps **Focus**, including
  for Unassigned.
- Right-click blank space in the task view for **New task** and **Manage profiles…**. The latter
  opens the same dialog without highlighting any task.

The dialog lists live tasks in board order, including Unassigned. Add empty profiles, rename or
delete profiles and tick memberships; **Save** applies the whole draft together, while **Cancel**
discards it. Concurrent saves are revision checked: if another browser changed profiles, cancel
and reopen to load its changes before editing again.

Profiles replace the core tray and its Minimise menu action while enabled. Pills wrap across rows;
there is no hidden overflow list. A new task appears in the current view without joining a profile.
Archived and deleted tasks lose their membership. A selection containing no live tasks shows all.
Core actions such as Focus or opening a task remain authoritative: a selection that no longer
matches the visible tasks is cleared. All is highlighted only when every task is visible.

## Storage and lifecycle

Named profiles are shared across browsers and stored atomically in `profiles.json` under
`AW_DATA_DIR` (default `~/.agent-wrangler`). Active selections are browser local, under the
extension's namespaced `selection` key. Core owns `aw.minimisedTaskIds`.

Disabling or uninstalling Profiles closes its dialog and returns the core tray and Minimise menus.
It keeps saved profiles and does not change the minimised set. Uninstalling retains `profiles.json`;
delete that file while the extension is disabled to remove saved profiles.

## Development

Use Node.js 20 or later:

```sh
npm ci
npm test
```

For running-board coverage, supply a clean merged core checkout with its dependencies installed:

```sh
AW_CORE_DIR=/path/to/agent-wrangler npm run test:board
```

The board test creates its own temporary data directory, chooses a free port, launches headless
Chromium, and stops its host and browsers in cleanup. Set `PLAYWRIGHT_BROWSERS_PATH` if needed;
install Chromium with `npx playwright install chromium`, or use an installed Chrome with
`PLAYWRIGHT_CHANNEL=chrome`. Optional `JOB_EVIDENCE` captures screenshots.

The host installer fixture tests the uncommitted package without publishing it:

```sh
AW_CORE_DIR=/path/to/agent-wrangler AW_DATA_DIR=/temporary/install-data node test/host-install.mjs
```

This exercises declaration, consent, lockfile installation and registration. A real remote git
install is checked after publishing. See [the design](docs/design.md) for the behaviour and core API.

Licensed under [MIT](LICENSE).
