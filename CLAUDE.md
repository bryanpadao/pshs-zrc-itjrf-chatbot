# PSHS ZRC — IT Job Request Form Chatbot
## Claude Code Context & Build Instructions

> This file is named `CLAUDE.md` and placed in the project root.
> Claude Code reads it automatically every session.
> If context seems lost, say: "Re-read CLAUDE.md before continuing."
> Write comments so that the code can be understood.

---

## 1. Project summary

| Item | Detail |
|------|--------|
| Project name | PSHS ZRC IT Job Request Form Chatbot |
| School | Philippine Science High School — Zamboanga Regional Campus (PSHS-ZRC) |
| Purpose | Faculty and staff report IT issues via chat; bot auto-generates ITJRF tickets with multi-step approval workflow |
| Platform | Google Apps Script + Google Sheets |
| AI model | Google Gemini API — model: `gemini-2.5-flash-lite` (free tier) |
| Approach | RAG — Apps Script searches KnowledgeBase sheet before calling Gemini |
| Official form ID | PSHS-00-F-ITU-01-Ver02-Rev2-12/31/21 |
| Cost | PHP 0.00 — Gemini free tier + Google Sheets + Apps Script are all free |
| GitHub repo | `pshs-zrc-itjrf-chatbot` (private) |
| Spreadsheet ID | `1CDYLMBVKs2Ec1ufxFLi6Ed-SUU7faDWJkdrlt6TjQPE` |
| IT Staff | Philip Bryan G. Padao, Danny A. Sulit |
| Campus Director | Edman H. Gallamaso |

---

## 2. Ticket lifecycle (approval workflow)

```
[User submits ticket via chatbot]
         |
         v
  Pending Supervisor Approval
         | supervisor clicks Approve in email
         v
  Pending IT Assessment
         | IT staff submits Assess modal (service location + recommendation + assessment + target date)
         v
  Pending Director Approval
         | director clicks Approve in email
         v
  In Progress
         | IT staff submits Complete modal (action taken + task result)
         v
  Completed
```
- At any approval step, clicking **Reject** sets status to `Rejected`.
- Each approve/reject link is a one-time UUID token stored in the `Approvals` sheet.

---

## 3. Architecture

```
[Faculty / Staff browser]
        |
        | google.script.run.getUserIdentity()  ← on page load
        | google.script.run.getTicketUpdates() ← after identity resolved (email param ignored; identity derived server-side)
        | google.script.run.processChat({ message, sessionId, userIdentity })
        | google.script.run.submitFormTicket(params)  ← form-panel submissions (publication/cctv/technical)
        v
[Index.html] --> [Code.gs server functions via google.script.run]
                        |
                        |-- getUserIdentity()    reads Google account email, looks up Employees sheet
                        |-- getTicketUpdates()   returns recent status changes (email param ignored; uses Session.getActiveUser())
                        |-- getMyTickets()       returns all tickets for this user (email param ignored; uses Session.getActiveUser())
                        |-- handleChat()         RAG + Gemini, detects %%FILE_TICKET%% signal
                        |-- handleFormStep()     collects description step only (identity pre-filled)
                        |-- handleCctvLetterCheck()  CCTV letter gate
                        |-- handleConfirm()      yes/no before saving
                        |-- submitFormTicket()   form-panel path: re-verifies identity server-side, paraphrases, saves ticket
                        |-- saveTicket()         appends row (cols A–R); sends supervisor approval email
                        v
              [Google Sheet: Tickets tab]

[Supervisor / Director email client]
        | clicks Approve/Reject link → doGet(?token=X&action=approve|reject)
        | first visit → showApprovalConfirmPage() (two-step: prevents bot prefetch from silently approving)
        | approver clicks Confirm → doGet(?token=X&action=Y&confirm=1) → handleApproval()
        v
[handleApproval()] → updates ticket status → notifies IT staff by email

[IT Staff browser]
        |
        | HTTP GET  ?page=dashboard
        v
[Dashboard.html] <--> [Code.gs server functions via google.script.run]
                              |-- getTickets()            returns all ticket rows
                              |-- submitAssessment()      saves service location + recommendation + assessment; sends director email
                              |-- updateTicketStatus()    marks Completed + writes action taken + task result
                              |-- updateTicketDetails()   corrects name/position/supervisor/problem
                              |-- assignStaff()           updates Assigned Staff col
                              |-- generateFormPdf()       exports Template copy as PDF (base64)
```

---

## 4. Repository file structure

```
pshs-zrc-itjrf-chatbot/
├── CLAUDE.md                       <- this file, auto-read by Claude Code
├── appsscript/
│   ├── Code.gs                     <- backend: all server-side functions
│   ├── Index.html                  <- frontend: chat UI for faculty/staff
│   ├── Dashboard.html              <- frontend: IT staff ticket management dashboard
│   └── appsscript.json             <- Apps Script manifest
├── docs/
│   ├── ITJRF.xlsx                  <- original blank form (do not modify)
│   └── knowledge-base-sample.csv  <- starter KB entries (copy rows into the KnowledgeBase sheet)
└── README.md
```

---

## 5. Google Sheet — tabs

### Tab name: `Tickets`
One row per submitted ticket. Row 1 is the header row.

| Col | Header | Notes |
|-----|--------|-------|
| A | IT JRF # | Year-month-sequence format e.g. `2026-03-001`. Counter resets monthly. Format: yyyy-mm-NNN (3-digit zero-padded sequence). |
| B | Date | Submission date `yyyy-MM-dd` |
| C | Name | Requester full name |
| D | Position | Requester position / role |
| E | Supervisor | Immediate supervisor name (auto-filled from Departments sheet) |
| F | Problem Description | Full problem description |
| G | Recommendation Type | Set by IT staff during assessment — one of 8 specific types (excludes In-Campus/External — those go in col P) |
| H | Status | `Pending Supervisor Approval` → `Pending IT Assessment` → `Pending Director Approval` → `In Progress` → `Completed` / `Rejected` |
| I | Assigned Staff | Set via Dashboard Assess modal |
| J | Date Completed | Set automatically when marked Completed |
| K | Assessment | IT staff technical assessment |
| L | Action Taken | Steps taken to resolve |
| M | Task Result | `Successful` or `Failed` |
| N | Target Date | Target completion date set during assessment |
| O | Others Description | Free-text description when recommendation is "Others, Repair" → written to Template cell P25 |
| P | Service Location | `In-Campus Repair` or `External Service Provider Repair` — set in Assess modal → PDF row 21 checkboxes |
| Q | Raw Description | Raw unparaphrased description from chat — for reference and audit |
| R | Requester Email | Google account email of the requester — used by getTicketUpdates() and getMyTickets() |

### Tab name: `KnowledgeBase`
RAG data source. Tab name must be exactly `KnowledgeBase`. Row 1 = header.

| Column | Header | Notes |
|--------|--------|-------|
| A | Issue | Short title |
| B | Solution | Step-by-step fix |
| C | Category | Network / Hardware / Software / Account / Maintenance / External / Technical Assistance |
| D | Keywords | Comma-separated trigger words (optional) |

### Tab name: `Departments`
Maps department/office to supervisor for auto-fill during chatbot form flow.

| Column | Header | Notes |
|--------|--------|-------|
| A | Department/Office | Abbreviated code e.g. `OCD`, `CID`, `FAD`, `SSD` |
| B | Supervisor Name | e.g. `Edman H. Gallamaso` |
| C | Supervisor Email | e.g. `supervisor@zrc.pshs.edu.ph` |
| D | Full Name | e.g. `Office of the Campus Director`, `Student Services Division` |

`lookupDepartment()` matches on col A (abbreviated) **or** col D (full name) — whichever the input matches.

### Tab name: `Employees`
**REQUIRED.** Identity source for the chatbot. Looked up by Google account email (col D).

| Column | Header | Notes |
|--------|--------|-------|
| A | Name | Full name — written to the ITJRF form |
| B | Position | Full position title e.g. `Teacher III` — written to the ITJRF form |
| C | Department/Office | **Abbreviated department code** matching col A of `Departments` sheet e.g. `SSD`, `OCD`, `FAD` — **NOT a position abbreviation** |
| D | Email | Staff member's school Google account email (primary identity key) |

> **Col D email must match the Google account the staff member signs in with.** Col C must be the abbreviated department code (e.g. SSD), NOT a position abbreviation.

> ⚠️ **A common data entry mistake is putting something like `"ISA I"` (a position abbreviation) in col C instead of the department code (e.g. `"CID"`).** This will cause supervisor auto-fill to fail silently.

Identity is resolved by `getUserIdentity()` on page load — reads `Session.getActiveUser().getEmail()` and matches to col D. Name, position, department, and supervisor are all pre-filled automatically before the form is even started.

### Tab name: `Approvals`
Stores one-time approval tokens. Auto-created on first email send.

| Column | Header | Notes |
|--------|--------|-------|
| A | Token | UUID generated by `Utilities.getUuid()` |
| B | IT JRF# | Ticket this token belongs to |
| C | Type | `supervisor` or `director` |
| D | Used | Empty until clicked; then set to `approve/reject + ISO timestamp` |

### Tab name: `Template`
Official ITJRF layout. `generateFormPdf()` copies this tab, fills it, exports PDF, then deletes the copy.

**EXACT cell map — always write to the top-left cell of each merged range:**

| Merged range | Form field | Value | Notes |
|-------------|-----------|-------|-------|
| O6:Q7 | IT JRF #: | ticket.jrfNumber → **O6** | |
| E6:L6 | Name | ticket.name → **E6** | **bold** |
| E7:L7 | Position | ticket.position → **E7** | |
| E8:L8 | Immediate Supervisor | ticket.supervisor → **E8** | **bold** |
| O8:Q9 | Date: | ticket.date → **O8** | |
| E10:Q14 | Request / Problem | ticket.problem → **E10** | 5 rows, writeTextBlock |
| E15:Q19 | Assessment | ticket.assessment → **E15** | 5 rows, writeTextBlock |
| E30:Q33 | Action Taken | ticket.actionTaken → **E30** | 4 rows, writeTextBlock |
| B28:F28 | Assigned Staff | ticket.assignedStaff → **B28** | **bold** |
| H28:L28 | Target Date of Completion | ticket.targetDate → **H28** | |
| N28:Q28 | Campus Director | `Edman H. Gallamaso` → **N28** | **bold**, always auto-filled |
| P25:Q25 | Others description | ticket.othersDescription → **P25** | only when recommendation = `Others, Repair` |
| F35 | Task Successful checkbox | `✓` if Successful → **F35** | centered |
| L35 | Task Failed checkbox | `✓` if Failed → **L35** | centered |
| B39:E39 | Date Completed | ticket.dateCompleted → **B39** | auto from sheet |
| G39:K39 | Serviced by | ticket.assignedStaff → **G39** | **bold** |
| M39:Q39 | Confirmed by User | ticket.name → **M39** | **bold** |
| B41:Q41 | System footer | Static system-generated notice with digital approval statement | italic, 7pt, #888888, centered, row height 30 |

**Service location checkboxes — row 21 (from `ticket.serviceLocation`, col P):**

| Cell | Value |
|------|-------|
| F21 | In-Campus Repair |
| J21 | External Service Provider Repair |

**Recommendation type checkboxes — rows 23–24 (from `ticket.recommendation`, col G):**

| Cell | Recommendation type |
|------|---------------------|
| C23 | Hardware Repair |
| F23 | Hardware Installation |
| J23 | Network Connection |
| O23 | Preventive Maintenance |
| C24 | Software Development |
| F24 | Software Modification |
| J24 | Software Installation |
| O24 | Others, Repair |

**writeTextBlock helper** — signature: `writeTextBlock(startRow, endRow, startCol, endCol, value)` using numeric column indices (not A1 strings). Execution order is critical: (1) `breakApart()` the whole block, (2) per-row `merge()` (not `mergeAcross()`), (3) `setValue()`, (4) `setWrapStrategy(WrapStrategy.CLIP)`, (5) `setRowHeight(21)`. Pre-wraps text at 120 chars per line via `wordWrapLines()`. Footer row 41 uses `WrapStrategy.WRAP` instead of CLIP and `setRowHeight(30)`.

---

## 6. ITJRF recommendation types (exact values — do not change spelling)

Stored in col G (Recommendation Type). In-Campus Repair and External Service Provider Repair are stored separately in col P (Service Location) and are NOT in this list.

```
Hardware Repair
Hardware Installation
Network Connection
Preventive Maintenance
Software Development
Software Modification
Software Installation
Others, Repair
```

> Publication/design/pubmat requests → use `Others, Repair`.
> Recommendation and Service Location are set by IT staff on the Dashboard Assess modal, NOT asked in the chatbot.

---

## 7. Script Properties (set in Apps Script Project Settings)

| Property | Value | Purpose |
|----------|-------|---------|
| `GEMINI_API_KEY` | key from aistudio.google.com | Gemini API authentication |
| `WEBAPP_URL` | deployed `/exec` URL | Base URL for approval email links |
| `DIRECTOR_EMAIL` | director's email address | Recipient for director approval emails |
| `IT_STAFF_EMAIL` | IT staff email(s), comma-separated | Approval notifications + Dashboard authorization allow-list |
| `ALLOWED_DOMAIN` | e.g. `zrc.pshs.edu.ph` | Optional. If set, only emails from this domain can use the chatbot. |

---

## 8. Code.gs — constants and functions

### Constants
```javascript
const SPREADSHEET_ID           = '1CDYLMBVKs2Ec1ufxFLi6Ed-SUU7faDWJkdrlt6TjQPE';
const KB_SHEET_NAME            = 'KnowledgeBase';
const ITJRF_SHEET_NAME         = 'Tickets';
const APPROVALS_SHEET_NAME     = 'Approvals';
const GEMINI_MODEL             = 'gemini-2.5-flash-lite';
const GEMINI_ENDPOINT          = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`;

// Security & rate limiting
const APPROVAL_TOKEN_TTL_DAYS  = 7;     // approval email links expire after 7 days
const DASHBOARD_SESSION_TTL    = 21600; // dashboard session: 6 hours (seconds) — CacheService max is 21600
const CHAT_SESSION_TTL         = 1800;  // chat session cache: 30 minutes (seconds)
const MAX_CHAT_MESSAGES        = 30;    // max user messages per chat session
const MAX_SUBMISSIONS_PER_HOUR = 20;    // global ticket submission rate limit per hour
const MAX_MESSAGE_LENGTH       = 1000;  // max characters accepted per user message
```

### Entry points
- **`doGet(e)`** — serves `Index.html` by default (browser tab title: `PSHS-ZRC IT Unit Help Desk`); `Dashboard.html` when `?page=dashboard` (title: `PSHS-ZRC IT Unit Dashboard`); when `?token=X&action=Y` is present: if `?confirm=1` is also set, calls `handleApproval(token, action)`; otherwise calls `showApprovalConfirmPage(token, action)` — a two-step flow that prevents email scanner/prefetch bots from silently approving tickets
- **`processChat(params)`** — called from `Index.html` via `google.script.run`; accepts `{ message, sessionId, userIdentity?, quickStart? }`; validates `sessionId` against UUID v4 format (`/^[0-9a-f-]{36}$/i`) — rejects invalid IDs immediately; sanitizes input; loads/saves session via CacheService; enforces per-session message limit; pre-fills identity fields from `userIdentity` on first call if provided; if `quickStart` key is set (e.g. `'publication'`, `'cctv'`, `'technical'`), routes directly to `handleQuickStart()` skipping Gemini

### Quick-start buttons (Index.html landing)

After identity is resolved, the user sees **4** option buttons in a 2×2 grid. The input textarea is enabled immediately after identity resolves (before any button is clicked), so users can also type directly.

| Button | Key | Behavior |
|--------|-----|----------|
| 💻 IT Issue / Repair | `it_issue` | Chat flow — Gemini troubleshoots, then auto-files via `processChat()` |
| 🎨 Publication / Design | `publication` | Opens inline form panel in Index.html — submits via `submitFormTicket()` directly |
| 📷 CCTV Request | `cctv` | Opens inline form panel with Data Privacy Act warning + required letter checkbox — submits via `submitFormTicket()` |
| 🔧 Technical Assistance | `technical` | Opens inline form panel — submits via `submitFormTicket()` |

`handleQuickStart(type, session)` — now only a safety fallback. For `publication`, `cctv`, and `technical`, returns an error message (these types now use the form panel). For `it_issue` and `question`, returns a generic prompt (not called in normal operation — those types enable input directly in Index.html). Note: the `question` key is still handled in `handleQuickReply()` client-side for backward compatibility but there is no "Ask a Question" button in the UI.

**Cancel in form panel:** The "← Back to chat" link calls `hideFormPanel()` — restores the chat message area without submitting. No session state to clean up since form types never enter the session state machine.

### Chat flow (server-side session state machine)

Client sends only `sessionId` (opaque UUID). Session object lives in `CacheService` for 30 minutes.

| `session.state` | Handler | Description |
|-----------------|---------|-------------|
| _(none)_ | `handleChat()` | RAG + Gemini; detects `%%FILE_TICKET:<desc>%%` signal; auto-files immediately when identity is verified; increments `session.strikeCount` on `isGibberish()` or insufficient context (`hasEnoughContext()` = false); 3 strikes ends conversation |
| `'collecting'` | `handleFormStep()` | Collects description (only step in FORM_STEPS/QUICK_START_FORM_STEPS); increments `session.strikeCount` on `isGibberish()` — but only for non-description steps (name/position/department/supervisor); description step has no gibberish check |
| `'cctv_letter_check'` | `handleCctvLetterCheck()` | CCTV gate: confirms Director-approved letter before allowing description collection |
| `'confirm_name'` | `handleConfirmName()` | Asks user to confirm employee lookup result before auto-filling (fallback only — not triggered in normal flow since identity comes from Google account) |
| `'confirm'` | `handleConfirm()` | Waits for yes/no; on yes → `saveTicket()` + locks chat UI (fallback only — used when identity was NOT pre-filled) |

**Auto-file behavior:** When `session.identityVerified` is true (normal case — identity was resolved from Google account on page load), tickets are **filed immediately** after the description is collected — no confirmation step is shown. The `'confirm'` state is only reached as a fallback if identity is somehow not pre-filled.

### Form steps (FORM_STEPS array) — service location and rec type set by IT staff on Dashboard

`FORM_STEPS` contains only one step:

1. `description` — "Please describe the problem in detail." *(skippable — pre-filled from the Gemini chat signal when `%%FILE_TICKET%%` is detected)*

Identity fields (name/position/department/supervisor) are pre-filled from `getUserIdentity()` on page load and stored in `session.formData` before any form step runs. `QUICK_START_FORM_STEPS` is identical — one description step only.

### CCTV letter gate (`cctv_letter_check` state)

Triggered when user selects the CCTV quick-start button. Handler: `handleCctvLetterCheck()`.
- **Yes** (has Director-approved letter) → switches state to `collecting`, asks for description
- **No** → explains letter requirement, ends conversation (`submitted: true`), no ticket filed
- **Unrecognised** → re-asks once (`session.cctvFollowUpAsked = true`), then treats as No

### handleChat() behavior when %%FILE_TICKET%% is detected

When Gemini returns the `%%FILE_TICKET:<desc>%%` signal:

**If `session.identityVerified` is true (normal case):**
1. Calls `buildDescriptionFromHistory(session)` to extract a comprehensive description from the full conversation
2. Calls `hasEnoughContext(rawDesc)` — if not enough IT context, increments `session.strikeCount` and asks for clarification (max 3 strikes, then locks chat)
3. Calls `paraphraseDescription(rawDesc)` to produce a formal government-style description
4. Calls `saveTicket()` immediately — no confirmation step shown
5. Returns the visible Gemini reply + a ticket confirmation summary as separate bubbles; locks the chat on success

**If identity is NOT verified (rare fallback):**
- Sets `session.state = 'collecting'`, pre-fills description, shows intro message + next form prompt

**`recType` pre-fill:** If the description contains any of the following keywords, `recType` is pre-set to `'Others, Repair'`:
- CCTV/media: `cctv`, `footage`, `camera`
- Publication/design: `poster`, `tarpaulin`, `tarps`, `pubmat`, `design`, `layout`, `social media`, `facebook`, `post`, `certificate`, `announcement`, `publication`

**Strike counter** — Both `handleChat()` and `handleFormStep()` share a single `session.strikeCount`. Incremented by `isGibberish()` in either handler, and also by `hasEnoughContext()` returning false in `handleChat()`. Resets to 0 on any valid input. 3 strikes ends the conversation with a joke + `submitted: true`.

**Quick-start description prefix:** In quick-start flows, `session.quickStartLabel` is prepended to the raw description before paraphrasing (e.g. `"Technical Assistance: my laptop won't connect to the projector"`). This ensures the ticket clearly identifies the request type.

### Gibberish and nonsense detection — unified strike counter

A single `session.strikeCount` is shared across both `handleChat()` and `handleFormStep()`. Increments when:
- `isGibberish(message)` returns true in `handleChat()` (keyboard mashing in chat)
- `hasEnoughContext(rawDesc)` returns false in `handleChat()` (description lacks IT context)
- `isGibberish(message)` returns true in `handleFormStep()` **only on non-description steps** (name/position/department/supervisor); the description step does NOT trigger gibberish detection

Resets to 0 on any valid, non-flagged input in either handler.

`isGibberish(text)` flags text if any of these conditions hold:
- **BISAYA_WHITELIST** is checked first — if the input contains any listed word (e.g. `dili`, `wala`, `nagprint`, `walainternet`), the function short-circuits to `false` immediately
- Strings whose trimmed length (or cleaned alpha length) is **< 8 chars** are never flagged
1. The whole string (with up to 3 trailing chars) is one repeating 2–4 char n-gram (e.g. `asdasdasd`, `vcvcvcvc`)
2. Fewer than 40% unique characters for strings ≥ 8 chars (e.g. `asdasdasdvcvcv`)
3. Vowel ratio **< 7%** for strings **> 12 chars** (e.g. `qwrtpsdfghjklm`) — threshold raised from 10%/>6 to avoid false positives on short Bisaya/Filipino words
4. Consecutive consonant run of **8+** letters (e.g. `sdfjklqwmnvb`) — threshold raised from 6 to avoid false positives on Bisaya words like `nagprint`, `nagcrash`

**Strike behavior:**
- **Strike 1** — warning + re-ask / continue conversation
- **Strike 2** — stronger warning: "one more and I'll have to give up on us 😅"
- **Strike 3** — random funny joke + `{ submitted: true }` — locks chat, shows "Start a New Conversation". No ticket is filed.

### Supervisor auto-fill — `resolveAutoSupervisor(position, department, employeeName)`

Called after name confirmation (yes path) and after manual department entry. Always returns a supervisor:
1. Looks up `department` in the Departments sheet via `lookupDepartment()`
2. **Self-reference check:** if the Departments sheet lists the employee as their OWN department's supervisor (i.e. they ARE the division head), fall through to step 3. This covers Milo S. Saldon, Mary Sheryl M. Saldon-Raznee, and Keisel Van Valerie V. Gamil — their supervisor is always the Campus Director.
3. **Fallback:** returns `{ supervisorName: 'Edman H. Gallamaso', supervisorEmail: <DIRECTOR_EMAIL>, fullName: 'Campus Director' }` when no Departments entry exists or self-reference is detected.

> **Division heads rule:** Any employee whose name matches the supervisor listed in the Departments sheet for their own department is treated as a division head → supervisor = Campus Director. This is data-driven (not hardcoded names) so it works for any future chiefs as long as the Departments sheet is set up consistently.

### Security functions
- **`sanitizeInput(text)`** — trims, enforces MAX_MESSAGE_LENGTH, strips `%%SIGNAL%%` and injection delimiters
- **`sanitizeCell(value)`** — prepends a single-quote if `value` starts with `=`, `+`, `-`, or `@` to prevent formula injection in Sheets; applied to all user-supplied string columns in `saveTicket()` before `appendRow()`
- **`htmlEncode(str)`** — HTML-encodes `&`, `<`, `>`, `"`, `'` for safe interpolation into `HtmlService` output; prevents XSS when sheet values are embedded in approval email HTML
- **`checkGlobalRateLimit()`** — LockService-wrapped (`LockService.getScriptLock()`) CacheService sliding window; throws if > MAX_SUBMISSIONS_PER_HOUR in 60 min; lock prevents race condition where two simultaneous submissions both pass a single remaining slot
- **`_requireDashboardAuth()`** — internal guard; validates that `Session.getActiveUser().getEmail()` is in the `IT_STAFF_EMAIL` allow-list; throws `'Unauthorized'` if not. The `token` parameter is accepted but ignored — kept so call sites that still pass a token argument do not need updating

### Backend functions
- **`getUserIdentity()`** — reads Google account email via `Session.getActiveUser()`; looks up Employees sheet col D; returns `{ email, name, position, department, departmentFull, supervisor, supervisorEmail }` or `{ error }` object
- **`getDashboardUser()`** — returns `{ email, authorized }` for dashboard auth check; used by Dashboard on load
- **`getTicketUpdates(email)`** — returns up to 5 recent ticket status updates, excluding `Pending Supervisor Approval`; the `email` parameter is ignored — identity is derived server-side from `Session.getActiveUser().getEmail()` to prevent one user querying another user's tickets
- **`getMyTickets(email)`** — returns all tickets for the current user (col R), all statuses, sorted by IT JRF # descending; the `email` parameter is ignored — identity derived server-side (same security reason as above)
- **`hasEnoughContext(message)`** — lightweight Gemini call; returns bool — true if message has enough detail to file a ticket; false increments `session.strikeCount` (in chat flow); fails open (returns true) on API error
- **`buildDescriptionFromHistory(session)`** — Gemini call to extract a comprehensive description from the full chat history; falls back to `session.formData.description` on error
- **`paraphraseDescription(rawText)`** — Gemini call to formally paraphrase description in Philippine government document style; returns rawText unchanged on error
- **`handleCctvLetterCheck(message, session)`** — handles `cctv_letter_check` state; yes = proceed to description; no = explain requirement + end conversation. Yes/no matching uses `containsWord()` (word-boundary regex); negative phrases (e.g. "not yet", "wala pa") are checked before positive ones to prevent "ok" from matching "not ok".
- **`searchKnowledgeBase(query)`** — keyword scoring against KnowledgeBase sheet, returns top 3 or null
- **`callGemini(message, history, kbContext)`** — Gemini API call with system prompt + KB context + history
- **`submitFormTicket(params)`** — handles form-panel submissions for `publication`/`cctv`/`technical`; `params.userIdentity` is intentionally ignored — identity is re-verified server-side via `getUserIdentity()` to prevent spoofing; validates rate limits + CCTV letter flag; paraphrases description; calls `saveTicket()`; returns `{ jrfNo, rawDesc, name, departmentFull, supervisor }` on success or `{ error, message }` on failure. Does NOT call `hasEnoughContext()` — its IT-repair prompt incorrectly rejects design/CCTV/technical requests; the 8-word minimum is sufficient for forms.
- **`saveTicket(data)`** — calls `checkGlobalRateLimit()` + per-user rate limit (3/day); IT JRF # generation and `appendRow()` are wrapped in `LockService.getScriptLock()` to prevent duplicate JRF numbers under concurrent submissions; applies `sanitizeCell()` to all user-supplied columns before `appendRow()`; sends supervisor approval email
- **`appendHistory(history, userText, modelText)`** — rolling 20-message history (max 10 turns)
- **`isGibberish(text)`** — detects keyboard mashing; used by `handleChat()` and `handleFormStep()` (both increment `session.strikeCount`); `handleFormStep()` only checks on non-description steps
- **`resolveAutoSupervisor(position, department, employeeName)`** — resolves supervisor from Departments sheet; falls back to Campus Director; detects division heads via self-reference check using `normalizeNameForCompare()` on both sides of the comparison
- **`sendOverdueReminders()`** — emails IT staff about overdue `In Progress` tickets; splits `IT_STAFF_EMAIL` on commas with `.trim()` to avoid malformed addresses; returns early if the property is empty; set as daily time-driven trigger (8:00–9:00 AM)
- **`cleanupApprovalTokens()`** — deletes Approvals rows older than 30 days; set as weekly trigger (Monday 2:00–3:00 AM)
- **`archiveOldTickets()`** — moves `Completed`/`Rejected` tickets older than 90 days to Archive sheet; uses col J (Date Completed) as the reference date for `Completed` tickets so a recently-completed old ticket is not archived prematurely; falls back to col B (submission date) for `Rejected` tickets (col J is empty); set as monthly trigger (1st of month 3:00–4:00 AM)
- **`extractJson(text)`** — two-pass JSON parser helper: tries `JSON.parse` on the full trimmed text first, then falls back to slicing from the first `{` to the last `}`; returns parsed object or `null`
- **`containsWord(msg, word)`** — returns true if `word` appears as a whole word in `msg` using `\b` word-boundary regex (case-insensitive); prevents partial-word false matches
- **`normalizeNameForCompare(name)`** — strips non-alpha characters (periods, commas, `Jr.`, middle-initial dots), collapses whitespace, lowercases; used by `resolveAutoSupervisor()` for fuzzy self-reference comparison

### Approval functions
- **`sendApprovalEmail(type, jrfNo, ticket)`** — generates UUID token, stores in Approvals sheet (cols A–E, col E = Created ISO timestamp), sends HTML approval email via `GmailApp.sendEmail()` with plain-text fallback. HTML layout: dark navy header (`#1a3c6e`), alternating detail table rows, navy left-border problem block, gold left-border assessment block (director email only), styled Approve/Reject buttons. A Firefox compatibility note paragraph is included before the "Each link can only be used once" notice, advising users to copy-paste the link into Chrome if buttons don't work. Subject: `[PSHS ZRC] IT JRF #${jrfNo} — Awaiting your approval`. IT staff notification subjects: `[PSHS ZRC] IT JRF #${jrfNo} — Supervisor Approved · Please Submit Assessment` / `[PSHS ZRC] IT JRF #${jrfNo} — Director Approved · Proceed with Repair`. Overdue reminder subject: `[PSHS ZRC] Overdue Tickets — Action Required`. Full department name resolved via `lookupDepartment(ticket.department).fullName` (e.g. `"SSD"` → `"Student Services Division"`). Recipient: `ticket.supervisorEmail` (supervisor) or `DIRECTOR_EMAIL` (director). Token storage logic unchanged.
- **`handleApproval(token, action)`** — validates token; checks 7-day expiry against col E (Created); updates ticket status; notifies IT staff. Only reached after the approver explicitly clicks Confirm on the intermediate page — never called directly from the first link click. On rejection, also sends an HTML rejection notification email to col R (Requester Email) informing the requester their ticket was not approved at the supervisor or director stage.
- **`showApprovalConfirmPage(token, action)`** — intermediate confirmation page rendered on the first approval link click; shows ticket summary and Approve/Reject buttons that link to `?token=X&action=Y&confirm=1`; prevents email scanner bots from silently approving/rejecting. Includes a `#fallback-msg` div (hidden) with copy-paste Approve/Reject URLs — workaround for Firefox+Google Workspace auth middleware blocking button clicks. The div is shown only if the approver clicks a `.confirm-btn` AND no `beforeunload` event fires within 8 seconds; if `beforeunload` fires (navigation started normally), the timer is cancelled and the fallback never appears. Returns with `.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)`.
- **`approvalHtmlPage(title, message)`** — returns a styled HTML result card for approval link outcomes (approved/rejected/error). Header color is green (`#1a7a4a`) for approve, red (`#c0392b`) for reject, navy otherwise. Includes `<script>if(window!==window.top){window.top.location.href=window.location.href;}<\/script>` iframe break-out. Must return with `.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)` — without it, browsers block the response page entirely.
- **`buildRejectionEmail(jrfNo, ticket, type)`** — HTML email builder for rejection notifications sent to the requester (col R) when a ticket is rejected; reuses the navy-header template from `sendApprovalEmail()`; `type` is `'supervisor'` or `'director'` and is used in the subject/body to indicate which stage rejected the ticket
- **`getStaffEmail(name)`** — looks up email from optional `Staff` sheet by name
- **`lookupDepartment(dept)`** — looks up supervisor name + email + full office name from `Departments` sheet; matches on abbreviated code (col A) or full name (col D)
- **`lookupEmployee(name)`** — kept for backward compatibility; no longer called in main flow (identity now resolved by `getUserIdentity()`)

### Dashboard functions (all call `_requireDashboardAuth()` internally)
- **`getTickets(token)`** — returns array of ticket objects (all 18 fields A–R including `rawDescription` (col Q) and `requesterEmail` (col R)); also resolves `departmentFull` from the Employees sheet via `requesterEmail`
- **`submitAssessment(token, jrfNo, assignedStaff, recommendation, assessment, targetDate, othersDescription, serviceLocation)`** — saves cols G/H/I/K/N/O/P; looks up `department` from Employees sheet via col R (requester email) since department is not stored in Tickets sheet; passes `date` (col B, formatted `yyyy-MM-dd`) and `department` to `sendApprovalEmail('director', ...)` so the director email shows both fields correctly
- **`updateTicketStatus(token, jrfNo, actionTaken, taskResult)`** — validates; writes cols H/J/L/M; requires status = `In Progress`
- **`updateTicketDetails(token, jrfNo, name, position, supervisor, problem)`** — corrects cols C/D/E/F
- **`assignStaff(token, jrfNo, staffName)`** — writes col I only
- **`generateFormPdf(authToken, jrfNo)`** — copies Template, fills all cells, exports A4 PDF as base64, deletes temp sheet (`authToken` avoids collision with internal OAuth token variable); passes auth check when `authToken === '__internal__'` (used by `getBulkPdfData()`)
- **`getBulkPdfData(period, year, month)`** — batch PDF generation for the Reports panel; `period` is `'weekly'` (last Mon–Sun) or `'monthly'` (year + month); collects `Completed` tickets with `dateCompleted` in range (col J); returns `{ pdfs, label, count }` where each entry has `{ jrfNo, base64 }`; hard cap of 20 PDFs — returns error label if exceeded

---

## 9. Gemini system prompt (2 critical overrides + 8 general rules)

The prompt is structured with **CRITICAL OVERRIDES** first — these override everything else. This forces `gemini-2.5-flash-lite` to follow them rather than defaulting to its trained "ask for requirements" behavior.

```
CRITICAL OVERRIDES (apply before all other rules):

OVERRIDE A — Publication / design mentions INSIDE the IT Issue / Repair or Ask a Question chat:
(This override does NOT apply when using the Publication / Design form button — that goes directly to submitFormTicket().)
The IT Unit is also the designated Information Officers of PSHS-ZRC — they handle ALL
publication and design work.
Trigger words: poster, tarpaulin, tarps, pubmat, design, layout, social media, facebook,
post, certificate, announcement, publication, graphic, infographic, flyer, banner.
WHEN ANY of these words appear in the IT Issue chat — even in passing — MUST:
  1. Write EXACTLY ONE short acknowledgment sentence.
     e.g. "Got it, I'll file a request for your poster design."
  2. IMMEDIATELY end with %%FILE_TICKET:<one-sentence description>%%
NEVER ask for design details, event info, dimensions, content, deadline, or specifics.
NEVER ask for Name / Position / Department / Supervisor.
NEVER give a normal chat reply.

OVERRIDE B — User says they already sent details or already talked to IT:
Trigger phrases: "I already sent", "I sent", "already told IT", "already talked to IT",
"I emailed IT", "already gave the details", "already reported".
WHEN any of these appear — MUST:
  1. Reply with EXACTLY: "Noted — I still need to file an official IT Job Request Form
     as the record for this request."
  2. IMMEDIATELY end with %%FILE_TICKET:<one-sentence description>%%
NEVER just say "thank you" or "noted" and stop.
NEVER ask for Name / Position / Department / Supervisor.

General rules:
1. Be concise, professional, and friendly.
2. When answering technical questions, use the Knowledge Base entries provided.
3. If no KB entry is relevant, use your own knowledge to help troubleshoot.
4. For IT Issue / Repair requests:
   a. FIRST provide troubleshooting steps using Knowledge Base entries or your own knowledge.
   b. Ask the user to try the steps and confirm the result before filing a ticket.
   c. Only send %%FILE_TICKET:<one-sentence summary>%% when:
      - The user explicitly asks to file (e.g. "file a ticket", "submit", "i-submit na",
        "mag-ticket na", "i give up", "please file", "can you file")
      - The user confirms troubleshooting failed (e.g. "still not working", "hindi pa rin",
        "wala gihapon", "di pa gumana", "na-try na", "same problem", "wala gyud",
        "dili pa gumana", "di jud mo-on")
      - The problem clearly requires physical intervention (hardware broken,
        needs on-site inspection, requires parts replacement)
   d. NEVER send %%FILE_TICKET%% in the same reply as troubleshooting questions.
   e. For Technical Assistance and CCTV mentions inside the IT Issue chat: send %%FILE_TICKET%%
      immediately. Note: Publication, CCTV, and Technical Assistance each have their own
      dedicated form panel — if the user is using those buttons, this rule does not apply.
5. Do not make up ticket numbers or form details.
6. This chatbot does NOT support file uploads. If a user mentions attaching files,
   inform them and ask them to describe in text.
7. CCTV viewing requests: inform the user they need a formal letter to the Campus
   Director with exact date, time range, camera location, and reason — Director must
   approve before IT can proceed. Do NOT ask for CCTV details. End with %%FILE_TICKET%%.
8. Language: Understand and respond in Filipino, English, and Bisaya/Cebuano.
   Detect the user's language and reply in the SAME language or mix if they code-switch.
   Common Bisaya IT phrases: dili mo-on = won't turn on, dugay kaayo = very slow,
   wala signal = no connection, na-freeze/natulog = frozen, dili ma-print = can't print,
   wala gyud = still not working, na-try na nako = I already tried that, etc.
```

---

## 10. Index.html — chat UI

Messaging-app style (iMessage/WhatsApp inspired). Primary color: `#1a3c6e` (PSHS dark blue).

### Layout
- **Mobile** (`< 900px`): `position: fixed; inset: 0` — true full-screen, bypasses Apps Script iframe constraints
- **Desktop** (`≥ 900px`): centered card, `width: 560px`, `height: calc(100dvh - 48px)`, `border-radius: 14px`, `box-shadow`
- Background: PSHS campus photo (Google Drive thumbnail), visible only on desktop around the card

### Header
- Circular avatar (50px) with gold border ring + outer blue ring
- Bot name + "IT Job Request Form Chatbot" subtitle
- Avatar src: PSHS-ZRC logo from Google Drive

### Message bubbles
- **Bot** (left): white background, `border-bottom-left-radius: 4px`, wrapped in `.msg-row.bot-row` with 26px circular bot avatar beside it
- **User** (right): `#1a3c6e` background, white text, `border-bottom-right-radius: 4px`, appended directly to `.chat-messages` (no row wrapper — ensures `max-width: 84%` calculates against full chat width)
- `overflow-wrap: break-word; word-break: normal` — prevents mid-word character splits
- `gap: 10px` on `.chat-messages` — spacing between bubbles
- `<meta name="format-detection">` + CSS `color: #1a1a1a !important` on `.message.bot *` — prevents browser auto-link coloring

### Input bar
- iMessage-style: rounded textarea + circular send button
- Textarea starts **disabled** with placeholder "Choose an option above…"; `enableInput()` is called immediately after `getUserIdentity()` resolves (not after a button is clicked), so users can type as soon as identity is confirmed
- `overflow-y: hidden` by default; JS sets `overflowY: auto` only when `scrollHeight > 120px` (prevents scrollbar on short text)
- Font-size `16px` prevents iOS auto-zoom on focus

### Session / response handling
- `sessionId` string sent on every `processChat()` call via `google.script.run`
- Response `{ reply, replies, submitted }`:
  - If `replies` array has > 1 item → render each as a **separate bubble** (intro message + form question rendered as distinct bubbles)
  - If `submitted: true` → lock input, hide chat bar, show **"Start a New Conversation"** button
- **"Start a New Conversation"** calls `resetChat()` — clears DOM, resets `sessionId`, re-enables input, shows greeting. Does NOT use `location.reload()` (breaks in Apps Script iframe).

### Form panel (publication / cctv / technical)
- Shown when user clicks a form-type quick-start button; hides `.chat-messages` and `.chat-input`, shows `#form-panel`
- **Identity strip** (top): read-only compact summary — 🔒 Name · Position · departmentFull · Supervisor (font-size 12px, muted)
- **CCTV only**: amber warning card (⚠️ Data Privacy Act requirement) + required checkbox. Description textarea and submit button are disabled until checkbox is checked.
- **Description textarea**: required, minimum 8 words enforced — live word count shown below (`n words ✓` green / `n words — please add more detail (minimum 8)` red). Submit button disabled until word count ≥ 8.
- **Submit button** (`Submit Request →`): full-width, `#1a3c6e`, disabled until valid. Shows `⏳ Submitting…` while the server call is in progress.
- **On submit**: calls `submitFormTicket()` → shows success bubble in chat on success, then `lockChat()`
- **On error**: re-enables button, shows inline error inside the form panel
- **Back link** (`← Back to chat`): calls `hideFormPanel()` — restores chat view, clears the form, no submission
- **On success**: hides form panel, appends success bubble to chat, calls `lockChat()` (shows "Start a New Conversation")

### Ticket status updates on load
- After `getUserIdentity()` resolves (user found in Employees sheet), `getTicketUpdates(email)` is called
- Uses `localStorage` key `pshs_ticket_cache_[email]` to store `{ jrfNo: status }` map
- Only shows update bubbles for tickets whose status changed since last cached value; cache is updated after displaying updates
- Status lines shown per ticket:
  - `Pending IT Assessment` → "⏳ Waiting for IT staff assessment"
  - `Pending Director Approval` → "⏳ Waiting for Campus Director approval"
  - `In Progress` → "🔧 Being worked on by [assignedStaff] — target: [targetDate]"
  - `Completed` → "✅ Resolved on [dateCompleted]"
  - `Rejected` → "❌ Request was not approved"

### My Tickets overlay panel
- Accessible via the "**+ N more**" toggle at the bottom of the ticket status strip (shown only when there are more than 2 ticket updates)
- Calls `getMyTickets(email)` on click
- Renders a full-screen overlay panel listing all the user's tickets: IT JRF # | Date | Problem | Status
- Tapping a row shows full problem + status detail
- "← Back" button in the panel header closes the overlay

### Typing indicator
- Appears as a temporary bot bubble while waiting for `google.script.run` callback
- Three animated dots (CSS `@keyframes`, 0.4s offset per dot)
- Removed when the real reply is rendered

### Success reply after ticket submission
- After `saveTicket()` succeeds, the confirmation bubble shows:
  ```
  ✅ Your IT Job Request has been submitted!
  📌 Ticket #[jrfNo]
  👤 [name]
  🏢 [departmentFull]
  👨‍💼 Supervisor: [supervisor]
  📝 [rawDesc]
  Your supervisor will receive an approval email shortly...
  You can check your ticket status anytime via 📋 My Tickets.
  ```

---

## 11. Dashboard.html — IT staff management UI

Served at `?page=dashboard`. Uses `google.script.run` (no HTTP fetch).

### Layout
- Page shell: `<div class="shell">` (max-width 1280px, dark card, rounded, shadow) wraps the topbar + dash-body. Modal overlays and toast `<div>` are placed **outside** `.shell` so `position: fixed` works correctly.
- Topbar (`<header class="topbar">`): `.topbar-left` (logo-block + divider + section label) and `.topbar-right` (meta text, user pill, circular theme toggle, refresh button, sign-out button).
- Body: `<div class="dash-body">` — flex column, `padding: 24px 28px`, `gap: 20px`.

### Features
- **Login**: calls `getDashboardUser()` on load; if authorized (email in `IT_STAFF_EMAIL`) — show dashboard; if not — show access denied page. No password. Uses `Session.getActiveUser().getEmail()`. Login flicker prevented by synchronous `<head>` script that adds `is-authorized` class to `<html>` if `localStorage.getItem('dashAuthorized') === '1'`.
- **Logout button**: in topbar right side; clears `localStorage.removeItem('dashAuthorized')` and shows access denied overlay
- **Topbar user pill**: shows initials + short name derived from email (e.g. `pgpadao` → `PG`, `Philip Padao`) populated on auth success
- **Stats row**: 4-card `.stats-row` grid — Total / Active / Completed / Rejected. Each card has a `.stat-icon` wrap (colored circle) and `.stat-value` + `.stat-label`.
- **Toolbar**: always-visible row with `.search-box` (placeholder: `Search by IT JRF #, name, problem, staff…`) + `.filter-chips` div containing filter buttons as `.chip` elements. Active chip uses `.active-chip` class. Reports chip is always `.reports-chip` (navy fill).
- **Filter chips**: All / Pending Approval / Pending Assessment / Pending Director / In Progress / Completed / Rejected. `setFilter()` calls `querySelectorAll('.chip').forEach(b => b.classList.remove('active-chip'))` then adds `active-chip` to clicked chip.
- **Sortable columns**: IT JRF #, Date, Status — click header to sort ascending/descending (▲ ▼ indicator)
- **Pagination**: table shows 15 rows per page (`ROWS_PER_PAGE = 15`); Prev/Next buttons below table; `currentPage` resets to 1 on filter change, search change, and data reload; `getFilteredRows()` is the shared helper used by both `renderTable()` and `updatePaginationBar()`
- **Reports panel** (Reports chip — always navy filled):
  - Loading guard: if `allTickets` is empty when Reports is opened, shows a "please wait" message and returns early
  - Monthly Summary table (year/month dropdowns, CSV export, avg. resolution days)
  - Overdue Tickets table (open > 7 days; red highlight at 14+ days) — column header: `IT JRF #`
  - Horizontal CSS bar chart by recommendation/service type
  - **Bulk PDF Download** section: weekly (last Mon–Sun) and monthly (year + month dropdowns) batch download; calls `getBulkPdfData()` in Code.gs; 20-PDF safety cap — shows error label if exceeded
  - Report section headings use `<div class="report-section-title">` with `::after` trailing rule (not `<h2>`)
- **Table columns**: IT JRF #, Date, Name, Position, Problem, Recommendation, Assigned Staff, Status, Actions
- **Edit button** (every row, class `btn-action btn-edit`): opens Edit modal — has `.modal-ticket-summary` card at top
- **Action buttons** by status (all use `btn-action` base class):
  - `Pending Supervisor Approval` / `Pending Director Approval` → `<span class="btn-action btn-awaiting">Awaiting approval…</span>`
  - `Pending IT Assessment` → `<button class="btn-action btn-assess">`
  - `In Progress` → `<button class="btn-action btn-complete">`
  - `Completed` → `<button class="btn-action btn-pdf">` — downloads PDF with filename `IT-JRF-{jrfNo}.pdf`
- **Status badges**: rendered by `badgeHtml(status)` helper — always includes `.badge-dot` span with inline `background` color. Never build badge HTML ad-hoc.
- **Auto-refresh**: every 60 seconds (catches external email approval status changes)
- **Last updated** timestamp + logged-in email shown in topbar meta area

### Modal structure
All three modals (Edit, Assess, Complete) use: `.modal-overlay` → `.modal` → `.modal-header` + `.modal-body` + `.modal-footer`. The `.modal-header` has `.modal-title` and a `.modal-close` circle button. Each modal starts with a `.modal-ticket-summary` card inside `.modal-body` (see DESIGN.md §4-AD).

**Submit behavior**: modals stay open until the server call succeeds. On submit, the button is disabled and shows a loading label (`Sending…` / `Saving…` / `Submitting…`). On success the modal closes and the table updates in-place. On failure the modal remains open and an error message appears in `#[modal]-error` (e.g. `#assess-error`, `#complete-error`, `#edit-error`).

### Assess modal fields
- `.modal-ticket-summary` card (populated by `openAssessModal()`)
- Assigned Staff dropdown (Philip Bryan G. Padao / Danny A. Sulit)
- `.modal-field-row` (two-column): **Service Location** + **Recommendation Type** dropdowns side by side — both **required**
  - Service Location: In-Campus Repair / External Service Provider Repair — stored col P, row 21 PDF checkboxes
  - Recommendation Type: 8 specific types — stored col G, rows 23–24 PDF checkboxes
- "Specify Others" textarea — **required**, visible only when `Others, Repair` selected
- Target Date of Completion date input
- Assessment textarea — **required**
- Footer: `.btn-secondary` (Cancel) + `.btn-primary` (Send for Director Approval)

### Complete modal fields
- `.modal-ticket-summary` card (populated by `openCompleteModal()`)
- Task Result radio (Successful / Failed) — **required**
- Action Taken textarea — **required**
- Footer: `.btn-secondary` (Cancel) + `.btn-success` (Mark as Completed)

### Edit modal fields
- `.modal-ticket-summary` card (populated by `openEditModal()`)
- **Original Description** — read-only `<textarea id="edit-raw-desc">` showing col Q (raw unparaphrased description); populated from the `data-raw-desc` attribute on the `<tr>` row element, set during `renderTable()`
- Full Name — **required**
- Position / Designation
- Immediate Supervisor
- Problem Description
- Footer: `.btn-secondary` (Cancel) + `.btn-primary` (Save Changes)

---

## 12. Setup instructions

### Google Sheet tabs to create manually
1. `Tickets` — auto-created with headers on first ticket (columns A–R). If existing sheet has no col Q/R, `saveTicket()` adds them automatically.
2. `KnowledgeBase` — add issues/solutions (see `docs/knowledge-base-sample.csv`; copy rows directly into the sheet)
3. `Departments` — columns: Department/Office | Supervisor Name | Supervisor Email | Full Name
4. `Employees` — **REQUIRED** — columns: Name | Position | Department/Office | Email (col D = school Google account email)
5. `Template` — paste the official ITJRF layout (see `docs/ITJRF.xlsx`)
6. `Approvals` — auto-created on first approval email

> **Existing Tickets sheets:** If the sheet already exists without col P header, manually add `Service Location` to cell P1, `Raw Description` to Q1, `Requester Email` to R1.

### Script Properties to set
```
GEMINI_API_KEY   → from aistudio.google.com
WEBAPP_URL       → your deployed /exec URL
DIRECTOR_EMAIL   → e.g. director@zrc.pshs.edu.ph
IT_STAFF_EMAIL   → e.g. pgpadao@zrc.pshs.edu.ph,dasulit@zrc.pshs.edu.ph
ALLOWED_DOMAIN   → (optional) e.g. zrc.pshs.edu.ph — restricts chatbot to this domain
```

### Deployment
1. Apps Script → **Deploy → New deployment**
2. Type: **Web app**
   Execute as: **User accessing the web app**  ← required for Session.getActiveUser() to work
   Who has access: **Anyone with a Google account**  ← required for faculty/staff sign-in
3. Copy the Web App URL → paste into `WEBAPP_URL` Script Property

> Both Index.html (chatbot) and Dashboard.html require this setting for `Session.getActiveUser().getEmail()` to work.

> **After any code change:** Deploy → Manage deployments → pencil → New version → Deploy.

### Time-driven triggers (set up in Apps Script → Triggers)

| Function | Frequency | Time |
|----------|-----------|------|
| `sendOverdueReminders` | Day timer | 8:00–9:00 AM |
| `cleanupApprovalTokens` | Week timer (Monday) | 2:00–3:00 AM |
| `archiveOldTickets` | Month timer (1st) | 3:00–4:00 AM |

---

## 13. Known issues and decisions

| Issue | Fix / Decision |
|-------|---------------|
| Apps Script has no memory between requests | Chat session stored in CacheService (30 min TTL); client sends only `sessionId` string |
| Code edits do not go live automatically | Always create a new deployment version |
| Gemini mentions files | System prompt rule 6 blocks this |
| First form question combined with Gemini reply | `replies[]` array — UI renders each as separate bubble |
| Dashboard flickering on auto-refresh | Changed from 10s to 60s; table hides during load |
| Recommendation not in chatbot | Removed from FORM_STEPS; now set by IT staff in Assess modal |
| Service location not in chatbot | Set by IT staff in Assess modal; stored in col P |
| Supervisor email not found | Check Departments sheet col C has correct email; or add Staff sheet |
| PDF rows expanding | `writeTextBlock` uses word-wrap at 120 chars + WrapStrategy.CLIP + setRowHeight(21) |
| Others description in PDF | Saved to col O; written to Template cell P25 when recommendation = Others, Repair |
| Campus Director always same | Hard-coded as `Edman H. Gallamaso` in `generateFormPdf`, written bold to N28 |
| CCTV viewing requests | Rule 7 in system prompt: bot explains letter-to-CD requirement first, then files ticket. recType pre-set to Others, Repair via keyword detection |
| Publication/design requests not triggering ticket / asking for details | `gemini-2.5-flash-lite` ignores numbered rules for these cases. Fixed by promoting to CRITICAL OVERRIDE A at top of system prompt with explicit NEVER/ALWAYS language and trigger word list |
| Chatbot not filing ticket when user says "sent details to IT" | Same root cause. Fixed by promoting to CRITICAL OVERRIDE B with exact reply sentence required |
| "Start a New Conversation" breaks in iframe | Uses `resetChat()` JS function instead of `location.reload()` |
| Supervisor email shows undefined recommendation | Recommendation line only shown in email if `ticket.recommendation` is set |
| Dashboard login "Unrecognized email" | Email must exactly match a value in the `IT_STAFF_EMAIL` script property (comma-separated) |
| Approval token expiry | Tokens have a 7-day TTL enforced via the `Created` timestamp in Approvals col E |
| Dashboard session expiry during use | `onServerError()` detects "Session expired" and redirects to login overlay automatically |
| Dashboard logs out on page refresh | Apps Script iframe URL changes on each load — `sessionStorage` (scoped to iframe URL) is empty after refresh. Fixed: all `dashAuthorized` reads/writes use `localStorage` throughout (both the `<head>` flicker-fix script and all auth guard locations) |
| DASHBOARD_SESSION_TTL was 28800 (8 h) | CacheService max is 21600 s (6 h) — values above this throw. Fixed to 21600 |
| Index.html background image not showing | Drive file must be shared as "Anyone with the link — Viewer" for the thumbnail URL to load |
| Mobile chat UI showing as card (not full-screen) | `position: fixed; inset: 0` on `.chat-container`; `width/height` relative values don't work inside Apps Script iframe |
| User bubble text breaking mid-word | Removed row wrapper from user bubbles; `max-width: 84%` now calculates against full chat width, not shrink-to-fit row |
| Browser auto-coloring bot text blue | `<meta name="format-detection">` + `color: #1a1a1a !important` on `.message.bot *` |
| Textarea showing scrollbar on short input | `overflow-y: hidden` default; JS enables `auto` only when `scrollHeight > 120px` |
| Identity auto-filled silently from Google account | By design — `getUserIdentity()` pre-fills name/position/dept/supervisor before any form step. No user confirmation needed since identity is verified via Google Sign-In. |
| Cancel at confirmation resets to neutral instead of restarting quick-start | Fixed: `session.quickStartType` is persisted; `handleConfirm()` restarts `handleQuickStart(qsType, {})` on "no" for quick-start flows |
| Description missing quick-start context label | Fixed: `session.quickStartLabel` is prepended to description (e.g. `"Technical Assistance: ..."`) so IT staff see the request type clearly |
| Users entering gibberish or low-context messages | Both handlers share `session.strikeCount` — incremented by `isGibberish()` in either handler and by `hasEnoughContext()` returning false in `handleChat()`. 3 strikes ends conversation with joke + `submitted: true` |
| "Ask a Question" button removed from grid | Removed from the 2×2 quick-start grid. The `question` key is still handled in `handleQuickReply()` client-side JS but has no corresponding button in the UI |
| `getTicketUpdates()` shows update every session if status unchanged | `localStorage` cache `pshs_ticket_cache_[email]` stores last-seen statuses; only shows strip when status changed since last visit |
| My Tickets panel accessible only via strip toggle | No dedicated "My Tickets" button in the UI — only reachable via the "+ N more" link in the ticket status strip. Success message still references "📋 My Tickets" but that is just informational text |
| Per-user rate limit resets at midnight PHT, not 24h from first submission | TTL calculated as seconds remaining until midnight PHT (UTC+8) — intentional, matches a working day reset |
| CCTV letter checkbox can be bypassed client-side | `submitFormTicket()` also validates `cctvLetterConfirmed` server-side — belt-and-suspenders |
| `hasEnoughContext()` was rejecting valid form submissions | Removed from `submitFormTicket()` — its Gemini prompt is tuned for IT-repair chat (device/system/what happened) and incorrectly rejects publication/design/technical/CCTV requests. The 8-word minimum on the form is sufficient validation for structured submissions. |
| Email scanner bots silently approving tickets | `doGet` now uses a two-step flow: first click renders `showApprovalConfirmPage()` (confirmation page); ticket state only changes when the approver clicks Confirm, which adds `?confirm=1` and calls `handleApproval()` |
| Formula injection via user-supplied sheet values | `sanitizeCell()` prepends a single-quote to values starting with `=`, `+`, `-`, `@` before `appendRow()` in `saveTicket()` — prevents Sheets from evaluating them as formulas |
| Duplicate IT JRF numbers under concurrent submissions | `saveTicket()` wraps JRF# generation and `appendRow()` in `LockService.getScriptLock()` — only one request at a time can read the last row and write the next row |
| Race condition in global rate limit | `checkGlobalRateLimit()` wraps the read-modify-write of the timestamp array in `LockService.getScriptLock()` — two simultaneous submissions can no longer both pass a single remaining slot |
| `getMyTickets`/`getTicketUpdates` email param ignored | The `email` parameter accepted by both functions is intentionally ignored; identity is derived server-side from `Session.getActiveUser()` to prevent a user from querying another user's tickets by passing a different email |
| `handleApproval()` consumed token before ticket validation | Fixed: ticket row is now looked up and validated before the token is marked Used — a failed ticket lookup no longer permanently invalidates the approval token |
| Per-user rate limit TTL could be 0 at midnight PHT | Fixed: TTL uses `Math.max(60, ...)` — minimum 60 seconds ensures `CacheService.put()` never receives a zero or negative value |
| `handleCctvLetterCheck()` partial-word false matches on yes/no | Fixed: yes/no detection uses `containsWord()` (word-boundary regex) and checks negative phrases before positive — prevents `'ok'` from matching `'not ok'` |
| Requester not notified on rejection | Fixed: `handleApproval()` reads col R (Requester Email) and sends an HTML rejection notification email when status → `Rejected` |
| Approval result page blank after confirm click | Root cause: `approvalHtmlPage()` was missing `.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)`. Without it, Google's X-Frame-Options header blocks the response page. Fixed; page also restyled as a colored result card (green/red/navy) |
| Director approval email missing date and department | `submitAssessment()` was not passing `date` (col B) or `department` to `sendApprovalEmail()`. Department is not stored in Tickets sheet — looked up from Employees sheet via col R (requester email). Both fields now passed correctly |
| All email subject lines inconsistent | Standardized to `[PSHS ZRC] IT JRF #${jrfNo} — {action}` across all 5 send sites in Code.gs |
| Firefox approval links fail (Google Workspace auth middleware) | Known unfixable Firefox+Google Workspace incompatibility (Mozilla bug #1593321). Workarounds: (1) `.setXFrameOptionsMode(ALLOWALL)` on all HtmlService returns, (2) `#fallback-msg` div in `showApprovalConfirmPage()` shows copy-paste URLs only after a `.confirm-btn` click + 8-second delay with no navigation (`beforeunload` cancels the timer — so the fallback never appears during a normal slow page load), (3) Firefox note in approval email body advising to open in Chrome |
| PDF JRF# showing as number (e.g. `1`) instead of string (`2026-03-001`) | Sheets `getValues()` coerces zero-padded strings to numbers. Fixed: `writeCell('O6', String(ticket.jrfNumber))` |
| `writeTextBlock()` using A1-string concatenation and `mergeAcross()` causing row expansion | Rewritten: uses numeric `getRange(row, col, 1, numCols)`, `merge()` instead of `mergeAcross()`, strict order: `breakApart()` → `merge()` → `setValue()` → `setWrapStrategy(CLIP)` → `setRowHeight(21)`. Call sites updated to new signature `(startRow, endRow, startCol, endCol, value)` |

---

## 14. How to start each Claude Code session

Claude Code reads this file automatically. Just state your task. Examples:

- "The supervisor approval email is not being received — here is the log: ..."
- "Add a Rejected filter button to the Dashboard."
- "The PDF is writing to the wrong cell for Assessment."
- "Add a new department to the Departments sheet lookup."

---

*PSHS-ZRC IT Unit — ITJRF Chatbot — Google Apps Script + Gemini API (free tier)*
*IT Staff: Philip Bryan G. Padao | Danny A. Sulit | Campus Director: Edman H. Gallamaso*
