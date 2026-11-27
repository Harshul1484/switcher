# Switcher design system

Switcher's look: warm, calm and quiet, in the spirit of Claude's own interface. A cream canvas (or warm charcoal in dark mode), ink text, one coral accent, flat surfaces with hairline borders, and almost no decoration. Everything here is implemented in [`styles.css`](styles.css); this page explains it. If the two ever disagree, `styles.css` wins and this page should be fixed.

## Principles

- **Quiet by default.** Colour carries meaning (active, usage, warnings), not decoration. Coral is the only accent.
- **Flat.** Surfaces are separated by tone and 1px hairlines, not shadows or gradients.
- **Readable first.** Text and controls meet WCAG AA contrast in both themes, even where that means deviating from the reference palette.
- **The same on every system.** Fonts are bundled and the scrollbar is styled, so Windows, macOS and Linux look identical.
- **Follow the OS theme.** Light and dark switch with the system setting; there's no in-app toggle.

## Logo

An S on a rounded coral tile. The masters are in [`docs/logo/`](docs/logo/); every icon the app ships is made from them.

| File | Use |
|---|---|
| `logo.svg` | App icon master on the macOS icon grid (an 824 tile on 1024). Source of `build/icon.icns` and `build/icon.png` |
| `logo-tile.svg` | The tile with no margin: the sidebar header (`assets/logo.svg`), the Windows `.ico`, the Linux icons and the lockups |
| `logo-tile-black.svg`, `logo-tile-white.svg` | One colour, with the S cut out: print, embossing, anywhere only one ink is available |
| `logo-mark.svg`, `logo-mark-black.svg`, `logo-mark-white.svg` | The S alone, in coral or one colour |
| `lockup-light.svg`, `lockup-dark.svg` | Tile and "Switcher" (Cormorant Garamond 500, outlined) for light and dark backgrounds |
| `png/` | PNG exports: the tile from 16 to 1024 px, the S at 512, both lockups |
| `social-preview.png` | GitHub social preview, 1280×640 |
| `glass-light.png`, `glass-dark.png` | The README header illustration. Not a logo version: don't use it as an icon |

- **Colours**: tile coral `#cc785c`, S cream `#faf9f5`. The wordmark is `--ink` on light and cream on dark.
- **Where it appears**: Windows `build/icon.ico` (taskbar, Start menu, installer, notifications), macOS `build/icon.icns` (Dock, Finder, notifications), Linux `build/icons/` (app menus) and `assets/icon.png` (window and notification icon), the tray (`assets/tray*.png`, the coral S; `trayTemplate*.png`, a black S that macOS recolours for the menu bar), and the sidebar header.
- **Lockup**: the wordmark's caps are 0.55 of the tile's height and centred on it, a quarter of a tile away.
- **Clear space**: a quarter of the tile on every side.
- **Minimum size**: the tile at 16 px, the lockup at 120 px wide.
- **Don't** recolour the tile (except the one-colour files), add shadows, outlines or effects, stretch or rotate it, put it on coral, or set the wordmark in another font.

## Colour

All colours are CSS custom properties on `:root`, redefined for dark mode under `@media (prefers-color-scheme: dark)`. Use the token, never a hex value.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--canvas` | `#faf9f5` | `#181715` | Page and sidebar background, input fill |
| `--soft` | `#f5f0e8` | `#181715` | Accounts area background |
| `--card` | `#faf9f5` | `#1f1e1b` | Account cards, menus, the settings dialog |
| `--secondary` | `#faf9f5` | `#252320` | Secondary buttons (**Use**, **Reconnect**) |
| `--pill` | `#efe9de` | `#252320` | The **Active** badge |
| `--ink` | `#141413` | `#faf9f5` | Primary text |
| `--muted` | `#6c6a64` | `#a09d96` | Secondary text, labels, percentages |
| `--hairline` | `#e6dfd8` | `#252320` | Card and sidebar borders |
| `--track` | `#e6dfd8` | `#3d3d3a` | Empty part of usage bars |
| `--field-line` | `#8e8b82` | `#6c6a64` | Input borders (3:1 against the background) |
| `--primary` | `#a9583e` | `#a9583e` | Primary button fill, checkbox |
| `--primary-press` | `#8f4a34` | `#8f4a34` | Primary button while pressed |
| `--focus` | `#cc785c` | `#cc785c` | Focus ring, filled part of usage bars, dragged scrollbar |
| `--success` | `#5db872` | `#5db872` | Dot in the **Active** badge |
| `--error` | `#c64545` | `#e57373` | Errors, usage bars at 80% and above |
| `--scroll` / `--scroll-hover` | ink at 18% / 32% | cream at 20% / 34% | Scrollbar thumb |
| `--label-coral` … `--label-stone` | coral `#cc785c`, amber `#e8a55a`, green `#5db872`, teal `#5db8a6`, stone `#8e8b82` | same | Account colour labels, shown only as 10px dots |

Two deliberate deviations from the reference palette, both for accessibility:

- **Primary button** uses `#a9583e`, not coral `#cc785c`: white text on coral is 3.3:1, below WCAG AA; on `#a9583e` it's 5:1.
- **Input borders** use `--field-line`: the hairline is only 1.2:1 against the background, too faint to see the field.

## Typography

Fonts are bundled from `@fontsource` (SIL Open Font License), so nothing loads from the network.

| Role | Font | Size / weight / line height | Notes |
|---|---|---|---|
| App title | Cormorant Garamond | 40px / 500 / 1.1 | Tracking −0.02em. The only serif in the app |
| Body | Inter | 16px / 400 / 1.55 | |
| Account name, checkbox label | Inter | 16px / 500 / 1.4 | |
| Buttons | Inter | 14px / 500 / 1 | |
| Secondary text, messages | Inter | 14px / 400 / 1.55 | `--muted` unless it's an error |
| Usage labels and reset times | Inter | 14px / 13px | |
| Plan name, badge, footer | Inter | 13px | Plan is capitalized |
| Section labels | Inter | 12px / 500, uppercase | Tracking 1.5px, `--muted` |

`--serif` and `--sans` fall back to system fonts if the bundled ones ever fail.

## Spacing and shape

- **Spacing** follows a 4px rhythm: 8, 12, 16, 24 and 32px. Cards have 14–16px padding; columns 24–32px.
- **Radius**: 8px for buttons and inputs, 12px for cards and panels, fully round (`9999px`) for badges, usage bars and the scrollbar.
- **Borders**: 1px. Shadows only appear as the input focus glow and under things that float: the card menu (`0 8px 24px` ink at 14%) and the settings dialog (`0 16px 48px` ink at 24%).

## Layout

- **Sidebar** (340px, left): title, active account and **Add Account**; **Settings** and the version and update area are pinned to the bottom.
- **Accounts** (the rest): one card per account, 12px apart.
- Each column scrolls on its own. Under 760px wide, it becomes one column.

## Components

| Component | Spec |
|---|---|
| **Primary button** | `--primary` fill, white text, 40px tall, 20px side padding. Used once per screen: **Add Account**, or **Update &lt;version&gt;** |
| **Secondary button** | `--secondary` fill, hairline border, ink text (**Use**, **Reconnect**) |
| **Link button** | No fill or border, `--muted` text (**⋯**, **Turn off**) |
| **Input** | 40px tall, `--canvas` fill, `--field-line` border; on focus a coral border plus a 3px coral glow at 15% |
| **Account card** | `--card` fill, hairline border, 12px radius: name and plan, email and organisation, then usage |
| **Usage meter** | Three columns: label with reset time, a 6px bar, "N% used". The bar is coral, `--error` at 80% or more |
| **Active badge** | `--pill` fill, round, 13px text, a 6px green dot before "Active" |
| **Most left chip** | Like the Active badge, but transparent with a 1px coral outline and a coral dot. Marks the account with the most usage left |
| **Colour dot** | 10px circle before the account name, filled with a `--label-*` token; absent when no label is set |
| **Card menu** | Opened by the **⋯** link button: `--card` fill, hairline border, 12px radius, the menu shadow. Items are 34px rows with `--pill` on hover; **Remove** is `--error` |
| **Settings dialog** | Modal, up to 860×560, 16px radius, `--card` fill, backdrop ink at 45%. Header: "Settings" (17px / 500) and a close button. Left: a 220px section list on `--soft`, 38px items, the current one on `--pill`. Right: the section title (16px / 500), then rows of label (15px; optional 13px `--muted` line under it) on the left and the control on the right, hairlines between rows. Opens from the sidebar or Ctrl/Cmd+,; Esc or a backdrop click closes it. Under 640px the section list becomes a row on top |
| **Switch** | A checkbox with `role="switch"`: 38×22 round track, `--field-line` when off, `--primary` when on, 16px white knob |
| **Icons** | 18px line icons, 1.75 stroke, `currentColor`, round caps. Only in navigation: the Settings button and the dialog's section list |
| **Quick switcher** | Frameless 560×440 window: a 48px search field, rows with dot, name, email and "Session N% · Week N%", the selected row on `--pill`, and a 12px keyboard hint footer |
| **Status line** | 14px text under the form; `--error` for errors |
| **Scrollbar** | 12px slim thumb, round, no arrows; darker on hover, coral while dragging |
| **Focus** | 2px coral outline, 2px offset, on every focusable element |

## Writing

- Short, plain and specific: say what happened and what to do next ("Login expired. Reconnect to sign in again.").
- Labels name the thing: **Current session**, **This week**, **Starting message**.
- Times are shown the way Claude shows them: "Resets in 2 hr 13 min", "Resets Saturday 9:30 AM".

## Do and don't

- **Do** use the tokens, check light and dark mode, and keep one primary button per screen.
- **Don't** add new colours, shadows, gradients or fonts, use icons outside navigation, or use coral as a background for large areas.
- **Don't** imitate Anthropic's logos or marks. Switcher is unofficial.
