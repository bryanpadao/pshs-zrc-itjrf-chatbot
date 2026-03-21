# PSHS ZRC IT Help Desk — Design System
## DESIGN.md — permanent design language reference

> This file defines the visual design language for Index.html and Dashboard.html.
> Claude Code reads this automatically every session alongside CLAUDE.md.
> When building ANY new component, modal, state, or page — follow this file exactly.
> Never introduce new colors, fonts, or patterns not defined here.

---

## 1. Color system

All colors are defined as CSS variables in `:root`. Use only these — never hardcode hex values.

```css
:root {
  /* Backgrounds — darkest to lightest */
  --bg-base:    #0f1923;   /* page background behind the shell */
  --bg-card:    #18232f;   /* main shell / card surface */
  --bg-panel:   #1e2d3d;   /* secondary panels, sidebar items, table rows */
  --bg-input:   #243447;   /* input fields, textareas, search boxes */
  --bg-hover:   #243040;   /* hover state on interactive rows */

  /* Brand */
  --navy:       #1a3c6e;   /* primary brand color — buttons, active states */
  --navy-mid:   #1e4a8a;   /* button hover */
  --navy-light: #2a5faa;   /* borders on navy elements, send button */
  --gold:       #c9a84c;   /* accent — KB card titles, sort indicators */

  /* Semantic */
  --green:      #1D9E75;   /* success, completed, verified, online dot */
  --red:        #e24b4a;   /* error, rejected, destructive actions */
  --amber:      #d4860f;   /* warning, pending states, CCTV card */
  --purple:     #7c5cbc;   /* Pending Director status badge */

  /* Borders */
  --border:     rgba(255,255,255,0.07);   /* default border — subtle */
  --border-mid: rgba(255,255,255,0.12);  /* emphasized border — inputs, hover */

  /* Text */
  --text-pri:   #e8edf2;   /* primary — headings, names, values */
  --text-sec:   #8ba3bc;   /* secondary — descriptions, subtitles */
  --text-muted: #5a7490;   /* muted — labels, metadata, placeholders */

  /* Border radius */
  --radius-lg:  14px;   /* large cards, modals, table containers */
  --radius-md:  10px;   /* sidebar items, service cards, stat cards */
  --radius-sm:  7px;    /* inputs, badges, small buttons */
}
```

### Sidebar background
The sidebar uses `#131e2a` (slightly darker than `--bg-card`) — this is intentional
to create a visible two-tone split. Use this exact value, not a variable.

### Status badge colors (semantic — do not use for decoration)

| Status | Background | Text | Border |
|--------|-----------|------|--------|
| Pending Supervisor Approval | `rgba(212,134,15,0.15)` | `#e8a030` | `rgba(212,134,15,0.3)` |
| Pending IT Assessment | `rgba(42,95,170,0.2)` | `#7ab0f0` | `rgba(42,95,170,0.35)` |
| Pending Director Approval | `rgba(124,92,188,0.2)` | `#b08af0` | `rgba(124,92,188,0.35)` |
| In Progress | `rgba(29,158,117,0.15)` | `#4dd4a8` | `rgba(29,158,117,0.3)` |
| Completed | `rgba(29,158,117,0.1)` | `#2da87a` | `rgba(29,158,117,0.2)` |
| Rejected | `rgba(226,75,74,0.12)` | `#f07070` | `rgba(226,75,74,0.25)` |

### Status dot colors

| Status group | Color | Glow |
|-------------|-------|------|
| In Progress (active) | `#3b82f6` | `box-shadow: 0 0 6px #3b82f6` |
| Any Pending | `var(--amber)` | none |
| Completed | `var(--green)` | none |
| Rejected | `var(--red)` | none |

### Icon wrap backgrounds (service cards and stat cards)

| Type | Background | Border |
|------|-----------|--------|
| Navy / IT Issue | `rgba(26,60,110,0.5)` | `rgba(42,95,170,0.4)` |
| Teal / Publication | `rgba(20,80,60,0.5)` | `rgba(29,158,117,0.3)` |
| Amber / CCTV | `rgba(120,70,10,0.5)` | `rgba(212,134,15,0.3)` |
| Purple / Technical | `rgba(80,50,130,0.5)` | `rgba(120,80,200,0.3)` |
| Blue / Total | `rgba(26,60,110,0.5)` | `rgba(42,95,170,0.35)` |
| Amber / Active | `rgba(212,134,15,0.2)` | `rgba(212,134,15,0.3)` |
| Green / Completed | `rgba(29,158,117,0.2)` | `rgba(29,158,117,0.3)` |
| Red / Rejected | `rgba(226,75,74,0.15)` | `rgba(226,75,74,0.25)` |

---

## 2. Typography

Font: **Inter** from Google Fonts.
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```
Apply on body: `font-family: 'Inter', sans-serif`
All font-family declarations on buttons and inputs must also use `'Inter', sans-serif`.

### Type scale

| Use | Size | Weight | Color |
|-----|------|--------|-------|
| Page heading h1 | 26px | 700 | `var(--text-pri)` |
| Modal / form title | 20px | 600 | `var(--text-pri)` |
| Logo name | 14px | 700 | `var(--text-pri)` |
| Topbar section label | 13px | 600 | `var(--text-pri)` |
| Body text / bubbles | 13px | 400 | `var(--text-pri)` |
| Sidebar ticket title | 12px | 500 | `var(--text-pri)` |
| User name / stat value | 12px–26px | 600–700 | `var(--text-pri)` |
| Page heading subtitle | 13px | 400 | `var(--text-sec)` |
| Table cell text | 12px | 400 | `var(--text-sec)` |
| Descriptions / meta | 11px | 400 | `var(--text-sec)` |
| Section labels (uppercase) | 10px | 600 | `var(--text-muted)` |
| Badges / pills | 10px | 600 | (semantic, see above) |
| Fine print / timestamps | 10px | 400 | `var(--text-muted)` |
| Stat card label | 11px | 400 | `var(--text-muted)` |
| Logo subtitle | 9px | 400 | `var(--text-muted)` + `text-transform: uppercase; letter-spacing: 0.5px` |

---

## 3. Layout

### Page shell
```css
body {
  background: var(--bg-base);
  font-family: 'Inter', sans-serif;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.shell {
  display: flex;
  width: 100%;
  background: var(--bg-card);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 32px 80px rgba(0,0,0,0.55), 0 0 0 1px var(--border);
  margin: 0 auto;
}
```

Index.html shell: `max-width: 1160px; min-height: 880px`
Dashboard.html shell: `max-width: 1280px` — full column, no fixed height

### Two-column layout (Index.html)
```
Sidebar 280px fixed | Main flex: 1
```

### Single-column layout (Dashboard.html)
```
Topbar 58px fixed height
Body: flex-column, padding 24px 28px, gap 20px
```

### Sidebar
```css
.sidebar {
  width: 280px;
  flex-shrink: 0;
  background: #131e2a;      /* intentionally darker than --bg-card */
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 24px 0;
}
```

### Main content area (Index.html)
```css
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 28px 32px 24px;
  min-width: 0;
  overflow: hidden;
}
```

### Mobile breakpoint: 768px
- Hide sidebar (display: none)
- Shell becomes single column, full viewport width
- Service grid: 2 columns instead of 4
- Page heading h1: 20px
- All textareas: font-size 16px (prevents iOS auto-zoom)

---

## 4. Components

### 4-AA. Which file uses which layout

> **Index.html** — two-column shell: sidebar (280px fixed) + `.main` (flex: 1). Sidebar is always present on desktop.
> **Dashboard.html** — single-column shell: topbar (58px) + full-width body. No sidebar exists.
> Subsections marked **(Index only)** apply to Index.html only. **(Dashboard only)** applies to Dashboard.html only. All others apply to both files.

### 4-A. Topbar (Dashboard)

```css
.topbar {
  background: #131e2a;
  border-bottom: 1px solid var(--border);
  padding: 0 28px;
  height: 58px;
  display: flex;
  align-items: center;
  gap: 18px;
  flex-shrink: 0;
}
```

Contains: logo block → divider → section label → spacer → refresh info + user pill + sign out button.

Topbar divider: `width: 1px; height: 24px; background: var(--border-mid)`

### 4-B. Logo block

The PSHS ZRC logo image is used WITHOUT any border, border-radius, or background shape.
Find the existing logo src in the current file and reuse it as a raw `<img>` tag.

```html
<div class="sidebar-logo">
  <img src="[existing logo src]" alt="PSHS ZRC" class="logo-img">
  <div>
    <div class="logo-name">PSHS ZRC</div>
    <div class="logo-sub">IT Help Desk</div>
  </div>
</div>
```

```css
.logo-img {
  width: 36px;
  height: 36px;
  object-fit: contain;
  flex-shrink: 0;
  /* NO border, NO border-radius, NO background */
}
.logo-name { font-size: 14px; font-weight: 700; color: var(--text-pri); }
.logo-sub  { font-size: 9px; color: var(--text-muted); letter-spacing: 0.5px; text-transform: uppercase; margin-top: 1px; }
```

### 4-C. User card (sidebar bottom)

```html
<div class="sidebar-user">
  <div class="sidebar-user-avatar">[initials]</div>
  <div>
    <div class="sidebar-user-name">[full name]</div>
    <div class="sidebar-user-pos">[position]</div>
  </div>
  <div class="sidebar-user-verified">✓ Verified</div>
</div>
```

```css
.sidebar-user {
  margin: 0 12px 4px;
  padding: 13px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: 10px;
}
.sidebar-user-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--navy); border: 2px solid var(--navy-light);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: #fff; flex-shrink: 0;
  position: relative;
}
/* Green online dot */
.sidebar-user-avatar::after {
  content: '';
  position: absolute; bottom: 0; right: 0;
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--green);
  border: 2px solid #131e2a;
}
.sidebar-user-name { font-size: 12px; font-weight: 600; color: var(--text-pri); }
.sidebar-user-pos  { font-size: 10px; color: var(--text-muted); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
/* Plain checkmark — no pill, no background */
.sidebar-user-verified { margin-left: auto; font-size: 11px; color: var(--green); font-weight: 600; white-space: nowrap; flex-shrink: 0; }
```

Rules: initials = first[0] + last[0] of name (uppercase). NO settings icon.

### 4-D. Topbar user pill (Dashboard)

```css
.topbar-user {
  display: flex; align-items: center; gap: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 40px;
  padding: 4px 12px 4px 5px;
}
.topbar-avatar {
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--navy); border: 1px solid var(--navy-light);
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; color: #fff;
}
.topbar-name { font-size: 11px; font-weight: 500; color: var(--text-pri); }
```

### 4-E. Stat cards (Dashboard)

```css
.stats-row { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; }
.stat-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px 18px;
  display: flex; align-items: center; gap: 14px;
}
.stat-icon { width: 40px; height: 40px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
.stat-value { font-size: 26px; font-weight: 700; color: var(--text-pri); line-height: 1; }
.stat-label { font-size: 11px; color: var(--text-muted); margin-top: 3px; }
```

Icon wrap colors: see Section 1 icon wrap table.

### 4-F. Service category cards (Index)

```css
.service-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 20px; }
.service-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 18px 14px 16px;
  cursor: pointer; text-align: center;
  transition: border-color 0.15s, background 0.15s;
}
.service-card:hover          { border-color: var(--border-mid); background: var(--bg-hover); }
.service-card.active-card    { background: rgba(26,60,110,0.25); border-color: var(--navy-light); border-width: 1.5px; }
.service-icon-wrap           { width: 48px; height: 48px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; font-size: 22px; }
.service-label               { font-size: 12px; font-weight: 600; color: var(--text-pri); line-height: 1.3; }
.service-sub                 { font-size: 10px; color: var(--text-muted); margin-top: 3px; }
```

### 4-G. Sidebar ticket items

```css
.sidebar-ticket-item {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 11px 13px; margin-bottom: 8px; cursor: pointer;
  transition: border-color 0.15s;
}
.sidebar-ticket-item:hover   { border-color: var(--border-mid); }
.sidebar-ticket-id           { font-size: 10px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
.sidebar-ticket-dot          { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.sidebar-ticket-title        { font-size: 12px; font-weight: 500; color: var(--text-pri); line-height: 1.4; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sidebar-ticket-meta         { font-size: 10px; color: var(--text-muted); }
```

Dot colors: see Section 1 status dot table.

### 4-H. Status badges (Dashboard table)

```css
.badge     { display: inline-flex; align-items: center; gap: 5px;
             border-radius: 20px; padding: 3px 10px;
             font-size: 10px; font-weight: 600; white-space: nowrap; }
.badge-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
```

Color values: see Section 1 status badge table. One class per status (e.g. `.badge-supervisor`, `.badge-assessment`, `.badge-director`, `.badge-inprogress`, `.badge-completed`, `.badge-rejected`).

Badges always include a `.badge-dot` with inline `background` color matching the badge text color. Use the `badgeDotColor(status)` and `badgeHtml(status)` JS helpers to render them consistently — never build badge HTML ad-hoc in `renderTable()` or `renderOverdue()`.

### 4-I. Filter chips (Dashboard toolbar)

```css
.chip {
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 20px; padding: 5px 13px;
  font-size: 11px; font-weight: 500; color: var(--text-sec);
  cursor: pointer; white-space: nowrap; transition: all 0.15s;
}
.chip:hover          { border-color: var(--border-mid); color: var(--text-pri); }
.chip.active-chip    { background: var(--navy); border-color: var(--navy-light); color: #fff; }
.chip.reports-chip   { background: var(--navy); border-color: var(--navy-light); color: #fff; margin-left: auto; }
```

### 4-J. Table (Dashboard)

```css
.table-wrap { background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
table       { width: 100%; border-collapse: collapse; font-size: 12px; }
thead tr    { background: #131e2a; border-bottom: 1px solid var(--border-mid); }
thead th    { padding: 11px 14px; text-align: left; font-size: 10px; font-weight: 600; color: var(--text-muted); letter-spacing: 0.6px; text-transform: uppercase; white-space: nowrap; }
thead th.sortable { cursor: pointer; }
thead th.sortable:hover { color: var(--text-sec); }
.sort-ind   { margin-left: 4px; color: var(--gold); }
tbody tr    { border-bottom: 1px solid var(--border); transition: background 0.12s; }
tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: var(--bg-hover); }
tbody td    { padding: 12px 14px; color: var(--text-sec); vertical-align: middle; }
```

### 4-K. Action buttons (Dashboard table)

```css
/* Base pattern */
.btn-action { border-radius: 6px; padding: 5px 11px; font-size: 10px; font-weight: 600; font-family: 'Inter', sans-serif; cursor: pointer; white-space: nowrap; }

.btn-edit     { background: transparent; border: 1px solid var(--border-mid); color: var(--text-sec); }
.btn-edit:hover { border-color: var(--gold); color: var(--gold); }
.btn-assess   { background: rgba(42,95,170,0.2); border: 1px solid rgba(42,95,170,0.4); color: #7ab0f0; }
.btn-complete { background: rgba(29,158,117,0.15); border: 1px solid rgba(29,158,117,0.35); color: #4dd4a8; }
.btn-pdf      { background: rgba(201,168,76,0.15); border: 1px solid rgba(201,168,76,0.35); color: var(--gold); }
.btn-awaiting { background: transparent; border: 1px solid var(--border); color: var(--text-muted); cursor: default; }
```

### 4-L. Modals (Dashboard)

```css
.modal-card {
  background: var(--bg-card);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
.modal-header {
  background: #131e2a; border-bottom: 1px solid var(--border);
  padding: 16px 20px; display: flex; align-items: center; justify-content: space-between;
}
.modal-title { font-size: 14px; font-weight: 600; color: var(--text-pri); display: flex; align-items: center; gap: 8px; }
.modal-close { width: 26px; height: 26px; border-radius: 50%; background: var(--bg-panel); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 13px; color: var(--text-muted); cursor: pointer; }
.modal-body  { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.modal-footer { border-top: 1px solid var(--border); padding: 14px 20px; display: flex; gap: 10px; justify-content: flex-end; }
```

Modal field label: `font-size: 10px; font-weight: 600; color: var(--text-muted); letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 6px`

### 4-M. Inputs, selects, textareas

All use the same base pattern:
```css
.input-base {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-sm);
  padding: 9px 12px;
  font-size: 12px; color: var(--text-pri);
  font-family: 'Inter', sans-serif;
  outline: none;
  transition: border-color 0.15s;
}
.input-base:focus    { border-color: var(--navy-light); }
.input-base::placeholder { color: var(--text-muted); }
```

Textarea-specific: `resize: none; line-height: 1.6`
Select-specific: `appearance: none; cursor: pointer`

Form panel textarea height: 110px. Modal textarea height: 80px.

### 4-N. Primary buttons

```css
/* Navy filled — primary action */
.btn-primary {
  background: var(--navy); border: 1px solid var(--navy-light);
  border-radius: var(--radius-sm); padding: 8px 20px;
  font-size: 12px; font-weight: 600; color: #fff;
  font-family: 'Inter', sans-serif; cursor: pointer;
  transition: background 0.15s;
}
.btn-primary:hover { background: var(--navy-mid); }

/* Transparent — secondary/cancel */
.btn-secondary {
  background: transparent; border: 1px solid var(--border-mid);
  border-radius: var(--radius-sm); padding: 8px 18px;
  font-size: 12px; color: var(--text-sec);
  font-family: 'Inter', sans-serif; cursor: pointer;
}
.btn-secondary:hover { color: var(--text-pri); }

/* Green filled — complete/success */
.btn-success {
  background: rgba(29,158,117,0.2); border: 1px solid rgba(29,158,117,0.4);
  border-radius: var(--radius-sm); padding: 8px 20px;
  font-size: 12px; font-weight: 600; color: #4dd4a8;
  font-family: 'Inter', sans-serif; cursor: pointer;
}

/* Sign out */
.btn-signout {
  background: transparent; border: 1px solid var(--border-mid);
  border-radius: 6px; padding: 5px 12px;
  font-size: 11px; color: var(--text-muted);
  font-family: 'Inter', sans-serif; cursor: pointer;
}
.btn-signout:hover { color: var(--red); border-color: var(--red); }
```

### 4-O. Pill / ghost buttons (chat area)

```css
/* Pill outline — skip / stop troubleshooting */
.btn-pill-ghost {
  background: transparent; border: 1px solid var(--border-mid);
  border-radius: 40px; padding: 8px 18px;
  font-size: 12px; font-weight: 500; color: var(--text-sec);
  font-family: 'Inter', sans-serif; cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.btn-pill-ghost:hover { border-color: var(--red); color: #ff7a7a; }

/* Pill filled — submit ticket (chat) */
.btn-pill-navy {
  background: var(--navy); border: 1px solid var(--navy-light);
  border-radius: 40px; padding: 8px 20px;
  font-size: 12px; font-weight: 600; color: #fff;
  font-family: 'Inter', sans-serif; cursor: pointer;
  transition: background 0.15s;
}
.btn-pill-navy:hover { background: var(--navy-mid); }

/* Skip troubleshooting — uppercase pill, gold hover */
.skip-btn {
  background: transparent; border: 1px solid var(--border-mid);
  border-radius: 40px; padding: 9px 20px;
  font-size: 11px; font-weight: 600; color: var(--text-sec);
  letter-spacing: 0.4px; text-transform: uppercase;
  font-family: 'Inter', sans-serif; cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.skip-btn:hover { border-color: var(--gold); color: var(--gold); }
```

### 4-P. Chat input bar

```css
.chat-input-bar {
  display: flex; align-items: center; gap: 10px;
  background: var(--bg-input); border: 1px solid var(--border-mid);
  border-radius: 14px; padding: 10px 14px; margin-top: 4px;
}
.chat-input-bar textarea {
  flex: 1; background: transparent; border: none; outline: none;
  font-size: 13px; color: var(--text-pri);
  font-family: 'Inter', sans-serif; resize: none; line-height: 1.5;
}
.chat-send-btn {
  width: 34px; height: 34px; border-radius: 50%;
  background: var(--navy-light); border: none; color: #fff; font-size: 14px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0; transition: background 0.15s;
}
.chat-send-btn:hover { background: var(--navy-mid); }
```

### 4-Q. Chat bubbles

```css
/* Bot bubble */
.message.bot {
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 14px; border-top-left-radius: 3px;
  padding: 11px 14px; font-size: 13px; line-height: 1.6; color: var(--text-pri); max-width: 78%;
}
/* User bubble */
.message.user {
  background: var(--navy); border: 1px solid var(--navy-light);
  border-radius: 14px; border-top-right-radius: 3px;
  padding: 11px 14px; font-size: 13px; line-height: 1.6; color: #fff; max-width: 78%;
}
/* System notice (centered) */
.sys-notice { text-align: center; font-size: 11px; color: var(--text-muted); padding: 2px 0; }
```

Bot avatar: 30×30px circle, `background: var(--navy); border: 1px solid var(--navy-light)`

### 4-R. Knowledge Base card (inside bot bubble)

```css
.kb-card {
  background: rgba(255,255,255,0.04); border: 1px solid var(--border-mid);
  border-radius: 8px; padding: 10px 12px; margin-top: 9px; font-size: 12px;
}
.kb-card-title { font-size: 11px; font-weight: 600; color: var(--gold); margin-bottom: 8px; }
.kb-step       { display: flex; gap: 8px; margin-bottom: 5px; color: var(--text-sec); font-size: 12px; line-height: 1.5; }
.kb-step:last-child { margin-bottom: 0; }
.kb-num        { color: var(--gold); font-weight: 600; flex-shrink: 0; }
```

### 4-S. Form identity strip (inside form panel)

```css
.form-identity-strip {
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 10px 14px; margin-bottom: 16px;
  display: flex; align-items: center; gap: 10px;
}
.form-id-avatar {
  width: 30px; height: 30px; border-radius: 50%;
  background: var(--navy); border: 1px solid var(--navy-light);
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; color: #fff; flex-shrink: 0;
}
.form-id-name { font-size: 12px; font-weight: 500; color: var(--text-pri); }
.form-id-meta { font-size: 10px; color: var(--text-muted); margin-top: 1px; line-height: 1.4; }
/* Pill badge — checkmark + Verified, no lock emoji */
.form-id-lock {
  margin-left: auto; font-size: 10px; color: var(--green);
  background: rgba(29,158,117,0.12); border: 1px solid rgba(29,158,117,0.25);
  border-radius: 20px; padding: 3px 10px; font-weight: 600;
  white-space: nowrap; flex-shrink: 0;
}
```

Content: `✓ Verified` — NO lock emoji.

### 4-T. CCTV warning card

```css
.cctv-warning {
  background: rgba(212,134,15,0.08); border: 1px solid rgba(212,134,15,0.35);
  border-radius: var(--radius-sm); padding: 12px 14px; margin-bottom: 14px;
}
.cctv-warn-title { font-size: 12px; font-weight: 600; color: #e8a030; margin-bottom: 5px; }
.cctv-warn-text  { font-size: 11px; color: #a07030; line-height: 1.6; }
.cctv-checkbox-row { display: flex; align-items: flex-start; gap: 9px; margin-top: 10px; }
.cctv-check-label  { font-size: 11px; color: #c8912a; line-height: 1.5; cursor: pointer; }
/* Checkbox: accent-color: var(--amber) */
```

### 4-U. Form submit / back buttons

```css
.form-actions { display: flex; gap: 10px; align-items: center; margin-top: 6px; }

.form-back-btn {
  background: transparent; border: 1px solid var(--border-mid);
  border-radius: var(--radius-sm); padding: 10px 18px;
  font-size: 12px; color: var(--text-sec); font-family: 'Inter', sans-serif; cursor: pointer;
}
.form-back-btn:hover { color: var(--text-pri); }

.form-submit-btn {
  flex: 1; background: var(--navy); border: 1px solid var(--navy-light);
  border-radius: var(--radius-sm); padding: 10px 20px;
  font-size: 13px; font-weight: 600; color: #fff;
  font-family: 'Inter', sans-serif; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 7px;
  transition: background 0.15s, opacity 0.15s;
}
.form-submit-btn:hover:not(:disabled) { background: var(--navy-mid); }
.form-submit-btn:disabled { background: var(--bg-panel); border-color: var(--border); color: var(--text-muted); cursor: not-allowed; }
.form-submit-btn.loading  { opacity: 0.7; cursor: not-allowed; pointer-events: none; }
```

### 4-V. Word count indicator

```css
.word-count     { font-size: 10px; text-align: right; margin-top: 4px; }
.word-count.ok  { color: var(--green); }   /* 15+ words: "✓ [n] words" */
.word-count.low { color: var(--red); }     /* under 15: "[n] words — please add more detail" */
```

### 4-W. Loading spinner

```css
.loading-spinner {
  width: 30px; height: 30px;
  border: 3px solid var(--border-mid); border-top-color: var(--navy-light);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.loading-text { font-size: 13px; color: var(--text-muted); }
```

### 4-X. Typing indicator (chat)

```css
.typing-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--text-muted);
  animation: typingPulse 1.2s ease-in-out infinite;
}
.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes typingPulse {
  0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
  30%           { opacity: 1;   transform: scale(1); }
}
```

### 4-Y. Error state (form panel inline)

```css
.form-error {
  background: rgba(226,75,74,0.1); border: 1px solid rgba(226,75,74,0.3);
  border-radius: var(--radius-sm); padding: 10px 13px;
  font-size: 12px; color: #f07070; margin-top: 10px; line-height: 1.5;
}
```

### 4-Z. Reports components

```css
/* Section heading with trailing rule */
.report-section-title {
  font-size: 13px; font-weight: 600; color: var(--text-pri);
  margin-bottom: 14px; display: flex; align-items: center; gap: 10px;
}
.report-section-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }

/* Overdue count */
.overdue-count { font-size: 12px; font-weight: 600; color: var(--red); margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }

/* Bar chart */
.bar-row   { display: flex; align-items: center; gap: 12px; }
.bar-label { width: 220px; flex-shrink: 0; font-size: 11px; color: var(--text-sec); text-align: right; }
.bar-track { flex: 1; height: 22px; background: var(--bg-input); border-radius: 4px; overflow: hidden; }
.bar-fill  { height: 100%; border-radius: 4px; background: var(--navy-light); display: flex; align-items: center; justify-content: flex-end; padding-right: 8px; font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.7); }

/* Overdue row highlight */
.row-overdue td { background: rgba(226,75,74,0.06); }
.row-overdue:hover td { background: rgba(226,75,74,0.1) !important; }
```

### 4-AB. Dashboard body layout (Dashboard only)

```css
.dash-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px 28px;
  flex: 1;
  overflow-y: auto;
}
```

### 4-AC. Sidebar active state + section badge (Index only)

Ticket items get an `.active` class when selected. The section label can show a count badge.

```css
.sidebar-ticket-item.active {
  border-color: var(--navy-light);
  background: rgba(26,60,110,0.2);
}
/* Count badge on sidebar section label */
.sidebar-badge {
  margin-left: auto;
  background: var(--navy); border: 1px solid var(--navy-light);
  border-radius: 20px;
  padding: 1px 8px;
  font-size: 10px; font-weight: 600; color: #fff;
}
```

### 4-AD. Modal ticket summary strip (Dashboard only)

Shown at the top of Edit, Assess, and Complete modals. Populated in `openEditModal()`, `openAssessModal()`, and `openCompleteModal()` via JS immediately after the overlay opens.

```html
<div class="modal-ticket-summary">
  <div class="modal-summary-label">Ticket</div>
  <div class="modal-summary-name" id="[modal]-summary-name">—</div>
  <div class="modal-summary-desc" id="[modal]-summary-desc">—</div>
</div>
```

```css
.modal-ticket-summary { background: var(--bg-input); border: 1px solid var(--border);
                        border-radius: var(--radius-sm); padding: 12px 14px; }
.modal-summary-label  { font-size: 10px; color: var(--text-muted); text-transform: uppercase;
                        letter-spacing: 0.5px; margin-bottom: 4px; }
.modal-summary-name   { font-size: 13px; font-weight: 500; color: var(--text-pri); margin-bottom: 3px; }
.modal-summary-desc   { font-size: 11px; color: var(--text-sec); line-height: 1.5; }
```

`modal-summary-name` content: `#[jrfNo] — [name]`. `modal-summary-desc`: first 120 chars of `problem` (truncated with `…`).

### 4-AE. Two-column modal field row

Use inside `.modal-body` when two related fields should sit side by side (e.g., Assigned Staff + Target Date).

```css
.modal-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
```

### 4-AF. Reports controls (Dashboard only)

Row of dropdowns and export button above the monthly summary table.

```css
.report-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.btn-export-csv {
  background: transparent;
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-sm);
  padding: 6px 14px;
  font-size: 11px; font-weight: 600; color: var(--text-sec);
  font-family: 'Inter', sans-serif; cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.btn-export-csv:hover { border-color: var(--gold); color: var(--gold); }
```

Year and month dropdowns inside `.report-controls` use the same `.input-base` pattern (Section 4-M) with `width: auto`.

### 4-AG. Reports table style (Dashboard only)

The summary and overdue tables inside the Reports panel use `.table-wrap` (Section 4-J) plus these additions:

```css
/* Resolution average highlight */
.avg-days { font-weight: 600; color: var(--text-pri); }

/* Overdue severity text colors */
.severity-high { color: var(--red); }
.severity-med  { color: #e8a030; }
```

Overdue row highlight rules (`.row-overdue`) are already defined in Section 4-Z.

---

## 5. Verified status display — two contexts, two styles

| Context | Style | Content |
|---------|-------|---------|
| Sidebar user card | Plain green text, no background | `✓ Verified` |
| Form identity strip | Green pill (background + border) | `✓ Verified` |
| Neither context | Never use a lock emoji 🔒 | — |

---

## 6. Rules Claude Code must follow

1. **Never hardcode a hex value** — always use a CSS variable from Section 1.
2. **Never introduce a new color** not in this file without a comment explaining why.
3. **Never use a border-radius** other than `--radius-lg`, `--radius-md`, `--radius-sm`, `50%` (circles), or `40px` (pill buttons).
4. **Always use Inter** on all font-family declarations including buttons and inputs.
5. **Every new interactive element** must have a transition on hover (0.15s).
6. **Tables always use** `.table-wrap` container with `border-radius: var(--radius-lg)`.
7. **Modals always use** `#131e2a` header background (not `--bg-card` or `--bg-panel`).
8. **No lock emoji** on any verified / identity badge.
9. **No settings icon** on the sidebar user card.
10. **No white backgrounds** — the darkest any surface gets is `--bg-card`. Forms use `--bg-input` for fields.
11. **Dashboard.html has no sidebar** — do not add a sidebar to Dashboard. If a panel or filter area is needed, use inline sections or the reports-panel pattern (a full-width collapsible section below the toolbar).
12. **Light mode is CSS-variable-driven** — every color must use a CSS variable from Section 1 so that `html.light-mode` overrides in Section 7-A take effect automatically. The only exceptions are hardcoded `#131e2a` surfaces explicitly overridden in Section 7-A.

---

## 7. Light mode

Light mode is toggled via the `html.light-mode` class and persisted in `localStorage` under the key `pshs_theme`. All color changes are handled through CSS variable overrides — no component styles are duplicated.

### 7-A. CSS variable overrides

```css
html.light-mode {
  --bg-base:    #f0f4f8;
  --bg-card:    #ffffff;
  --bg-panel:   #e8edf3;
  --bg-input:   #f5f7fa;
  --bg-hover:   #e0e7ef;
  --border:     rgba(0,0,0,0.08);
  --border-mid: rgba(0,0,0,0.14);
  --text-pri:   #1a2b3c;
  --text-sec:   #3d5a73;
  --text-muted: #7a9ab0;
}

/* Surfaces hardcoded to #131e2a must be explicitly overridden */
/* Index.html — sidebar is slightly darker */
html.light-mode .sidebar { background: #dde5ef; }

/* Dashboard.html — topbar, modal header, table head use a lighter value */
html.light-mode .topbar,
html.light-mode .modal-header,
html.light-mode thead tr { background: #edf1f8; }
```

Brand, semantic, and border-radius variables (`--navy`, `--gold`, `--green`, `--red`, `--amber`, `--purple`, `--radius-*`) are **not overridden** — they read the same in both modes.

### 7-B. Toggle button HTML and CSS

Both files use `id="theme-toggle"` and `id="theme-icon"` — same JS function, different visual styles.

**Index.html** — square button in sidebar bottom area (class `.btn-theme-toggle`):
```html
<button class="btn-theme-toggle" id="theme-toggle" title="Toggle light/dark mode">
  <span id="theme-icon">☀️</span>
</button>
```
```css
.btn-theme-toggle {
  background: transparent; border: 1px solid var(--border-mid);
  border-radius: 6px; width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; cursor: pointer; transition: border-color 0.15s; flex-shrink: 0;
}
.btn-theme-toggle:hover { border-color: var(--gold); }
```

**Dashboard.html** — circular button in topbar right side (class `.theme-toggle`):
```html
<button class="theme-toggle" id="theme-toggle" title="Toggle light/dark mode">
  <span id="theme-icon">☀</span>
</button>
```
```css
.theme-toggle {
  width: 32px; height: 32px;
  background: var(--bg-panel); border: 1px solid var(--border-mid);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 15px; flex-shrink: 0;
  transition: background 0.15s, border-color 0.15s;
}
.theme-toggle:hover { background: var(--bg-hover); border-color: var(--gold); }
```

Icon: `☀️` in dark mode (click to go light), `🌙` in light mode (click to go dark). `initThemeToggle()` normalises the icon text on load.

### 7-C. Toggle JavaScript

**Inline script in `<head>`** — runs before first paint to prevent flash of wrong theme:

```html
<script>
  (function() {
    if (localStorage.getItem('pshs_theme') === 'light') {
      document.documentElement.classList.add('light-mode');
    }
  })();
</script>
```

**`initThemeToggle()` function** — call once after DOM is ready:

```js
function initThemeToggle() {
  var btn  = document.getElementById('theme-toggle');
  var icon = document.getElementById('theme-icon');
  function update() {
    var isLight = document.documentElement.classList.contains('light-mode');
    if (icon) icon.textContent = isLight ? '🌙' : '☀️';
  }
  update();
  if (btn) {
    btn.addEventListener('click', function() {
      document.documentElement.classList.toggle('light-mode');
      var isLight = document.documentElement.classList.contains('light-mode');
      localStorage.setItem('pshs_theme', isLight ? 'light' : 'dark');
      update();
    });
  }
}
```

### 7-D. Light mode rule for Claude Code

When implementing or modifying any component:
- Do not write conditional color logic in JavaScript.
- Do not duplicate CSS blocks for light vs. dark.
- Add the color to the `:root` block as a variable (Section 1), and add its light-mode override to the `html.light-mode` block (Section 7-A) if it changes between modes.
- Never apply `html.light-mode` overrides at the component level — all overrides live in the single `html.light-mode { }` block and the explicit surface list in 7-A.
