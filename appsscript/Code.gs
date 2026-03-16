// PSHS ZRC IT Job Request Form (ITJRF) Chatbot
// Google Apps Script backend

const SPREADSHEET_ID = ''; // TODO: Set your Google Sheet ID here
const KB_SHEET_NAME = 'KB';
const FORM_SHEET_NAME = 'ITJRF';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('PSHS ZRC IT Support Chatbot')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  const params = JSON.parse(e.postData.contents);
  const userMessage = params.message;
  const sessionData = params.session || {};

  const response = handleMessage(userMessage, sessionData);
  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- Message Router ---

function handleMessage(message, session) {
  // Check knowledge base first
  const kbMatch = searchKnowledgeBase(message);
  if (kbMatch) {
    return { reply: kbMatch, session };
  }

  // Guide user through ITJRF submission
  return handleFormFlow(message, session);
}

// --- Knowledge Base Search ---

function searchKnowledgeBase(query) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(KB_SHEET_NAME);
    if (!sheet) return null;

    const data = sheet.getDataRange().getValues();
    const keywords = query.toLowerCase().split(' ');

    for (let i = 1; i < data.length; i++) {
      const issue = String(data[i][0]).toLowerCase();
      const solution = String(data[i][1]);
      const matched = keywords.some(kw => issue.includes(kw));
      if (matched) {
        return `I found something that might help:\n\n*Issue:* ${data[i][0]}\n*Solution:* ${solution}`;
      }
    }
  } catch (err) {
    Logger.log('KB search error: ' + err);
  }
  return null;
}

// --- ITJRF Form Flow ---

const FORM_STEPS = [
  { key: 'name',        prompt: 'What is your full name?' },
  { key: 'department',  prompt: 'What is your department or office?' },
  { key: 'date',        prompt: 'What is today\'s date? (YYYY-MM-DD)' },
  { key: 'issue_type',  prompt: 'What type of issue is this? (e.g., Hardware, Software, Network, Others)' },
  { key: 'description', prompt: 'Please describe the issue in detail.' },
  { key: 'priority',    prompt: 'How urgent is this? (Low / Medium / High)' },
];

function handleFormFlow(message, session) {
  if (!session.formActive) {
    // Start form if user says so
    const triggers = ['request', 'submit', 'report', 'issue', 'problem', 'form', 'help'];
    const lower = message.toLowerCase();
    if (triggers.some(t => lower.includes(t))) {
      session.formActive = true;
      session.step = 0;
      session.formData = {};
      return {
        reply: 'I\'ll help you file an IT Job Request. Let\'s get started.\n\n' + FORM_STEPS[0].prompt,
        session
      };
    }
    return {
      reply: 'Hello! I\'m the PSHS ZRC IT Support Chatbot. I can help you troubleshoot issues or submit an IT Job Request Form. How can I help you today?',
      session
    };
  }

  // Collect form answers
  const step = FORM_STEPS[session.step];
  session.formData[step.key] = message;
  session.step++;

  if (session.step < FORM_STEPS.length) {
    return { reply: FORM_STEPS[session.step].prompt, session };
  }

  // All steps done — save to sheet
  const result = saveFormToSheet(session.formData);
  session.formActive = false;
  session.step = 0;

  return {
    reply: result
      ? `Your IT Job Request has been submitted successfully! ✅\n\nOur IT staff will get back to you shortly.`
      : `There was a problem saving your request. Please contact IT directly.`,
    session
  };
}

// --- Save ITJRF to Google Sheet ---

function saveFormToSheet(data) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(FORM_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(FORM_SHEET_NAME);
      sheet.appendRow(['Timestamp', 'Name', 'Department', 'Date', 'Issue Type', 'Description', 'Priority']);
    }
    sheet.appendRow([
      new Date(),
      data.name,
      data.department,
      data.date,
      data.issue_type,
      data.description,
      data.priority
    ]);
    return true;
  } catch (err) {
    Logger.log('Sheet save error: ' + err);
    return false;
  }
}
