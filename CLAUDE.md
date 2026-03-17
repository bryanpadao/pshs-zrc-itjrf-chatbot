# PSHS ZRC — IT Job Request Form Chatbot
## Claude Code Context & Build Instructions

> This file is named `CLAUDE.md` and placed in the project root.
> Claude Code reads it automatically every session.
> If context seems lost, say: "Re-read CLAUDE.md before continuing."

---

## 1. Project summary

| Item | Detail |
|------|--------|
| Project name | PSHS ZRC IT Job Request Form Chatbot |
| School | Philippine Science High School — Zamboanga Regional Campus (PSHS ZRC) |
| Purpose | Faculty and staff report IT issues via chat; bot auto-generates ITJRF tickets with multi-step approval workflow |
| Platform | Google Apps Script + Google Sheets |
| AI model | Google Gemini API — model: `gemini-2.5-flash-lite` (free tier) |
| Approach | RAG — Apps Script searches KB sheet before calling Gemini |
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
         | IT staff submits Assess modal (recommendation + assessment + target date)
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
        | HTTP POST  { message, session }
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
[Dashboard.html] <--> [Code.gs server functions]
                              |-- getTickets()            returns all ticket rows
                              |-- submitAssessment()      saves recommendation+assessment; sends director email
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
│   └── knowledge-base-sample.csv  <- starter KB entries
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
| G | Recommendation Type | Set by IT staff during assessment — one of 10 exact types |
| H | Status | `Pending Supervisor Approval` → `Pending IT Assessment` → `Pending Director Approval` → `In Progress` → `Completed` / `Rejected` |
| I | Assigned Staff | Set via Dashboard Assess modal |
| J | Date Completed | Set automatically when marked Completed |
| K | Assessment | IT staff technical assessment |
| L | Action Taken | Steps taken to resolve |
| M | Task Result | `Successful` or `Failed` |
| N | Target Date | Target completion date set during assessment |
| O | Others Description | Free-text description when recommendation is "Others, Repair" → written to Template cell P25 |

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

**Recommendation checkboxes (write "✓" into matching cell, centered):**

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
| F21 | In-Campus Repair |
| J21 | External Service Provider Repair |

**writeTextBlock helper** — breaks merged block into per-row merges, pre-wraps text at 120 chars per line, sets `WrapStrategy.CLIP`, locks each row height at 21px.

---

## 6. ITJRF recommendation types (exact values — do not change spelling)

```
Hardware Repair
Hardware Installation
Network Connection
Preventive Maintenance
Software Development
Software Modification
Software Installation
In-Campus Repair
External Service Provider Repair
Others, Repair
```

> Publication/design/pubmat requests → use `Others, Repair`. Recommendation is set by IT staff on the Dashboard, NOT asked in the chatbot.

---

## 7. Script Properties (set in Apps Script Project Settings)

| Property | Value | Purpose |
|----------|-------|---------|
| `GEMINI_API_KEY` | key from aistudio.google.com | Gemini API authentication |
| `WEBAPP_URL` | deployed `/exec` URL | Base URL for approval email links |
| `DIRECTOR_EMAIL` | director's email address | Recipient for director approval emails |
| `IT_STAFF_EMAIL` | IT staff email(s), comma-separated | Notification when approvals are granted |

---

## 8. Code.gs — constants and functions

### Constants
```javascript
const SPREADSHEET_ID       = '1CDYLMBVKs2Ec1ufxFLi6Ed-SUU7faDWJkdrlt6TjQPE';
const KB_SHEET_NAME        = 'KnowledgeBase';
const ITJRF_SHEET_NAME     = 'Tickets';
const APPROVALS_SHEET_NAME = 'Approvals';
const GEMINI_MODEL         = 'gemini-2.5-flash-lite';
const GEMINI_ENDPOINT      = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
```

### Entry points
- **`doGet(e)`** — serves `Index.html` by default; `Dashboard.html` when `?page=dashboard`; routes to `handleApproval()` when `?token=X&action=Y`
- **`doPost(e)`** — routes to `handleChat`, `handleFormStep`, or `handleConfirm`
- **`processChat(params)`** — called from `Index.html` via `google.script.run`

### Chat flow (session-based state machine)

| `session.state` | Handler | Description |
|-----------------|---------|-------------|
| _(none)_ | `handleChat()` | RAG + Gemini; detects `%%FILE_TICKET:<desc>%%` signal |
| `'collecting'` | `handleFormStep()` | Walks through FORM_STEPS |
| `'confirm'` | `handleConfirm()` | Waits for yes/no; on yes → `saveTicket()` + locks chat UI |

### Form steps (FORM_STEPS array) — no rec_type (set by IT staff on Dashboard)
1. `name` — full name
2. `position` — position/designation
3. `department` — department/office → triggers `lookupDepartment()` to auto-fill supervisor
4. `supervisor` — *(skippable if auto-filled from Departments sheet)*
5. `description` — problem description *(skippable — pre-filled from chat signal)*

### Backend functions
- **`searchKnowledgeBase(query)`** — keyword scoring against KnowledgeBase sheet, returns top 3 or null
- **`callGemini(message, history, kbContext)`** — Gemini API call with system prompt + KB context + history
- **`saveTicket(data)`** — appends 15-column row; sends supervisor approval email
- **`appendHistory(history, userText, modelText)`** — rolling 20-message history

### Approval functions
- **`sendApprovalEmail(type, jrfNo, ticket)`** — generates UUID token, stores in Approvals sheet, emails supervisor or director with one-time approve/reject links
- **`handleApproval(token, action)`** — validates token, updates ticket status, notifies IT staff, returns HTML confirmation page
- **`approvalHtmlPage(title, message)`** — returns styled HTML response for approval link clicks
- **`getStaffEmail(name)`** — looks up email from optional `Staff` sheet by name
- **`lookupDepartment(dept)`** — looks up supervisor name + email from `Departments` sheet

### Dashboard functions (called via `google.script.run`)
- **`getTickets()`** — returns array of 15-field ticket objects
- **`submitAssessment(jrfNo, assignedStaff, recommendation, assessment, targetDate, othersDescription)`** — saves cols G/H/I/K/N/O; sends director approval email
- **`updateTicketStatus(jrfNo, actionTaken, taskResult)`** — validates; writes cols H/J/L/M; requires status = `In Progress`
- **`updateTicketDetails(jrfNo, name, position, supervisor, problem)`** — corrects cols C/D/E/F; available for all ticket statuses
- **`assignStaff(jrfNo, staffName)`** — writes col I only
- **`generateFormPdf(jrfNo)`** — copies Template, fills all cells (bold names, auto-fills Campus Director N28), exports A4 PDF as base64, deletes temp sheet

---

## 9. Gemini system prompt

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

ITJRF Recommendation Types (for reference):
1. Hardware Repair  2. Hardware Installation  3. Network Connection
4. Preventive Maintenance  5. Software Development  6. Software Modification
7. Software Installation  8. In-Campus Repair  9. External Service Provider Repair
10. Others, Repair
```

---

## 10. Index.html — chat UI

- Chat bubbles: user right, bot left
- Session object kept in JS, sent on every `processChat()` call
- Response `{ reply, replies, session, submitted }`:
  - If `replies` array has >1 item → render each as a **separate bubble** (used when Gemini acknowledgment + first form question are combined)
  - If `submitted: true` → lock input, hide chat bar, show **"Start a New Conversation"** button
- Primary color: `#1a3c6e` (PSHS dark blue)

---

## 11. Dashboard.html — IT staff management UI

Served at `?page=dashboard`. Uses `google.script.run` (no HTTP fetch).

### Features
- **Stats bar**: Total / Active / Completed counts
- **Filter buttons**: All / Pending Approval / Pending Assessment / Pending Director / In Progress / Completed
- **Table columns**: JRF #, Date, Name, Position, Problem, Recommendation, Assigned Staff, Status, Actions
- **Edit button** (every row): opens Edit modal to correct Name, Position, Supervisor, Problem Description
- **Action buttons** by status:
  - `Pending Supervisor Approval` / `Pending Director Approval` → "Awaiting approval…" (disabled)
  - `Pending IT Assessment` → **Assess** button
  - `In Progress` → **Complete** button
  - `Completed` → **PDF** button
- **Auto-refresh**: every 60 seconds (catches external email approval status changes)
- **Last updated** timestamp shown in header

### Assess modal fields
- Assigned Staff dropdown (Philip Bryan G. Padao / Danny A. Sulit)
- Recommendation Type dropdown (all 10 types) — **required**
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
1. `Tickets` — auto-created with headers on first ticket
2. `KnowledgeBase` — add issues/solutions (see `docs/knowledge-base-sample.csv`)
3. `Departments` — columns: Department/Office | Supervisor Name | Supervisor Email
4. `Template` — paste the official ITJRF layout (see `docs/ITJRF.xlsx`)
5. `Approvals` — auto-created on first approval email

### Script Properties to set
```
GEMINI_API_KEY   → from aistudio.google.com
WEBAPP_URL       → your deployed /exec URL
DIRECTOR_EMAIL   → e.g. director@zrc.pshs.edu.ph
IT_STAFF_EMAIL   → e.g. pgpadao@zrc.pshs.edu.ph,dasulit@zrc.pshs.edu.ph
```

### Deployment
1. Apps Script → **Deploy → New deployment**
2. Type: **Web app** / Execute as: **Me** / Who has access: **Anyone**
3. Copy the Web App URL → paste into `WEBAPP_URL` Script Property AND into `SCRIPT_URL` in `Index.html`

> **After any code change:** Deploy → Manage deployments → pencil → New version → Deploy.

---

## 13. Known issues and decisions

| Issue | Fix / Decision |
|-------|---------------|
| Apps Script has no memory between requests | `Index.html` sends full `session` on every POST |
| Code edits do not go live automatically | Always create a new deployment version |
| Gemini mentions files | System prompt rule 7 blocks this |
| First form question combined with Gemini reply | `replies[]` array — UI renders each as separate bubble |
| Dashboard flickering on auto-refresh | Changed from 10s to 60s; table hides during load |
| Recommendation not in chatbot | Removed from FORM_STEPS; now set by IT staff in Assess modal |
| Supervisor email not found | Check Departments sheet col C has correct email; or add Staff sheet |
| PDF rows expanding | `writeTextBlock` uses word-wrap at 120 chars + WrapStrategy.CLIP + setRowHeight(21) |
| Others description in PDF | Saved to Tickets col O; written to Template cell P25 when recommendation = Others |
| Campus Director always same | Hard-coded as `Edman H. Gallamaso` in `generateFormPdf`, written bold to N28 |

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
