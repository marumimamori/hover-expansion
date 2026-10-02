# Hover Expansion by [Maru](https://marumimamori.me/)

Reveal sidebars and select tabs by hovering, with smooth animations and drag-and-drop support.

**Current version:** `0.1.1`

---

## YouTube Video Coming Soon

## Features

- Sidebar hover:
  - Reveal the **left** or **right sidebar** at its window edge.
  - Keep it open while moving into the panel or across the left ribbon.
  - Fold it away after leaving the area.
- Drag and drop:
  - Reveal sidebars while dragging files or folders.
  - Keep the panel open while choosing a drop target.
  - Support files dragged from inside Obsidian or another application.
- Tab hover:
  - Select sidebar and page tabs without clicking.
  - Support tabs in popout windows.
  - Preserve the usual behavior of close buttons and tab dragging.
- Customizable:
  - Separate toggles for both sidebars and tab hover.
  - Animation duration, expansion and fold delays, tab delay, and edge hover area.
  - **Direct**, **Smooth**, and **Overshoot (experimental)** animation styles.
  - Reset arrows beside every setting, with the default shown on hover.
- Header controls move with the sidebar, including buttons and toolbar groups added by other plugins.
- Reduced-motion support and automatic cleanup when disabling a feature or the plugin.

## Install With BRAT

1. Install **Obsidian42 - BRAT** under **Settings → Community plugins**.
2. Open the command palette.
3. Run **BRAT: Add a beta plugin for testing**.
4. Enter `https://github.com/marumimamori/hover-expansion`.
5. Let BRAT install the plugin, then enable **Hover Expansion** under **Settings → Community plugins**.

BRAT can also keep the plugin updated. See the [BRAT documentation](https://github.com/TfTHacker/obsidian42-brat) for its installation and update options.

### Manual Installation

Download `main.js` and `manifest.json` from the [latest release](https://github.com/marumimamori/hover-expansion/releases/latest). Put both files directly inside:

```text
<Vault>/.obsidian/plugins/hover-expansion/
```

Reload Obsidian and enable **Hover Expansion** under **Settings → Community plugins**.

## Requirements

- Desktop Obsidian `1.5.0` or newer.
- A mouse or another pointer with hover support.
- BRAT for convenient installation and updates, or a manual installation.

No additional plugin or external service is required for the hover features. Mobile is not supported.

## Information

All three hover features are enabled by default. Enabled sidebars hide while unused. Hover within the configured area at a window edge to reveal that sidebar, then move into the panel to keep it open.

### Settings And Defaults

Open **Settings → Hover Expansion** to adjust the behavior.

| Setting | Default | Available values |
| --- | --- | --- |
| Expand left sidebar on hover | On | On / Off |
| Expand right sidebar on hover | On | On / Off |
| Select tabs on hover | On | On / Off |
| Tab hover delay | 0 ms | 0–500 ms |
| Sidebar expansion delay | 30 ms | 0–1,000 ms |
| Sidebar fold delay | 200 ms | 0–1,000 ms |
| Window edge hover area | 40 px | 2–300 px |
| Animation duration | 300 ms | 0–2,000 ms |
| Animation style | Smooth | Direct / Smooth / Overshoot (experimental) |

Each reset arrow restores and saves only the setting beside it. Hover over an arrow to see its default. Updating the plugin preserves saved settings.

### Sidebar Animation

**Direct** moves at constant speed. **Smooth** starts and stops gently, like a train. **Overshoot (experimental)** opens slightly past the saved width and settles; before folding, it briefly pulls outward.

The expansion and fold delays control when movement starts. Animation duration controls how long it takes. A duration of `0 ms` disables movement. Animation settings apply to both sidebars opening and closing on hover, and changes apply to the next movement.

Saved sidebar widths are preserved. Reversing a moving sidebar continues from its visible position. The right expansion icon and adjacent page-header controls share the sidebar's timing and easing, including custom buttons and toolbar groups. The system's reduced-motion preference disables movement. Manual sidebar buttons keep their native animation.

### Drag And Drop

Drag a file or folder to either window edge to reveal its sidebar. Hover over the panel, or the left ribbon, to keep it open while choosing where to drop. Leaving the area folds the panel after the usual delay. Dropping inside keeps it open until you move away.

Obsidian handles the drop as usual. Tab hover selection pauses during a drag so it does not interrupt the operation.

### Mouse Interactions And Multiple Monitors

Menus, suggestions, dialogs, and ordinary mouse-button holds pause hover actions. Moving over a tab's close button does not select it.

Increase **Sidebar expansion delay** if crossing between monitors opens a sidebar too easily. The pointer or dragged item must stay within that side's hover area for the full delay. Leaving the area or window, clicking, or ending a drag cancels pending expansion. Movement within the area does not restart the delay.

Turn off a sidebar's hover feature to restore its state from before the feature was enabled. Disabling the plugin restores both original sidebar states and removes its listeners, temporary styles, and timers.

---

## Examples

### Reveal The File Explorer

Move to the left window edge. After the default `30 ms` expansion delay, the sidebar opens over `300 ms`. Move into the file explorer to keep it open. Move back into the page, and the sidebar begins folding after `200 ms`.

### Drag A File Into A Sidebar

Start dragging a file, then hover at the relevant window edge. The sidebar opens and stays available while the dragged item is over its area. Choose the target and drop as usual.

### Select A Tab Without Clicking

Hover a page or sidebar tab, then move down into its content. The default tab delay is `0 ms`, so selection is immediate. Increase the delay to avoid switching tabs when passing across them.

## Notice

- This plugin was vibe-coded, tested continuously, and adapted to fit its intended workflow.
- Developed and tested in a Windows development vault with Obsidian `1.13.7`.
- The current behavior is covered by 51 automated checks and rendered animation checks.
- Overshoot remains experimental. Different themes and plugins can change sidebar and header layouts.
- Please report bugs with reproducible steps through [GitHub Issues](https://github.com/marumimamori/hover-expansion/issues).

## Beta Notes

Hover Expansion is still in beta. BRAT is the recommended distribution path while the plugin is tested with real vaults before a wider Obsidian Community Plugin submission.

The plugin operates locally, does not read note contents, and does not make network requests. No telemetry is included.

## License

Hover Expansion is free software licensed under **GPL-3.0-or-later**.

If you distribute a modified version, keep the license and attribution notices, provide the corresponding source code, and retain the original project attribution from `NOTICE`.

## Development

Install dependencies, run the checks, and build:

```bash
npm ci
npm test
npm run build
```

For a manual test installation, copy `manifest.json` and `main.js` into the plugin folder shown above. Reload Obsidian and enable **Hover Expansion**.

To publish an update, keep the version in `manifest.json` and `package.json` in sync, update `package-lock.json`, `versions.json`, and this README, and add release notes under `docs/releases/<version>.md`. Verify the files after building:

```bash
node scripts/verify-release.cjs <version>
```

Create and push a Git tag that exactly matches the version, without a leading `v`. The release workflow runs the checks, builds the plugin, and publishes the required files as individual release assets for BRAT. Generated output, local plugin data, dependency folders, and backups are excluded from version control.
