// =============================================================================
// PSHS ZRC IT Job Request Form (ITJRF) Chatbot — Backend
// Google Apps Script + Google Sheets + Gemini API
// =============================================================================

// --- Configuration -----------------------------------------------------------

const SPREADSHEET_ID  = '1CDYLMBVKs2Ec1ufxFLi6Ed-SUU7faDWJkdrlt6TjQPE'; // TODO: paste your Google Sheet ID here
const KB_SHEET_NAME   = 'KB';
const ITJRF_SHEET_NAME = 'Tickets';
const GEMINI_MODEL    = 'gemini-2.5-flash-lite';
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`;

const RECOMMENDATION_TYPES = [
  'Hardware Repair',
  'Hardware Installation',
  'Network Connection',
  'Preventive Maintenance',
  'Software Development',
  'Software Modification',
  'Software Installation',
  'In-Campus Repair',
  'External Service Provider Repair',
  'Others, Repair',
];

// Form fields collected step-by-step when state === 'collecting'
const FORM_STEPS = [
  {
    key: 'name',
    prompt: 'What is your full name?',
  },
  {
    key: 'position',
    prompt: 'What is your position/designation?',
  },
  {
    key: 'supervisor',
    prompt: 'Who is your immediate supervisor?',
  },
  {
    key: 'description',
    prompt: 'Please describe the problem in detail.',
    // May be pre-filled from the chat — skipped if already set
    skippable: true,
  },
  {
    key: 'rec_type',
    prompt:
      'What type of recommendation applies? Reply with the number:\n\n' +
      RECOMMENDATION_TYPES.map((t, i) => `${i + 1}. ${t}`).join('\n'),
  },
];

// =============================================================================
// Entry Points
// =============================================================================

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) || '';
  if (page === 'dashboard') {
    return HtmlService.createHtmlOutputFromFile('Dashboard')
      .setTitle('PSHS ZRC IT Dashboard')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('PSHS ZRC IT Support Chatbot')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Receives POST from the chat UI.
 * Body: { message: string, session: object }
 * Returns: { reply: string, session: object }
 */
function doPost(e) {
  try {
    const params  = JSON.parse(e.postData.contents);
    const message = (params.message || '').trim();
    const session = params.session || {};

    if (!message) {
      return jsonResponse({ reply: 'Please type a message.', session });
    }

    // Route based on current session state
    let result;
    if (session.state === 'collecting') {
      result = handleFormStep(message, session);
    } else if (session.state === 'confirm') {
      result = handleConfirm(message, session);
    } else {
      result = handleChat(message, session);
    }

    return jsonResponse(result);
  } catch (err) {
    Logger.log('doPost error: ' + err + '\n' + err.stack);
    return jsonResponse({
      reply: 'Sorry, an unexpected error occurred. Please try again.',
      session: {},
    });
  }
}
function processChat(params) {
  const message = (params.message || '').trim();
  const session = params.session || {};

  if (!message) return { reply: 'Please type a message.', session };

  let result;
  if (session.state === 'collecting') {
    result = handleFormStep(message, session);
  } else if (session.state === 'confirm') {
    result = handleConfirm(message, session);
  } else {
    result = handleChat(message, session);
  }
  return result;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================================================
// Chat Mode — RAG + Gemini
// =============================================================================

/**
 * Main chat handler. Searches KB for context, then calls Gemini.
 * If Gemini signals intent to file a ticket, switches to collecting state.
 */
function handleChat(message, session) {
  // Keep a rolling conversation history for Gemini (max 10 turns)
  if (!session.history) session.history = [];

  // 1. RAG: fetch KB context relevant to the message
  const kbContext = searchKnowledgeBase(message);

  // 2. Call Gemini with history + KB context
  const geminiReply = callGemini(message, session.history, kbContext);

  // 3. Check if Gemini returned a ticket-filing signal
  //    Expected signal format (anywhere in reply): %%FILE_TICKET:<description>%%
  const ticketMatch = geminiReply.match(/%%FILE_TICKET:([\s\S]*?)%%/);

  if (ticketMatch) {
    // Strip the signal from the visible reply
    const visibleReply = geminiReply.replace(/%%FILE_TICKET:[\s\S]*?%%/, '').trim();
    const prefillDesc  = ticketMatch[1].trim();

    // Initialise form collection
    session.state    = 'collecting';
    session.step     = 0;
    session.formData = { description: prefillDesc };

    const firstPrompt = getNextPrompt(session);
    const combined    = (visibleReply ? visibleReply + '\n\n' : '') + firstPrompt;

    // Add the exchange to history
    session.history = appendHistory(session.history, message, combined);
    return { reply: combined, session };
  }

  // Normal reply
  session.history = appendHistory(session.history, message, geminiReply);
  return { reply: geminiReply, session };
}

// =============================================================================
// Form Collection State
// =============================================================================

/**
 * Advances through FORM_STEPS one answer at a time.
 */
function handleFormStep(message, session) {
  const step = FORM_STEPS[session.step];

  // Validate recommendation type (must be 1–10 or exact name)
  if (step.key === 'rec_type') {
    const resolved = resolveRecType(message);
    if (!resolved) {
      return {
        reply:
          'Please reply with a number (1–10) or the exact recommendation type name.\n\n' +
          RECOMMENDATION_TYPES.map((t, i) => `${i + 1}. ${t}`).join('\n'),
        session,
      };
    }
    session.formData[step.key] = resolved;
  } else {
    session.formData[step.key] = message;
  }

  session.step++;

  // Skip steps that are already pre-filled (e.g. description from chat)
  while (
    session.step < FORM_STEPS.length &&
    FORM_STEPS[session.step].skippable &&
    session.formData[FORM_STEPS[session.step].key]
  ) {
    session.step++;
  }

  if (session.step < FORM_STEPS.length) {
    return { reply: getNextPrompt(session), session };
  }

  // All fields collected — show confirmation
  session.state = 'confirm';
  return { reply: buildConfirmationMessage(session.formData), session };
}

/**
 * Returns the prompt for the current step.
 */
function getNextPrompt(session) {
  // Skip already-filled skippable steps
  while (
    session.step < FORM_STEPS.length &&
    FORM_STEPS[session.step].skippable &&
    session.formData[FORM_STEPS[session.step].key]
  ) {
    session.step++;
  }
  if (session.step >= FORM_STEPS.length) return null;
  return FORM_STEPS[session.step].prompt;
}

/**
 * Handles the yes/no confirmation before saving the ticket.
 */
function handleConfirm(message, session) {
  const lower = message.toLowerCase().trim();

  if (lower === 'yes' || lower === 'y' || lower === 'confirm') {
    const saved = saveTicket(session.formData);
    const jrfNo = session.formData._jrfNo || '—';
    const reply = saved
      ? `Your IT Job Request has been submitted!\n\nJRF #: ${jrfNo}\n\nOur IT staff will get back to you shortly. Is there anything else I can help you with?`
      : 'There was a problem saving your request. Please contact IT directly or try again.';
    return { reply, session: { history: session.history } }; // reset form state
  }

  if (lower === 'no' || lower === 'n' || lower === 'cancel') {
    return {
      reply: 'No problem — your request was not submitted. Would you like to start over or is there anything else I can help you with?',
      session: { history: session.history },
    };
  }

  // Unrecognised — re-ask
  return {
    reply: 'Please reply with "yes" to submit or "no" to cancel.\n\n' +
      buildConfirmationMessage(session.formData),
    session,
  };
}

function buildConfirmationMessage(data) {
  return (
    'Please confirm your IT Job Request before submitting:\n\n' +
    `Name:                ${data.name || '—'}\n` +
    `Position:            ${data.position || '—'}\n` +
    `Supervisor:          ${data.supervisor || '—'}\n` +
    `Problem Description: ${data.description || '—'}\n` +
    `Recommendation Type: ${data.rec_type || '—'}\n\n` +
    'Reply "yes" to submit or "no" to cancel.'
  );
}

// =============================================================================
// searchKnowledgeBase()
// =============================================================================

/**
 * Searches the KB sheet for entries whose Issue/Keywords match the query.
 * Returns a formatted string of up to 3 best-matching entries, or null if none.
 *
 * Sheet columns (row 1 = header):
 *   A: Issue  |  B: Solution  |  C: Category  |  D: Keywords (optional, comma-separated)
 */
function searchKnowledgeBase(query) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(KB_SHEET_NAME);
    if (!sheet) return null;

    const data    = sheet.getDataRange().getValues();
    const words   = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const matches = [];

    for (let i = 1; i < data.length; i++) {
      const issue    = String(data[i][0] || '').toLowerCase();
      const solution = String(data[i][1] || '');
      const category = String(data[i][2] || '');
      const keywords = String(data[i][3] || '').toLowerCase();
      const haystack = `${issue} ${keywords}`;

      const score = words.reduce((acc, w) => acc + (haystack.includes(w) ? 1 : 0), 0);
      if (score > 0) {
        matches.push({ score, issue: data[i][0], solution, category });
      }
    }

    if (matches.length === 0) return null;

    matches.sort((a, b) => b.score - a.score);
    const top = matches.slice(0, 3);

    return top
      .map(m => `[${m.category}] ${m.issue}\n→ ${m.solution}`)
      .join('\n\n');
  } catch (err) {
    Logger.log('searchKnowledgeBase error: ' + err);
    return null;
  }
}

// =============================================================================
// callGemini()
// =============================================================================

/**
 * Calls the Gemini API with the user message, conversation history, and KB context.
 *
 * @param {string}   message    - Latest user message
 * @param {Array}    history    - [{role, text}, ...] prior turns (max 10)
 * @param {string|null} kbContext - Pre-formatted KB entries, or null
 * @returns {string} Gemini's reply text
 */
function callGemini(message, history, kbContext) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    Logger.log('GEMINI_API_KEY not set in Script Properties.');
    return 'I\'m having trouble reaching the AI service. Please contact IT directly.';
  }

  // --- System instruction ---
  const systemText =
    'You are the IT Support Chatbot for PSHS Zamboanga Regional Campus (PSHS ZRC). ' +
    'You help staff troubleshoot IT issues and file IT Job Request Forms (ITJRF).\n\n' +

    'Behavior rules:\n' +
    '1. Be concise, professional, and friendly.\n' +
    '2. When answering technical questions, use the Knowledge Base entries provided.\n' +
    '3. If no KB entry is relevant, use your own knowledge to help troubleshoot.\n' +
    '4. If the user wants to file an IT Job Request (or the issue clearly requires one), ' +
       'end your reply with the exact signal: %%FILE_TICKET:<one-sentence summary of the problem>%% ' +
       '— do not mention this signal to the user in the visible part of your reply.\n' +
    '5. Do not make up ticket numbers or form details.\n' +
    '6. You handle IT support AND information/publication requests (graphic design, pubmat, social media posting, certificates) since the IT unit also serves as the designated Information Officers of PSHS ZRC. Accept and assist with these requests. Publication and design requests should use "Others, Repair" as the recommendation type.\n\n' +

    'ITJRF Recommendation Types (for reference):\n' +
    RECOMMENDATION_TYPES.map((t, i) => `${i + 1}. ${t}`).join('\n');

  // --- Build contents array ---
  // v1 does not support system_instruction; inject it as the first turn instead
  const contents = [
    { role: 'user',  parts: [{ text: systemText }] },
    { role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] },
  ];

  // Prior history (oldest first, max 10 turns = 20 messages)
  const recent = history.slice(-10);
  for (const turn of recent) {
    contents.push({ role: turn.role, parts: [{ text: turn.text }] });
  }

  // Inject KB context as a user message just before the live query
  let userText = message;
  if (kbContext) {
    userText =
      `[Relevant Knowledge Base entries for context — use these to inform your answer:]\n${kbContext}\n\n[User message:]\n${message}`;
  }
  contents.push({ role: 'user', parts: [{ text: userText }] });

  // --- API request ---
  const payload = {
    contents,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 768,
    },
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, options);
    const code     = response.getResponseCode();
    const body     = JSON.parse(response.getContentText());

    if (code !== 200) {
      Logger.log(`Gemini API error ${code}: ` + response.getContentText());
      return 'I\'m having trouble thinking right now. Please try again in a moment.';
    }

    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      Logger.log('Gemini returned no text: ' + JSON.stringify(body));
      return 'I didn\'t get a response. Please try rephrasing your message.';
    }

    return text.trim();
  } catch (err) {
    Logger.log('callGemini fetch error: ' + err);
    return 'I couldn\'t connect to the AI service. Please try again later.';
  }
}

// =============================================================================
// saveTicket()
// =============================================================================

/**
 * Writes one row to the ITJRF sheet.
 * Creates the sheet with headers if it doesn't exist.
 *
 * ITJRF columns:
 *   JRF #  |  Date  |  Name  |  Position  |  Supervisor  |  Problem Description
 *   Recommendation Type  |  Status  |  Assigned Staff  |  Date Completed
 *
 * @param {object} data - formData collected during form flow
 * @returns {boolean} true on success
 */
function saveTicket(data) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(ITJRF_SHEET_NAME);

    // Create sheet + header row if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(ITJRF_SHEET_NAME);
      sheet.appendRow([
        'JRF #',
        'Date',
        'Name',
        'Position',
        'Supervisor',
        'Problem Description',
        'Recommendation Type',
        'Status',
        'Assigned Staff',
        'Date Completed',
      ]);
      sheet.setFrozenRows(1);
    }

    // Auto-increment JRF number: count existing data rows + 1
    const lastRow = sheet.getLastRow();          // includes header
    const jrfNo   = lastRow;                     // row 1 = header → first ticket = 1
    const jrfStr  = String(jrfNo).padStart(4, '0'); // e.g. "0001"

    // Store jrfNo back so the confirm message can display it
    data._jrfNo = jrfStr;

    const today = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );

    sheet.appendRow([
      jrfStr,
      today,
      data.name        || '',
      data.position    || '',
      data.supervisor  || '',
      data.description || '',
      data.rec_type    || '',
      'Pending',         // default Status
      '',                // Assigned Staff — filled by IT staff later
      '',                // Date Completed — filled by IT staff later
    ]);

    Logger.log(`Ticket saved: JRF #${jrfStr}`);
    return true;
  } catch (err) {
    Logger.log('saveTicket error: ' + err + '\n' + err.stack);
    return false;
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Resolves a user's recommendation type answer (number 1-10 or text) to the
 * canonical name from RECOMMENDATION_TYPES.
 */
function resolveRecType(answer) {
  const trimmed = answer.trim();

  // Numeric selection
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num >= 1 && num <= RECOMMENDATION_TYPES.length) {
    return RECOMMENDATION_TYPES[num - 1];
  }

  // Partial text match (case-insensitive)
  const lower = trimmed.toLowerCase();
  const found = RECOMMENDATION_TYPES.find(t => t.toLowerCase().includes(lower));
  return found || null;
}

/**
 * Appends a user/model turn pair to history, capped at 20 messages (10 turns).
 */
function appendHistory(history, userText, modelText) {
  const updated = [
    ...history,
    { role: 'user',  text: userText  },
    { role: 'model', text: modelText },
  ];
  // Keep the last 20 messages
  return updated.slice(-20);
}

// =============================================================================
// Dashboard Functions
// =============================================================================

/**
 * Returns all tickets from the Tickets sheet as an array of objects.
 */
function getTickets() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ITJRF_SHEET_NAME);
  if (!sheet) return [];

  const data    = sheet.getDataRange().getValues();
  const tickets = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    tickets.push({
      jrfNo:      String(data[i][0]),
      date:       data[i][1] ? Utilities.formatDate(new Date(data[i][1]), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
      name:       data[i][2],
      position:   data[i][3],
      supervisor: data[i][4],
      problem:    data[i][5],
      recType:    data[i][6],
      status:     data[i][7],
    });
  }
  return tickets;
}

/**
 * Marks a ticket as Completed and sets the Date Completed column.
 */
function updateTicketStatus(jrfNo) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ITJRF_SHEET_NAME);
  if (!sheet) return false;

  const data  = sheet.getDataRange().getValues();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(jrfNo)) {
      sheet.getRange(i + 1, 8).setValue('Completed'); // Column H — Status
      sheet.getRange(i + 1, 10).setValue(today);       // Column J — Date Completed
      return true;
    }
  }
  return false;
}

/**
 * Copies the Template tab, fills in ticket data, exports as A4 PDF (base64).
 */
function generateFormPdf(jrfNo) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ITJRF_SHEET_NAME);
  if (!sheet) throw new Error('Tickets sheet not found');

  // Find ticket row
  const data = sheet.getDataRange().getValues();
  let row    = null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(jrfNo)) { row = data[i]; break; }
  }
  if (!row) throw new Error('Ticket not found: ' + jrfNo);

  const ticket = {
    jrfNumber:      row[0],
    date:           row[1] ? Utilities.formatDate(new Date(row[1]), Session.getScriptTimeZone(), 'MM/dd/yyyy') : '',
    name:           row[2],
    position:       row[3],
    supervisor:     row[4],
    problem:        row[5],
    recommendation: row[6],
  };

  // Copy Template tab
  const template = ss.getSheetByName('Template');
  if (!template) throw new Error('Template sheet not found');

  const tempName = 'PDF_' + jrfNo;
  const existing = ss.getSheetByName(tempName);
  if (existing) ss.deleteSheet(existing);

  const temp = template.copyTo(ss);
  temp.setName(tempName);

  // Write ticket values (cell map from CLAUDE.md)
  temp.getRange('M6').setValue(ticket.jrfNumber);
  temp.getRange('F6').setValue(ticket.name);
  temp.getRange('F7').setValue(ticket.position);
  temp.getRange('F9').setValue(ticket.supervisor);
  temp.getRange('M8').setValue(ticket.date);
  temp.getRange('C11').setValue(ticket.problem);

  // Recommendation type checkboxes
  const checkboxMap = {
    'Hardware Repair':              'D23',
    'Hardware Installation':        'G23',
    'Network Connection':           'K23',
    'Preventive Maintenance':       'P23',
    'Software Development':         'D24',
    'Software Modification':        'G24',
    'Software Installation':        'K24',
    'Others, Repair':               'P24',
    'In-Campus Repair':             'G21',
    'External Service Provider Repair': 'K21',
  };
  const checkCell = checkboxMap[ticket.recommendation];
  if (checkCell) temp.getRange(checkCell).setValue('✓');

  SpreadsheetApp.flush();

  // Export as A4 PDF
  const exportUrl =
    'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/export' +
    '?format=pdf&gid=' + temp.getSheetId() +
    '&size=A4&portrait=true&fitw=true' +
    '&gridlines=false&printtitle=false&sheetnames=false' +
    '&top_margin=0.25&bottom_margin=0.25&left_margin=0.25&right_margin=0.25';

  const token    = ScriptApp.getOAuthToken();
  const response = UrlFetchApp.fetch(exportUrl, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });

  const base64 = Utilities.base64Encode(response.getBlob().getBytes());

  // Clean up temp sheet
  ss.deleteSheet(temp);

  return base64;
}
