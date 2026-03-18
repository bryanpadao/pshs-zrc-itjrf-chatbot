# PSHS ZRC IT Job Request Form (ITJRF) Chatbot

A Google Apps Script chatbot that helps PSHS Zamboanga Regional Campus faculty and staff submit IT Job Requests and troubleshoot common IT issues through a conversational interface. Submitted tickets go through a supervisor → director approval workflow before IT staff take action.

---

## Repository Structure

```
pshs-zrc-itjrf-chatbot/
├── CLAUDE.md                       — Claude Code context file (auto-read each session)
├── appsscript/
│   ├── Code.gs                     — Backend: all server-side functions
│   ├── Index.html                  — Chat UI for faculty/staff
│   ├── Dashboard.html              — IT staff ticket management dashboard
│   └── appsscript.json             — Apps Script manifest (scopes, runtime)
├── docs/
│   ├── ITJRF.xlsx                  — Original blank IT Job Request Form template
│   └── knowledge-base-sample.csv  — Starter KB entries
└── README.md                       — This file
```

---

## Prerequisites

- A Google account with access to Google Drive and Google Sheets
- Permission to deploy Google Apps Script Web Apps within your Google Workspace domain
- A Gemini API key from [aistudio.google.com](https://aistudio.google.com) (free tier)

---

## Google Sheet Setup

### 1. Create the Spreadsheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet.
2. Rename it (e.g. **PSHS ZRC ITJRF**).
3. Create the following tabs (exact names required):

| Tab | Purpose |
|-----|---------|
| `Tickets` | One row per submitted IT job request |
| `KnowledgeBase` | RAG data source — issues and solutions |
| `Template` | Copy of the official ITJRF layout for PDF export |
| `Departments` | Maps department/office names to supervisor info |
| `Approvals` | One-time approval tokens (managed by the script) |

4. Copy your spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit`

### 2. Tickets Tab — Column Layout

| Col | Header | Notes |
|-----|--------|-------|
| A | JRF # | Auto-incremented 4-digit padded string e.g. `0001` |
| B | Date | Submission date `yyyy-MM-dd` |
| C | Name | Requester full name |
| D | Position | Requester position/role |
| E | Supervisor | Immediate supervisor name |
| F | Problem Description | Full problem description |
| G | Recommendation Type | Set by IT staff via Dashboard Assess modal |
| H | Status | `Pending Supervisor Approval` → `Pending IT Assessment` → `Pending Director Approval` → `In Progress` → `Completed` / `Rejected` |
| I | Assigned Staff | Set via Dashboard Assess modal |
| J | Date Completed | Set automatically when marked Completed |
| K | Assessment | IT staff's technical assessment |
| L | Action Taken | Steps taken to resolve |
| M | Task Result | `Successful` or `Failed` |
| N | Target Date | Target date for completion (set during assessment) |
| O | Others Description | Used when Recommendation Type is "Others, Repair" — written to PDF cell P25 |
| P | Service Location | `In-Campus Repair` or `External Service Provider Repair` — set during assessment |

> **Existing Tickets sheets:** If the sheet already exists without col P, manually add `Service Location` to cell P1.

### 3. KnowledgeBase Tab — Column Layout

| Col | Header | Notes |
|-----|--------|-------|
| A | Issue | Short title of the issue |
| B | Solution | Step-by-step fix |
| C | Category | Network / Hardware / Software / Account / Maintenance / External |
| D | Keywords | Comma-separated trigger words (optional) |

Copy the contents of `docs/knowledge-base-sample.csv` into this tab as a starting point.

### 4. Departments Tab — Column Layout

| Col | Header | Notes |
|-----|--------|-------|
| A | Department/Office | Exact name users will type in the chatbot |
| B | Supervisor Name | Full name of the immediate supervisor |
| C | Supervisor Email | Email address for approval notifications |

When a user types their department in the chatbot, the script auto-looks up their supervisor's name and email for the approval workflow.

---

## Apps Script Setup

### 1. Create the Script

1. In your spreadsheet, go to **Extensions > Apps Script**.
2. Delete the default `Code.gs` content and paste the contents of `appsscript/Code.gs`.
3. Set the `SPREADSHEET_ID` constant at the top of `Code.gs` to your spreadsheet's ID.
4. Create an HTML file named `Index`: click **+** next to Files → HTML → name it `Index`. Paste `appsscript/Index.html`.
5. Create an HTML file named `Dashboard`: same steps, paste `appsscript/Dashboard.html`.
6. Enable manifest editing: **Project Settings → Show "appsscript.json" manifest file in editor**. Replace its contents with `appsscript/appsscript.json`.

### 2. Set Script Properties

Go to **Project Settings → Script Properties** and add:

| Property | Value |
|----------|-------|
| `GEMINI_API_KEY` | Your key from aistudio.google.com |
| `WEBAPP_URL` | Your deployed Web App URL (set after first deploy) |
| `IT_STAFF_EMAIL` | Comma-separated IT staff emails — also controls who can log into the Dashboard (e.g. `pgpadao@zrc.pshs.edu.ph,dasulit@zrc.pshs.edu.ph`) |
| `DIRECTOR_EMAIL` | Email address of the Campus Director for approval |
| `DASHBOARD_PASSWORD` | Shared password for IT staff Dashboard login |

### 3. Authorize the Script

1. In the Apps Script editor, run any function (e.g. `getTickets`) from the toolbar.
2. A permissions dialog will appear — click **Review permissions → Allow**.
3. This grants the script access to Sheets, Gmail (for approval emails), and external URLs (Gemini API).

---

## Deployment

### Deploy as a Web App

1. Click **Deploy → New deployment**.
2. Select type: **Web app**.
3. Set:
   - **Execute as:** Me (the IT admin account)
   - **Who has access:** Anyone within your domain — or *Anyone* for open access
4. Click **Deploy**, approve permissions, and copy the Web App URL.
5. Paste the Web App URL into Script Properties as `WEBAPP_URL`.
6. Share the chatbot URL with faculty and staff.
7. The IT staff dashboard is at: `YOUR_WEBAPP_URL?page=dashboard`

### Re-deploying After Code Changes

After editing any file, always create a **new deployment version**:
**Deploy → Manage deployments → pencil icon → New version → Deploy**

The URL stays the same. Changes do NOT go live until you create a new version.

---

## How It Works

### Chatbot Flow (faculty/staff)

1. User opens the chatbot URL and describes their IT issue.
2. The bot searches the **KnowledgeBase** tab for a matching issue using keyword scoring.
   - If a match is found, the solution is returned immediately.
3. If no match is found (or the issue requires a job request), Gemini decides to file a ticket and signals `%%FILE_TICKET:<description>%%`.
4. The bot collects the following fields step by step:
   - Full name
   - Position/designation
   - Department or office (auto-looks up supervisor from Departments tab)
   - Problem description (pre-filled from the Gemini signal)
5. The user reviews a summary and confirms with "yes" to submit.
6. On submission, the chat locks and a **"Start a New Conversation"** button appears.

### Approval Workflow (after submission)

```
Ticket submitted
      ↓
Supervisor approval email sent (with approve/reject link)
      ↓ approved
Status: Pending IT Assessment
IT Staff email notification sent
      ↓
IT staff opens Dashboard → assigns staff → submits Assessment modal
  (fills: Recommendation Type, Assessment notes, Target Date)
      ↓
Director approval email sent
      ↓ approved
Status: In Progress
      ↓
IT staff opens Dashboard → clicks Complete → fills Action Taken + Task Result
      ↓
Status: Completed
PDF of the official ITJRF can be downloaded from the Dashboard
```

Approval links are single-use UUID tokens stored in the `Approvals` tab. Clicking a link a second time shows "Already processed." Links automatically expire after **7 days**.

---

## IT Staff Dashboard

Access at: `YOUR_WEBAPP_URL?page=dashboard`

### Authentication

The Dashboard is protected by a login screen. IT staff must enter their email (must match `IT_STAFF_EMAIL`) and the shared `DASHBOARD_PASSWORD`. Sessions are valid for **8 hours** and are stored server-side in CacheService — they automatically expire and are cleared on logout.

### Features

- **Stats bar**: Total / Active / Completed ticket counts
- **Filter buttons**: All / Pending Approval / Pending Assessment / Pending Director / In Progress / Completed
- **Reports panel** (Reports button):
  - Monthly Summary table with year/month dropdowns and CSV export
  - Overdue Tickets table (open > 7 days; highlighted red at 14+ days)
  - Horizontal bar chart of ticket counts by recommendation/service type
- **Edit button** (every ticket): Correct Name, Position, Supervisor, or Problem Description
- **Assess button** (Pending IT Assessment tickets):
  - Select Assigned Staff, Service Location, Recommendation Type
  - If "Others, Repair" — enter a description (saved to col O, written to PDF cell P25)
  - Enter Assessment notes and Target Date
  - Triggers director approval email
- **Complete button** (In Progress tickets):
  - Enter Action Taken and Task Result (Successful / Failed)
  - Marks ticket as Completed and records the completion date
- **PDF button** (Completed tickets):
  - Generates a filled copy of the official ITJRF as a downloadable PDF
- **Auto-refresh**: every 60 seconds to pick up approval status changes

---

## ITJRF Recommendation Types

The following are the exact values used in the system:

1. Hardware Repair
2. Hardware Installation
3. Network Connection
4. Preventive Maintenance
5. Software Development
6. Software Modification
7. Software Installation
8. In-Campus Repair
9. External Service Provider Repair
10. Others, Repair

> Publication, design, pubmat, and social media requests → use **Others, Repair**

---

## Customizing the Knowledge Base

Add rows to the `KnowledgeBase` tab:

| Issue | Solution | Category | Keywords |
|-------|----------|----------|----------|
| Describe the problem | Step-by-step fix | Network / Hardware / Software / Account / Maintenance / External | comma, separated, words |

Keyword matching is case-insensitive. The `Keywords` column (D) is optional — the script also matches against the Issue text.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| No supervisor approval email sent | Check `WEBAPP_URL` Script Property is set. Re-authorize the script by running a function from the editor. |
| "Invalid Link" on approval page | Expected for test tokens. Real ticket approval links work correctly. |
| "Link Expired" on approval page | Links expire after 7 days. Ask IT to resend if still needed. |
| "Already processed" on approval link | The link was already clicked — check ticket status in the Dashboard. |
| Approval emails not received | Verify `DIRECTOR_EMAIL` / `IT_STAFF_EMAIL` Script Properties are correct. Check spam. |
| Dashboard login: "Unrecognized email" | Ensure the email matches exactly what is in the `IT_STAFF_EMAIL` Script Property (comma-separated). |
| Dashboard login: "Incorrect password" | Set `DASHBOARD_PASSWORD` in Script Properties. |
| Chatbot not updating after code changes | Create a new deployment version. |
| KnowledgeBase not returning results | Ensure the tab is named exactly `KnowledgeBase` and the Issue column contains relevant keywords. |
| Web App shows "You need permission" | Change the deployment's access setting to the appropriate audience. |
| "There was a problem saving your request" | Check that `SPREADSHEET_ID` is correct in `Code.gs` and the script has edit access to the sheet. |
| "Submission limit reached" in chatbot | The system allows max 20 ticket submissions per hour globally. Wait and try again. |
| Dashboard not reflecting approval status | The dashboard auto-refreshes every 60 seconds. Wait or reload the page manually. |
| PDF button is greyed out | PDF is only available for **Completed** tickets. |
| Background image not showing on chatbot | Ensure the Drive image file is shared as "Anyone with the link — Viewer". |

---

## IT Staff

- Philip Bryan G. Padao
- Danny A. Sulit

For questions about this setup, contact the PSHS ZRC IT department.
