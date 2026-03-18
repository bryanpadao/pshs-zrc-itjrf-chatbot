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
| School | Philippine Science High School — Zamboanga Regional Campus (PSHS ZRC) |
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
        | google.script.run.processChat({ message, session })
        v
[Index.html] --> [processChat() / doPost(e) in Code.gs]
                        |
                        |-- handleChat()         RAG + Gemini, detects %%FILE_TICKET%% signal
                        |-- handleFormStep()     collects fields step-by-step
                        |-- handleConfirm()      yes/no before saving
                        |-- saveTicket()         appends row; sends supervisor approval email
                        v
              [Google Sheet: Tickets tab]

[Supervisor / Director email client]
        | clicks Approve/Reject link → doGet(?token=X&action=approve|reject)
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
| A | JRF # | 4-digit padded string e.g. `0001` |
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

### Tab name: `KnowledgeBase`
RAG data source. Tab name must be exactly `KnowledgeBase`. Row 1 = header.

| Column | Header | Notes |
|--------|--------|-------|
| A | Issue | Short title |
| B | Solution | Step-by-step fix |
| C | Category | Network / Hardware / Software / Account / Maintenance / External |
| D | Keywords | Comma-separated trigger words (optional) |

### Tab name: `Departments`
Maps department/office to supervisor for auto-fill during chatbot form flow.

| Column | Header | Notes |
|--------|--------|-------|
| A | Department/Office | e.g. `OCD`, `CID`, `FAD`, `SSD` |
| B | Supervisor Name | e.g. `Edman H. Gallamaso` |
| C | Supervisor Email | e.g. `supervisor@zrc.pshs.edu.ph` |

### Tab name: `Approvals`
Stores one-time approval tokens. Auto-created on first email send.

| Column | Header | Notes |
|--------|--------|-------|
| A | Token | UUID generated by `Utilities.getUuid()` |
| B | JRF# | Ticket this token belongs to |
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

**writeTextBlock helper** — breaks merged block into per-row merges, pre-wraps text at 120 chars per line, sets `WrapStrategy.CLIP`, locks each row height at 21px.

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
| `IT_STAFF_EMAIL` | IT staff email(s), comma-separated | Approval notifications + Dashboard login allow-list |
| `DASHBOARD_PASSWORD` | shared password string | Dashboard login authentication |

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
const DASHBOARD_SESSION_TTL    = 28800; // dashboard session: 8 hours (seconds)
const CHAT_SESSION_TTL         = 1800;  // chat session cache: 30 minutes (seconds)
const MAX_CHAT_MESSAGES        = 30;    // max user messages per chat session
const MAX_SUBMISSIONS_PER_HOUR = 20;    // global ticket submission rate limit per hour
const MAX_MESSAGE_LENGTH       = 1000;  // max characters accepted per user message
```

### Entry points
- **`doGet(e)`** — serves `Index.html` by default; `Dashboard.html` when `?page=dashboard`; routes to `handleApproval()` when `?token=X&action=Y`
- **`doPost(e)`** — routes to `handleChat`, `handleFormStep`, or `handleConfirm` based on `session.state`
- **`processChat(params)`** — called from `Index.html` via `google.script.run`; accepts `{ message, sessionId }`; sanitizes input; loads/saves session via CacheService; enforces per-session message limit

### Chat flow (server-side session state machine)

Client sends only `sessionId` (opaque UUID). Session object lives in `CacheService` for 30 minutes.

| `session.state` | Handler | Description |
|-----------------|---------|-------------|
| _(none)_ | `handleChat()` | RAG + Gemini; detects `%%FILE_TICKET:<desc>%%` signal |
| `'collecting'` | `handleFormStep()` | Walks through FORM_STEPS |
| `'confirm'` | `handleConfirm()` | Waits for yes/no; on yes → `saveTicket()` + locks chat UI |

### Form steps (FORM_STEPS array) — service location and rec type set by IT staff on Dashboard
1. `name` — full name
2. `position` — position/designation
3. `department` — department/office → triggers `lookupDepartment()` to auto-fill supervisor
4. `supervisor` — *(skippable if auto-filled from Departments sheet)*
5. `description` — problem description *(skippable — pre-filled from chat signal)*

### Pre-fill logic in handleChat()
When `%%FILE_TICKET%%` is detected, `session.formData.description` is pre-filled from the signal.
Additionally, if the description contains `cctv`, `footage`, or `camera` keywords, `session.formData.recType` is pre-set to `'Others, Repair'` and written to col G when the ticket is saved.

### Security functions
- **`sanitizeInput(text)`** — trims, enforces MAX_MESSAGE_LENGTH, strips `%%SIGNAL%%` and injection delimiters
- **`checkGlobalRateLimit()`** — CacheService sliding window; throws if > MAX_SUBMISSIONS_PER_HOUR in 60 min
- **`dashboardLogin(email, password)`** — validates against `IT_STAFF_EMAIL` + `DASHBOARD_PASSWORD`; returns UUID token stored in CacheService for DASHBOARD_SESSION_TTL seconds
- **`validateDashboardSession(token)`** — returns email if valid, null if expired/invalid
- **`dashboardLogout(token)`** — removes session from CacheService
- **`_requireDashboardAuth(token)`** — internal guard; throws `'Session expired. Please log in again.'` if invalid

### Backend functions
- **`searchKnowledgeBase(query)`** — keyword scoring against KnowledgeBase sheet, returns top 3 or null
- **`callGemini(message, history, kbContext)`** — Gemini API call with system prompt + KB context + history
- **`saveTicket(data)`** — calls `checkGlobalRateLimit()` first; appends 16-column row (A–P); sends supervisor approval email
- **`appendHistory(history, userText, modelText)`** — rolling 20-message history (max 10 turns)

### Approval functions
- **`sendApprovalEmail(type, jrfNo, ticket)`** — generates UUID token, stores in Approvals sheet (cols A–E, col E = Created ISO timestamp), emails supervisor or director with one-time approve/reject links
- **`handleApproval(token, action)`** — validates token; checks 7-day expiry against col E (Created); updates ticket status; notifies IT staff
- **`approvalHtmlPage(title, message)`** — returns styled HTML response for approval link clicks
- **`getStaffEmail(name)`** — looks up email from optional `Staff` sheet by name
- **`lookupDepartment(dept)`** — looks up supervisor name + email from `Departments` sheet

### Dashboard functions (all require `token` as first param → call `_requireDashboardAuth(token)`)
- **`getTickets(token)`** — returns array of ticket objects (all 16 fields including `dateCompleted`)
- **`submitAssessment(token, jrfNo, assignedStaff, recommendation, assessment, targetDate, othersDescription, serviceLocation)`** — saves cols G/H/I/K/N/O/P; sends director approval email
- **`updateTicketStatus(token, jrfNo, actionTaken, taskResult)`** — validates; writes cols H/J/L/M; requires status = `In Progress`
- **`updateTicketDetails(token, jrfNo, name, position, supervisor, problem)`** — corrects cols C/D/E/F
- **`assignStaff(token, jrfNo, staffName)`** — writes col I only
- **`generateFormPdf(authToken, jrfNo)`** — copies Template, fills all cells, exports A4 PDF as base64, deletes temp sheet (`authToken` avoids collision with internal OAuth token variable)

---

## 9. Gemini system prompt (8 rules)

```
You are the IT Support Chatbot for PSHS Zamboanga Regional Campus (PSHS ZRC).
You help staff troubleshoot IT issues and file IT Job Request Forms (ITJRF).

Behavior rules:
1. Be concise, professional, and friendly.
2. When answering technical questions, use the Knowledge Base entries provided.
3. If no KB entry is relevant, use your own knowledge to help troubleshoot.
4. If the user wants to file an IT Job Request (or the issue clearly requires one),
   end your reply with the exact signal: %%FILE_TICKET:<one-sentence summary>%%
   — do not mention this signal to the user in the visible part of your reply.
5. Do not make up ticket numbers or form details.
6. You handle IT support AND information/publication requests (graphic design, pubmat,
   social media posting, certificates) since the IT unit also serves as the designated
   Information Officers of PSHS ZRC. Publication and design requests use "Others, Repair".
7. This chatbot does NOT support file uploads or attachments. If a user mentions
   attaching or uploading files, politely inform them and ask them to describe in text.
8. CCTV viewing requests are governed by the Data Privacy Act. When a user asks about
   CCTV viewing, your FIRST response must inform the user that they need to prepare a
   formal letter addressed to the Campus Director containing the exact date, time range,
   camera location, and reason for the footage review, and that the Campus Director must
   approve this letter before IT can proceed. Do NOT ask for CCTV details — the user puts
   those in the letter, not in the ticket. After giving this instruction, end your reply
   with the %%FILE_TICKET%% signal so the chatbot proceeds to collect the user's name,
   position, department, and supervisor for the IT Job Request ticket.

ITJRF Recommendation Types (for reference):
1. Hardware Repair  2. Hardware Installation  3. Network Connection
4. Preventive Maintenance  5. Software Development  6. Software Modification
7. Software Installation  8. In-Campus Repair  9. External Service Provider Repair
10. Others, Repair
```

---

## 10. Index.html — chat UI

- Chat bubbles: user right, bot left
- Session object kept in JS, sent on every `processChat()` call via `google.script.run`
- Response `{ reply, replies, session, submitted }`:
  - If `replies` array has >1 item → render each as a **separate bubble** (used when Gemini acknowledgment + first form question are combined)
  - If `submitted: true` → lock input, hide chat bar, show **"Start a New Conversation"** button
- **"Start a New Conversation"** calls `resetChat()` — clears messages, resets session, re-enables input. Does NOT use `location.reload()` (breaks in Apps Script iframe).
- Primary color: `#1a3c6e` (PSHS dark blue)

---

## 11. Dashboard.html — IT staff management UI

Served at `?page=dashboard`. Uses `google.script.run` (no HTTP fetch).

### Features
- **Login overlay**: full-screen login on first load; validates email against `IT_STAFF_EMAIL` + `DASHBOARD_PASSWORD`; `dashToken` stored in `sessionStorage` (8-hour TTL via CacheService); auto-redirects to login on session expiry
- **Logout button**: in header; calls `dashboardLogout(token)` server-side
- **Stats bar**: Total / Active / Completed counts
- **Filter buttons**: All / Pending Approval / Pending Assessment / Pending Director / In Progress / Completed
- **Reports panel** (Reports button — always filled dark blue):
  - Monthly Summary table (year/month dropdowns, CSV export, avg. resolution days)
  - Overdue Tickets table (open > 7 days; red highlight at 14+ days)
  - Horizontal CSS bar chart by recommendation/service type
- **Table columns**: JRF #, Date, Name, Position, Problem, Recommendation, Assigned Staff, Status, Actions
- **Edit button** (every row): opens Edit modal to correct Name, Position, Supervisor, Problem Description
- **Action buttons** by status:
  - `Pending Supervisor Approval` / `Pending Director Approval` → "Awaiting approval…" (disabled)
  - `Pending IT Assessment` → **Assess** button
  - `In Progress` → **Complete** button
  - `Completed` → **PDF** button
- **Auto-refresh**: every 60 seconds (catches external email approval status changes)
- **Last updated** timestamp + logged-in email shown in header

### Assess modal fields
- Assigned Staff dropdown (Philip Bryan G. Padao / Danny A. Sulit)
- **Service Location** dropdown (In-Campus Repair / External Service Provider Repair) — **required** — stored in col P, written to row 21 checkboxes in PDF
- **Recommendation Type** dropdown (8 specific types — excludes In-Campus/External) — **required** — stored in col G, written to rows 23–24 checkboxes in PDF
- "Specify Others" textarea — **required** and visible only when `Others, Repair` is selected
- Target Date of Completion date input
- Assessment textarea — **required**

### Complete modal fields
- Task Result radio (Successful / Failed) — **required**
- Action Taken textarea — **required**

### Edit modal fields
- Full Name — **required**
- Position / Designation
- Immediate Supervisor
- Problem Description

---

## 12. Setup instructions

### Google Sheet tabs to create manually
1. `Tickets` — auto-created with headers on first ticket (columns A–P)
2. `KnowledgeBase` — add issues/solutions (see `docs/knowledge-base-sample.csv`; copy rows directly into the sheet)
3. `Departments` — columns: Department/Office | Supervisor Name | Supervisor Email
4. `Template` — paste the official ITJRF layout (see `docs/ITJRF.xlsx`)
5. `Approvals` — auto-created on first approval email

> **Existing Tickets sheets:** If the sheet already exists without col P header, manually add `Service Location` to cell P1.

### Script Properties to set
```
GEMINI_API_KEY      → from aistudio.google.com
WEBAPP_URL          → your deployed /exec URL
DIRECTOR_EMAIL      → e.g. director@zrc.pshs.edu.ph
IT_STAFF_EMAIL      → e.g. pgpadao@zrc.pshs.edu.ph,dasulit@zrc.pshs.edu.ph
DASHBOARD_PASSWORD  → shared password for IT staff dashboard login
```

### Deployment
1. Apps Script → **Deploy → New deployment**
2. Type: **Web app** / Execute as: **Me** / Who has access: **Anyone**
3. Copy the Web App URL → paste into `WEBAPP_URL` Script Property

> **After any code change:** Deploy → Manage deployments → pencil → New version → Deploy.

---

## 13. Known issues and decisions

| Issue | Fix / Decision |
|-------|---------------|
| Apps Script has no memory between requests | Chat session stored in CacheService (30 min TTL); client sends only `sessionId` string |
| Code edits do not go live automatically | Always create a new deployment version |
| Gemini mentions files | System prompt rule 7 blocks this |
| First form question combined with Gemini reply | `replies[]` array — UI renders each as separate bubble |
| Dashboard flickering on auto-refresh | Changed from 10s to 60s; table hides during load |
| Recommendation not in chatbot | Removed from FORM_STEPS; now set by IT staff in Assess modal |
| Service location not in chatbot | Set by IT staff in Assess modal; stored in col P |
| Supervisor email not found | Check Departments sheet col C has correct email; or add Staff sheet |
| PDF rows expanding | `writeTextBlock` uses word-wrap at 120 chars + WrapStrategy.CLIP + setRowHeight(21) |
| Others description in PDF | Saved to col O; written to Template cell P25 when recommendation = Others, Repair |
| Campus Director always same | Hard-coded as `Edman H. Gallamaso` in `generateFormPdf`, written bold to N28 |
| CCTV viewing requests | Rule 8 in system prompt: bot explains letter-to-CD requirement first, then files ticket. recType pre-set to Others, Repair via keyword detection |
| "Start a New Conversation" breaks in iframe | Uses `resetChat()` JS function instead of `location.reload()` |
| Supervisor email shows undefined recommendation | Recommendation line only shown in email if `ticket.recommendation` is set |
| Dashboard login "Unrecognized email" | Email must exactly match a value in the `IT_STAFF_EMAIL` script property (comma-separated) |
| Approval token expiry | Tokens have a 7-day TTL enforced via the `Created` timestamp in Approvals col E |
| Dashboard session expiry during use | `onServerError()` detects "Session expired" and redirects to login overlay automatically |
| Index.html background image not showing | Drive file must be shared as "Anyone with the link — Viewer" for the thumbnail URL to load |

---

## 14. How to start each Claude Code session

Claude Code reads this file automatically. Just state your task. Examples:

- "The supervisor approval email is not being received — here is the log: ..."
- "Add a Rejected filter button to the Dashboard."
- "The PDF is writing to the wrong cell for Assessment."
- "Add a new department to the Departments sheet lookup."

---

*PSHS ZRC IT Unit — ITJRF Chatbot — Google Apps Script + Gemini API (free tier)*
*IT Staff: Philip Bryan G. Padao | Danny A. Sulit | Campus Director: Edman H. Gallamaso*
