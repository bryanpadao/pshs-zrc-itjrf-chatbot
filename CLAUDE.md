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
| Purpose | Faculty and staff report IT issues via chat; bot auto-generates ITJRF tickets |
| Platform | Google Apps Script + Google Sheets |
| AI model | Google Gemini API — model: `gemini-1.5-flash` (free tier, 1,500 req/day) |
| Approach | RAG — Apps Script searches KnowledgeBase sheet before calling Gemini |
| Official form ID | PSHS-00-F-ITU-01-Ver02-Rev2-12/31/21 |
| Cost | PHP 0.00 — Gemini free tier + Google Sheets + Apps Script are all free |
| GitHub repo | `pshs-zrc-itjrf-chatbot` (private) |

---

## 2. Architecture

```
[Faculty / Staff browser]
        |
        | HTTP POST  { message, history[], action }
        v
[Index.html] --> [doPost(e) in Code.gs]
                        |
                        |-- searchKnowledgeBase(message)  reads KnowledgeBase tab
                        |-- callGemini(history, context)  calls Gemini API
                        |-- saveTicket(ticket)            appends row to Tickets tab
                        |-- generateForm(ticket)          copies Template tab, fills cells
                        v
              [Google Sheet: Tickets tab + per-ticket Template copy]
```

---

## 3. Repository file structure

```
pshs-zrc-itjrf-chatbot/
├── CLAUDE.md                       <- this file, auto-read by Claude Code
├── appsscript/
│   ├── Code.gs                     <- backend: doPost, searchKB, callGemini, saveTicket, generateForm
│   ├── Index.html                  <- frontend: chat UI
│   └── appsscript.json             <- Apps Script manifest
├── docs/
│   ├── ITJRF.xlsx                  <- original blank form (do not modify)
│   └── knowledge-base-sample.csv  <- starter KB entries
└── README.md
```

---

## 4. Google Sheet — 3 required tabs

### Tab name: `Tickets`
One row per submitted ticket. Row 1 is the header row.

| Column | Header | Notes |
|--------|--------|-------|
| A | JRF # | Auto-generated format: `ZRC-YYYY-NNN` e.g. ZRC-2025-001 |
| B | Date | Submission date, set by Apps Script |
| C | Name | Requester full name |
| D | Position | Requester position / role |
| E | Supervisor | Immediate supervisor name |
| F | Problem | Full problem description from the conversation |
| G | Recommendation | One of the 10 exact ITJRF recommendation types (see Section 5) |
| H | Status | Default value: `Open` — IT staff updates to `In Progress` or `Completed` |
| I | Assigned Staff | Filled by IT unit after ticket is received |
| J | Date Completed | Filled by IT unit when resolved |

### Tab name: `KnowledgeBase`
The RAG data source. Row 1 is the header row.

| Column | Header | Notes |
|--------|--------|-------|
| A | Category | Network / Hardware / Software / Account / Maintenance / External |
| B | Keywords | Comma-separated trigger words the user might type |
| C | Problem Description | Full description of the issue |
| D | Standard Solution | Step-by-step fix for IT staff |
| E | Recommendation Type | Must match one of the 10 ITJRF types exactly (see Section 5) |
| F | Priority Level | High / Medium / Low |
| G | Estimated Duration | e.g. `30-60 mins` |

### Tab name: `Template`
A copy of the official ITJRF layout. `generateForm()` copies this tab per ticket.

**EXACT cell map verified from ITJRF.xlsx — use these coordinates when writing values:**

| Cell | Form label | Value to write |
|------|-----------|----------------|
| M6 | IT JRF #: | ticket.jrfNumber |
| F6 | Name | ticket.name |
| F7 | Position | ticket.position |
| F9 | Immediate Supervisor | ticket.supervisor |
| M8 | Date: | ticket.date |
| C11 | Request / Problem (fill area) | ticket.problem |
| D23 | Hardware Repair checkbox area | write "X" if recommendation matches |
| G23 | Hardware Installation checkbox area | write "X" if recommendation matches |
| K23 | Network Connection checkbox area | write "X" if recommendation matches |
| P23 | Preventive Maintenance checkbox area | write "X" if recommendation matches |
| D24 | Software Development checkbox area | write "X" if recommendation matches |
| G24 | Software Modification checkbox area | write "X" if recommendation matches |
| K24 | Software Installation checkbox area | write "X" if recommendation matches |
| P24 | Others, Repair checkbox area | write "X" if recommendation matches |
| G21 | In-Campus Repair checkbox area | write "X" if recommendation matches |
| K21 | External Service Provider Repair checkbox area | write "X" if recommendation matches |
| C28 | Assigned Staff name | leave blank on submit |
| I27 | Target Date of Completion | leave blank on submit |
| B31 | Action Taken (fill area) | leave blank on submit |
| C38 | Date Completed | leave blank on submit |
| H38 | Serviced by | leave blank on submit |
| N38 | Confirmed by User | leave blank on submit |

**Read-only label cells — never overwrite these:**

| Cell | Value |
|------|-------|
| B1 | PHILIPPINE SCIENCE HIGH SCHOOL SYSTEM |
| B2 | CAMPUS: ZRC |
| B4 | IT JOB REQUEST FORM |
| B6 | Requested by: |
| B8 | Approved by: |
| B10 | Request/ Problem: |
| B15 | Assessment: |
| B21 | Recommendation: |
| B27 | Assigned Staff (IT/ ISA): |
| B30 | Action Taken: |
| B35 | Status/ Condition: |
| B38 | Date Completed: |
| B43 | PSHS-00-F-ITU-01-Ver02-Rev2-12/31/21 |

---

## 5. ITJRF recommendation types (exact values — do not change spelling)

The `ticket.recommendation` field and the KnowledgeBase `Recommendation Type` column
must use one of these exactly, including capitalisation and commas:

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

---

## 6. Code.gs — five functions to build

### `doPost(e)`
Entry point for every HTTP POST from Index.html.

```javascript
function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const { message, history, action } = body;

  if (action === 'saveTicket') {
    return saveTicket(body.ticket);
  }

  const context = searchKnowledgeBase(message);
  const reply = callGemini(history, context);

  return ContentService
    .createTextOutput(JSON.stringify({ reply }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

### `searchKnowledgeBase(message)`
- Opens the `KnowledgeBase` tab
- Splits `message` into individual words
- For each row checks if any word in column B (Keywords) matches any word in the message (case-insensitive)
- Returns up to 3 matching rows as a plain text string
- Returns empty string if no matches

### `callGemini(history, context)`
- Gets API key from Script Properties key `GEMINI_API_KEY`
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=KEY`
- Sends system prompt (Section 7) + KB context + full history array
- Uses `UrlFetchApp.fetch()` — method POST, contentType application/json
- Returns the reply text string

### `saveTicket(ticket)`
- Opens the `Tickets` tab
- Counts existing data rows to generate next JRF number in format `ZRC-YYYY-NNN`
- Appends one new row in the column order defined in Section 4
- Sets Status to `Open` by default
- Calls `generateForm(ticket)` after appending the row
- Returns JSON containing the generated `jrfNumber`

### `generateForm(ticket)`
- Makes a copy of the `Template` tab
- Renames the copy to the ticket JRF number (e.g. `ZRC-2025-001`)
- Writes ticket values only into the value cells listed in Section 4
- Writes `"X"` into the cell matching `ticket.recommendation` from the checkbox cells in Section 4
- Does NOT overwrite any label cells listed in Section 4

---

## 7. Gemini system prompt

Use this verbatim as the system instruction in `callGemini()`.
Replace `{context}` with the string returned by `searchKnowledgeBase()`.

```
You are the IT Help Desk assistant of Philippine Science High School -
Zamboanga Regional Campus (PSHS ZRC).

Your job is to help faculty and staff report IT issues by collecting all
the information needed to fill out an IT Job Request Form (ITJRF).
Be friendly, concise, and professional. Ask one or two questions at a time.

Collect these five fields through natural conversation:
1. Full name
2. Position / role at PSHS ZRC
3. Immediate supervisor's name
4. Full description of the IT problem
5. Recommendation type - guide them to the correct option based on their problem

Valid recommendation types (use exact spelling including commas):
- Hardware Repair
- Hardware Installation
- Network Connection
- Preventive Maintenance
- Software Development
- Software Modification
- Software Installation
- In-Campus Repair
- External Service Provider Repair
- Others, Repair

If a CONTEXT section is provided below, use it to give accurate,
school-specific troubleshooting guidance before collecting the fields.

Once all five fields are collected, summarize the ticket clearly and ask:
"Is this correct? Reply yes to submit."

When the user confirms with yes, output ONLY the following JSON with no
text before or after it:

{"name":"","position":"","supervisor":"","problem":"","recommendation":""}

CONTEXT:
{context}
```

---

## 8. Index.html — requirements

- Chat window with message bubbles: user on the right, bot on the left
- Text input and Send button at the bottom; Enter key also sends
- Full conversation history kept in a JS array named `history`
- On every Send, POST to the Apps Script web app URL with `{ message, history }`
- Append bot reply to the chat window and push it to `history`
- After each bot reply, check if the text contains a JSON block `{...}`
- If JSON is detected: parse it as the ticket object, hide the input bar, show a green Submit Ticket button
- On Submit Ticket click, POST with `{ action: 'saveTicket', ticket: parsedTicket }`
- On success response, show: "Ticket [JRF #] submitted. The IT unit will contact you shortly."
- Primary color: `#1D9E75` (PSHS green), white background, Arial font
- Must be responsive and work on mobile browsers

---

## 9. API key setup

> Never hardcode the API key in Code.gs. Always use Script Properties.

1. Apps Script → gear icon → **Project Settings**
2. Scroll to **Script Properties** → **Add script property**
3. Name: `GEMINI_API_KEY` / Value: your key from aistudio.google.com
4. Click **Save script properties**

In code:
```javascript
const API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
```

---

## 10. Deployment

1. Apps Script → **Deploy → New deployment**
2. Type: **Web app**
3. Execute as: **Me**
4. Who has access: **Anyone**
5. Deploy → approve all permission prompts
6. Copy the Web App URL → set it as the `SCRIPT_URL` constant in `Index.html`

> After any code change: **Deploy → Manage deployments → New version**.
> The URL stays the same but the live code will not update until you do this.

---

## 11. Known issues and fixes

| Issue | Fix |
|-------|-----|
| Apps Script has no memory between requests | `Index.html` sends the full `history` array on every POST |
| Code edits do not go live automatically | Always create a new deployment version after changes |
| Two Google accounts (API key vs Sheet owner) | Fine — create Apps Script from the Sheet owner's account |
| Gemini returns malformed JSON | Wrap JSON.parse in try/catch; if it fails treat the reply as plain text |
| Recommendation value does not match exactly | Validate against the 10 exact strings in Section 5 before saving |
| Wrong cell written in generateForm | Only use the verified cell addresses in Section 4 |

---

## 12. How to start each Claude Code session

Claude Code reads this file automatically from the project root.
Just state your task — no need to re-paste context. Examples:

- "Write the complete `Code.gs` with all five functions."
- "Build `Index.html` with the chat UI per the spec in CLAUDE.md."
- "The `callGemini` function is returning a 400 error — here is the log: ..."
- "Add a MailApp email alert inside `saveTicket` when a new ticket is written."
- "The recommendation checkbox cell is not being marked in `generateForm`."

---

*PSHS ZRC IT Unit — ITJRF Chatbot — Google Apps Script + Gemini API (free tier)*
