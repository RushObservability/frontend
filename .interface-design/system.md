# Rush O11y — Design System

**Direction:** "Dark Observatory" — precision instruments for production monitoring. Cold navy foundations with warm amber-gold accent. The interface should feel like mission control: dense, focused, serious — but with enough warmth to avoid sterility.

**Who:** SREs and developers investigating production incidents. They're under pressure, often at odd hours. The interface needs to be scannable, fast, and unambiguous.

**Feel:** Cold precision with warm signal. Like a well-lit control room — dark surfaces keep focus on the data, amber draws the eye to what matters.

## Depth Strategy

**Borders-only.** No shadows. Separation via subtle border colors at three intensity levels. This matches the dense, technical feel — shadows would soften the precision.

## Backgrounds (elevation scale)

```
--bg-void:    deepest (app chrome, behind everything)
--bg-root:    app canvas
--bg-surface: cards, panels (primary content surface)
--bg-raised:  headers, toolbars (slightly above surface)
--bg-overlay: dropdowns, code blocks, inset areas
--bg-hover:   interactive hover state
--bg-active:  interactive active/pressed state
```

Dark mode: navy progression from #060710 to #282e40
Light mode: cool gray progression from #e8eaef to #dfe2e9

## Borders

```
--border-subtle:  soft separation (within cards, between related items)
--border-default: standard borders (card edges, input borders)
--border-strong:  emphasis (hover states, focus rings, active sections)
```

## Text

Four-level hierarchy, WCAG AA compliant:
```
--text-primary:   high contrast, body text and headings
--text-secondary: supporting text, labels
--text-muted:     metadata, timestamps, tertiary info
--text-inverse:   text on colored backgrounds (amber buttons, status badges)
```

## Accent

Warm amber-gold — the single accent color. Used for:
- Primary actions (buttons, links)
- Active navigation states
- Focus indicators
- Data emphasis (chart highlights, selected items)

```
--amber:       primary accent
--amber-dim:   subtle backgrounds (badge bg, tool badge bg)
--amber-glow:  hover backgrounds, border tints
--amber-hover: button hover state
--amber-muted: disabled/reduced accent
```

## Status Colors

Semantic only — never decorative:
```
--ok / --ok-dim:           healthy, resolved, success
--error / --error-dim:     anomalous, failed, critical
--warning / --warning-dim: degraded, caution
```

## Method Colors

HTTP method badges use distinct, muted colors:
```
--method-get:    green (same as --ok)
--method-post:   blue (#5b8dd9 dark / #4070c4 light)
--method-put:    amber (same as --amber)
--method-delete: red (same as --error)
--method-patch:  purple (#9b7dd4 dark / #7c5fbf light)
```

## Typography

```
--font-ui:   'Figtree', system-ui, -apple-system, sans-serif
--font-mono: 'JetBrains Mono', 'SF Mono', 'Cascadia Code', monospace
```

- Figtree: geometric sans-serif, clean but warmer than Inter/Geist. Tight tracking on headings.
- JetBrains Mono: all data, IDs, timestamps, code, metric values. Use `tabular-nums` for columnar alignment.

## Spacing

4px base unit:
```
--sp-1: 4px    micro (icon gaps, tight pairs)
--sp-2: 8px    component internal (button padding, input padding)
--sp-3: 12px   card padding, section gaps
--sp-4: 16px   standard section padding
--sp-5: 20px   larger gaps
--sp-6: 24px   major section separation
--sp-8: 32px   page-level separation
```

## Border Radius

```
--r-sm:   3px   inputs, buttons, small elements
--r-md:   5px   cards, panels, dropdowns
--r-lg:   8px   modals, large containers
--r-pill: 10px  status badges, pills, tags
```

## Component Patterns

### Buttons
- Primary: `background: var(--amber)`, `color: var(--text-inverse)`, `border-radius: var(--r-md)`
- Ghost: `background: none`, `color: var(--text-secondary)`, hover → `var(--text-primary)`
- Danger: `background: var(--error-dim)`, `color: var(--error)`

### Status Badges
- Pill shape: `border-radius: var(--r-pill)`
- Background: `var(--{status}-dim)`, color: `var(--{status})`
- Font-size: 11px, font-weight: 600

### Cards
- `background: var(--bg-surface)`, `border: 1px solid var(--border-default)`, `border-radius: var(--r-lg)`
- No shadows. Border-only depth.

### Data Tables
- Header: `var(--bg-raised)`, `border-bottom: var(--border-default)`
- Rows: `var(--bg-surface)`, hover → `var(--bg-hover)`
- Monospace for all data cells

### Investigate Button (contextual AI action)
- `background: var(--amber-dim)`, `color: var(--amber)`, `border: 1px solid var(--amber-glow)`
- Hover: `background: var(--amber-glow)`, `color: var(--amber-hover)`
- Small: 11px, font-weight 600

## Theme Support

Both dark and light themes. All colors defined as CSS variables on `:root` (dark default) and `[data-theme="light"]`. Components must never use hardcoded hex values — always reference variables so both themes work.

## Colors to Avoid

Never use raw hex values for status/accent colors. Always use the variable. Hardcoded hex breaks light mode.

Exception: chart/visualization colors that need distinct series colors beyond the status palette. These should still be documented if added.

## Settings & Admin Panels

Layout and component patterns for settings/admin pages (multi-section config). Reference: `web-ui/src/views/SettingsView.vue` + `styles/views/SettingsView.css`.

### Page shell — grouped left rail (not top tabs)
For 5+ sections, use a left section rail, never a horizontal tab bar (cramps past ~6 items).
- Shell: CSS grid `216px minmax(0,1fr)`, `gap: var(--sp-8)`, `align-items: start`.
- Rail (`.settings-rail`): `position: sticky; top: var(--sp-5)`, `border-right: 1px solid var(--border-subtle)`. Contains a `.rail-brand` (11px uppercase muted), then `.rail-group`s.
- Group label (`.rail-group-label`): 10px, 600, uppercase, `letter-spacing: .07em`, `--text-muted`. Group sections by purpose (e.g. Workspace / Access & Identity / Data & Routing).
- Rail item (`.rail-item`): 30px tall, 13px, `--text-secondary`; hover → `--bg-hover` + `--text-primary`; **active → `background: var(--amber-dim)`, `color: var(--amber)`, weight 500** (filled pill, no left bar). Focus-visible: `box-shadow: 0 0 0 1px var(--amber)`.
- Content column (`.settings-content`): `min-width:0`, flex column, `gap: var(--sp-5)`. Starts with a `.content-head` = section title (18px/600) + hint (13px secondary). The rail is the nav; the content header names the current section.
- Deep-link each section via `#<id>` hash; vertical ↑/↓/Home/End keyboard nav over the flattened ordered list.

### Setting row — simple preferences (label+description / control)
The Stripe/Linear standard for non-list settings. Use inside a `.set-card`:
- `.set-card` = `--bg-surface` + 1px `--border-subtle` + `--r-md`, `overflow:hidden`.
- `.set-card-head` (padding `--sp-4`, `border-bottom: --border-subtle`): `.card-title` 14/600 + `.card-desc` 12 secondary. Use a meaningful subsection title, not a repeat of the page header.
- `.set-row` (flex, space-between, `gap: --sp-6`, padding `--sp-4`; `border-top: --border-subtle` between rows): `.set-row-text` (label 13/500 primary + desc 12 secondary, `max-width: 60ch`) on the left, `.set-row-control` (right-aligned, shrink-0) holds the input/toggle/select/button.
- `.set-save-bar` (flex justify-end, `border-top`, `background: --bg-root`): right-aligned Save button; `.save-confirmation` ("Saved", green) and `.save-error` (`margin-right:auto`, red) as siblings.

### CRUD sections (lists of users/channels/keys/etc.)
Keep one card with `.card-header` (title + description + amber `.btn-create` right), a data table (header `--bg-raised`, 10px uppercase muted, `border-bottom`; rows min-40px, hover `--bg-hover`, subtle row borders; mono data cells), and a centered muted empty state.

### Rules
- No inline `style=` — everything maps to a class/token.
- One button system: `.btn`+`.btn-primary`(amber)/`.btn-secondary`(raised+border); small row actions `.action-btn`. Toggles use the canonical `.toggle` (amber when checked).
- Settings cards use `--r-md` (not `--r-lg`); keep borders-only depth.
