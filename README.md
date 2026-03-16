# PSHS ZRC IT Job Request Form (ITJRF) Chatbot

A Google Apps Script chatbot that helps PSHS Zamboanga Regional Campus staff submit IT Job Requests and troubleshoot common IT issues through a conversational interface.

---

## Repository Structure

```
pshs-zrc-itjrf-chatbot/
├── appsscript/
│   ├── Code.gs              — Main backend logic (message routing, KB search, form flow, sheet writing)
│   ├── Index.html           — Chat UI (served as a Google Apps Script Web App)
│   └── appsscript.json      — Manifest file (runtime, timezone, webapp access settings)
├── docs/
│   ├── ITJRF.xlsx           — Original IT Job Request Form template
│   └── knowledge-base-sample.csv — Sample IT issues and solutions for the KB sheet
└── README.md                — Setup instructions for future IT staff
```

---

## Prerequisites

- A Google account with access to Google Drive and Google Sheets
- Permission to deploy Google Apps Script Web Apps within your Google Workspace domain

---

## Setup Instructions

### 1. Create the Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet.
2. Rename it to something like **PSHS ZRC ITJRF**.
3. Create two sheets (tabs) inside it:
   - `KB` — for the knowledge base
   - `ITJRF` — for submitted job requests (the script will auto-create headers on first submission)
4. Copy the contents of `docs/knowledge-base-sample.csv` into the `KB` sheet.
   - Column A: **Issue**
   - Column B: **Solution**
   - Column C: **Category**
5. Copy your spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit`

### 2. Set Up Google Apps Script

1. In your spreadsheet, go to **Extensions > Apps Script**.
2. Delete the default `Code.gs` content.
3. Copy the contents of `appsscript/Code.gs` into the editor.
4. Paste your spreadsheet ID into the `SPREADSHEET_ID` constant at the top of `Code.gs`.
5. Create a new HTML file: click **+** next to Files, choose **HTML**, and name it `Index`.
6. Replace its contents with the contents of `appsscript/Index.html`.
7. Replace `appsscript.json` with the contents of `appsscript/appsscript.json` (enable manifest editing under **Project Settings**).

### 3. Deploy as a Web App

1. Click **Deploy > New deployment**.
2. Select type: **Web app**.
3. Set:
   - **Execute as:** Me (or the IT admin account)
   - **Who has access:** Anyone within [your domain] — or *Anyone* for open access
4. Click **Deploy** and copy the Web App URL.
5. Share the URL with staff so they can access the chatbot.

### 4. Re-deploying After Changes

After editing `Code.gs` or `Index.html`, always create a **new deployment version** (Deploy > Manage deployments > Edit > New version) so changes take effect.

---

## How It Works

1. **User sends a message** via the chat UI.
2. The backend searches the **KB sheet** for a matching issue using keyword matching.
   - If a match is found, the solution is returned immediately.
3. If no match is found, the chatbot guides the user through the **ITJRF form flow**, collecting:
   - Full name
   - Department
   - Date
   - Issue type (Hardware / Software / Network / Others)
   - Issue description
   - Priority (Low / Medium / High)
4. On completion, the form data is saved as a new row in the **ITJRF sheet**.

---

## Customizing the Knowledge Base

To add new entries, simply add rows to the `KB` sheet in your Google Spreadsheet:

| Issue | Solution | Category |
|-------|----------|----------|
| Describe the problem | Step-by-step solution | Hardware / Software / Network / Account / Security / Data |

Keyword matching is case-insensitive and checks if any word in the user's message appears in the Issue column.

---

## Updating the ITJRF Form Fields

To add or change form questions, edit the `FORM_STEPS` array in `Code.gs`:

```javascript
const FORM_STEPS = [
  { key: 'name',        prompt: 'What is your full name?' },
  { key: 'department',  prompt: 'What is your department or office?' },
  // Add new steps here
];
```

Make sure `saveFormToSheet()` also writes the new field to the sheet.

---

## Troubleshooting the Chatbot

| Problem | Fix |
|---------|-----|
| "There was a problem saving your request" | Check that `SPREADSHEET_ID` is correct in `Code.gs` and the script has edit access to the sheet. |
| Chatbot not updating after code changes | Create a new deployment version. |
| KB not returning results | Ensure the sheet is named exactly `KB` and keywords in the Issue column match what users are typing. |
| Web App shows "You need permission" | Change the deployment's access setting to the appropriate audience. |

---

## Contact

For questions about this setup, contact the PSHS ZRC IT department.
