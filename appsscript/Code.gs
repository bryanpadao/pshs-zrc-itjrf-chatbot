// =============================================================================
// PSHS ZRC IT Job Request Form (ITJRF) Chatbot — Backend
// Google Apps Script + Google Sheets + Gemini API
// =============================================================================

// --- Configuration -----------------------------------------------------------

const SPREADSHEET_ID  = '1CDYLMBVKs2Ec1ufxFLi6Ed-SUU7faDWJkdrlt6TjQPE'; // TODO: paste your Google Sheet ID here
const KB_SHEET_NAME   = 'KnowledgeBase';
const ITJRF_SHEET_NAME = 'Tickets';
const GEMINI_MODEL    = 'gemini-2.5-flash-lite';
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`;
const APPROVALS_SHEET_NAME = 'Approvals';

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
    key: 'department',
    prompt: 'What department or office are you under?',
  },
  {
    key: 'supervisor',
    prompt: 'Who is your immediate supervisor?',
    // Skipped if auto-filled from the Departments sheet lookup
    skippable: true,
  },
  {
    key: 'description',
    prompt: 'Please describe the problem in detail.',
    // May be pre-filled from the chat — skipped if already set
    skippable: true,
  },
];

// =============================================================================
// Entry Points
// =============================================================================

function doGet(e) {
  // Handle email approval links: ?token=XXX&action=approve|reject
  const token  = e && e.parameter && e.parameter.token;
  const action = e && e.parameter && e.parameter.action;
  if (token && action) return handleApproval(token, action);

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
    // Return as separate replies so the UI renders two distinct bubbles
    const replies = [visibleReply, firstPrompt].filter(Boolean);
    return { reply: combined, replies, session };
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
  } else if (step.key === 'department') {
    session.formData[step.key] = message;
    // Auto-fill supervisor from Departments sheet
    const lookup = lookupDepartment(message);
    if (lookup && lookup.supervisorName) {
      session.formData.supervisor      = lookup.supervisorName;
      session.formData.supervisorEmail = lookup.supervisorEmail;
    }
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
      ? `Your IT Job Request has been submitted!\n\nJRF #: ${jrfNo}\n\nOur IT staff will get back to you shortly.`
      : 'There was a problem saving your request. Please contact IT directly or try again.';
    return { reply, session: {}, submitted: saved }; // full reset; submitted flag tells UI to lock the chat
  }

  if (lower === 'no' || lower === 'n' || lower === 'cancel') {
    return {
      reply: 'No problem — your request was not submitted. Would you like to start over or is there anything else I can help you with?',
      session: {}, // full reset
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
    `Department/Office:   ${data.department || '—'}\n` +
    `Supervisor:          ${data.supervisor || '—'}\n` +
    `Problem Description: ${data.description || '—'}\n\n` +
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
    '6. You handle IT support AND information/publication requests (graphic design, pubmat, social media posting, certificates) since the IT unit also serves as the designated Information Officers of PSHS ZRC. Accept and assist with these requests. Publication and design requests should use "Others, Repair" as the recommendation type.\n' +
    '7. This chatbot does NOT support file uploads or attachments. If a user mentions attaching or uploading files, politely inform them that files cannot be submitted here and ask them to describe their request in text instead.\n\n' +

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
        'Assessment',
        'Action Taken',
        'Task Result',
        'Target Date',
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
      '',                // Recommendation Type — filled by IT staff during assessment
      'Pending Supervisor Approval', // default Status
      '',                // Assigned Staff — filled by IT staff later
      '',                // Date Completed — filled by IT staff later
      '',                // Assessment — filled by IT staff later
      '',                // Action Taken — filled by IT staff later
      '',                // Task Result — filled by IT staff later
      '',                // Target Date — filled by IT staff later
    ]);

    // Send supervisor approval email
    try {
      sendApprovalEmail('supervisor', jrfStr, {
        name:            data.name             || '',
        position:        data.position         || '',
        department:      data.department       || '',
        supervisor:      data.supervisor       || '',
        supervisorEmail: data.supervisorEmail  || null,
        problem:         data.description      || '',
        date:            today,
      });
    } catch (emailErr) {
      Logger.log('Supervisor approval email error: ' + emailErr);
    }

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
      jrfNo:         String(data[i][0]),
      date:          data[i][1] ? Utilities.formatDate(new Date(data[i][1]), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
      name:          data[i][2],
      position:      data[i][3],
      supervisor:    data[i][4],
      problem:       data[i][5],
      recType:       data[i][6],
      status:        data[i][7],
      assignedStaff: data[i][8]  || '',
      assessment:    data[i][10] || '',
      actionTaken:        data[i][11] || '',
      taskResult:         data[i][12] || '',
      targetDate:         data[i][13] ? Utilities.formatDate(new Date(data[i][13]), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
      othersDescription:  data[i][14] || '',
    });
  }
  return tickets;
}

/**
 * Marks an In Progress ticket as Completed. Writes Action Taken and Task Result.
 * Assessment and Target Date are set earlier by submitAssessment().
 * Returns { ok: true } or { ok: false, error: string }.
 */
function updateTicketStatus(jrfNo, actionTaken, taskResult) {
  if (!actionTaken || !actionTaken.trim()) {
    return { ok: false, error: 'Action Taken is required before marking as Completed.' };
  }
  if (!taskResult) {
    return { ok: false, error: 'Task Result (Successful / Failed) is required.' };
  }

  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ITJRF_SHEET_NAME);
  if (!sheet) return { ok: false, error: 'Tickets sheet not found.' };

  const data  = sheet.getDataRange().getValues();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(jrfNo)) {
      if (String(data[i][7]) !== 'In Progress') {
        return { ok: false, error: 'Ticket must be In Progress to mark as Completed.' };
      }
      sheet.getRange(i + 1, 8).setValue('Completed');          // H — Status
      sheet.getRange(i + 1, 10).setValue(today);               // J — Date Completed
      sheet.getRange(i + 1, 12).setValue(actionTaken.trim());  // L — Action Taken
      sheet.getRange(i + 1, 13).setValue(taskResult);          // M — Task Result
      return { ok: true };
    }
  }
  return { ok: false, error: 'Ticket not found: ' + jrfNo };
}

/**
 * Submits IT assessment for a ticket and sends director approval email.
 * Called from Dashboard when IT staff submits the Assess modal.
 */
function submitAssessment(jrfNo, assignedStaff, recommendation, assessment, targetDate, othersDescription) {
  if (!assessment || !assessment.trim()) {
    return { ok: false, error: 'Assessment is required.' };
  }
  if (!recommendation) {
    return { ok: false, error: 'Recommendation Type is required.' };
  }

  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ITJRF_SHEET_NAME);
  if (!sheet) return { ok: false, error: 'Tickets sheet not found.' };

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(jrfNo)) {
      sheet.getRange(i + 1, 7).setValue(recommendation);              // G — Recommendation Type
      sheet.getRange(i + 1, 8).setValue('Pending Director Approval'); // H — Status
      sheet.getRange(i + 1, 9).setValue(assignedStaff || '');         // I — Assigned Staff
      sheet.getRange(i + 1, 11).setValue(assessment.trim());          // K — Assessment
      sheet.getRange(i + 1, 14).setValue(targetDate || '');           // N — Target Date
      sheet.getRange(i + 1, 15).setValue(othersDescription || '');   // O — Others Description

      try {
        sendApprovalEmail('director', jrfNo, {
          name:           data[i][2],
          position:       data[i][3],
          supervisor:     data[i][4],
          problem:        data[i][5],
          recommendation: recommendation,
          assignedStaff:  assignedStaff || '',
          assessment:     assessment.trim(),
          targetDate:     targetDate || '',
        });
      } catch (emailErr) {
        Logger.log('Director approval email error: ' + emailErr);
      }

      return { ok: true };
    }
  }
  return { ok: false, error: 'Ticket not found: ' + jrfNo };
}

/**
 * Handles email approval link clicks (?token=XXX&action=approve|reject).
 * Returns an HTML confirmation page.
 */
function handleApproval(token, action) {
  try {
    const ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
    const aSheet = ss.getSheetByName(APPROVALS_SHEET_NAME);
    if (!aSheet) return approvalHtmlPage('Error', 'Approval system not initialised.');

    const data = aSheet.getDataRange().getValues();
    let approvalRow = null, rowIdx = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === token) { approvalRow = data[i]; rowIdx = i + 1; break; }
    }
    if (!approvalRow) return approvalHtmlPage('Invalid Link', 'This approval link is invalid or has expired. Please contact the IT Unit if you believe this is an error.');
    if (approvalRow[3]) {
      const wasApproved = String(approvalRow[3]).startsWith('approve');
      return approvalHtmlPage(
        wasApproved ? 'Already Approved' : 'Already Rejected',
        'You have already ' + (wasApproved ? 'approved' : 'rejected') + ' this request. No further action is needed.'
      );
    }

    const jrfNo = String(approvalRow[1]);
    const type  = approvalRow[2]; // 'supervisor' or 'director'

    // Mark token as used
    aSheet.getRange(rowIdx, 4).setValue(action + ' ' + new Date().toISOString());

    // Find ticket row
    const tSheet = ss.getSheetByName(ITJRF_SHEET_NAME);
    const tData  = tSheet.getDataRange().getValues();
    let tRowIdx = -1, ticketRow = null;
    for (let i = 1; i < tData.length; i++) {
      if (String(tData[i][0]) === jrfNo) { tRowIdx = i + 1; ticketRow = tData[i]; break; }
    }
    if (!ticketRow) return approvalHtmlPage('Error', 'Ticket not found: ' + jrfNo);

    if (action === 'approve') {
      const newStatus = type === 'supervisor' ? 'Pending IT Assessment' : 'In Progress';
      tSheet.getRange(tRowIdx, 8).setValue(newStatus);

      // Notify IT staff
      const itEmail = PropertiesService.getScriptProperties().getProperty('IT_STAFF_EMAIL');
      if (itEmail) {
        const subject = type === 'supervisor'
          ? 'ITJRF ' + jrfNo + ': Supervisor Approved — Please Submit Assessment'
          : 'ITJRF ' + jrfNo + ': Director Approved — Proceed with Repair';
        const body = type === 'supervisor'
          ? 'Ticket ' + jrfNo + ' has been approved by the supervisor.\n\nRequester: ' + ticketRow[2] + '\nProblem: ' + ticketRow[5] + '\n\nPlease open the IT Dashboard to assign staff and submit your assessment.'
          : 'Ticket ' + jrfNo + ' has been approved by the Campus Director.\n\nRequester: ' + ticketRow[2] + '\nProblem: ' + ticketRow[5] + '\n\nPlease open the IT Dashboard to begin work and mark the ticket as Completed when done.';
        MailApp.sendEmail(itEmail, subject, body);
      }

      return approvalHtmlPage(
        'Thank You for Approving',
        'Your approval for ticket <strong>' + jrfNo + '</strong> has been recorded. The IT unit has been notified and will proceed accordingly.'
      );
    } else {
      tSheet.getRange(tRowIdx, 8).setValue('Rejected');
      return approvalHtmlPage(
        'Request Rejected',
        'Thank you for your response. Ticket <strong>' + jrfNo + '</strong> has been marked as rejected and the IT unit has been informed.'
      );
    }
  } catch (err) {
    Logger.log('handleApproval error: ' + err);
    return approvalHtmlPage('Error', 'An unexpected error occurred. Please try again.');
  }
}

/**
 * Sends a supervisor or director approval email with one-time approve/reject links.
 * Stores the token in the Approvals sheet.
 */
function sendApprovalEmail(type, jrfNo, ticket) {
  const webAppUrl = PropertiesService.getScriptProperties().getProperty('WEBAPP_URL');
  if (!webAppUrl) { Logger.log('WEBAPP_URL not set in Script Properties'); return; }

  // Generate token and store in Approvals sheet
  const token  = Utilities.getUuid();
  const ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  let aSheet   = ss.getSheetByName(APPROVALS_SHEET_NAME);
  if (!aSheet) {
    aSheet = ss.insertSheet(APPROVALS_SHEET_NAME);
    aSheet.appendRow(['Token', 'JRF#', 'Type', 'Used']);
    aSheet.setFrozenRows(1);
  }
  aSheet.appendRow([token, jrfNo, type, '']);

  // Determine recipient
  let recipientEmail, recipientName;
  if (type === 'supervisor') {
    // Use direct email from Departments lookup first; fall back to Staff sheet name lookup
    recipientEmail = ticket.supervisorEmail || getStaffEmail(ticket.supervisor);
    recipientName  = ticket.supervisor || 'Supervisor';
  } else {
    recipientEmail = PropertiesService.getScriptProperties().getProperty('DIRECTOR_EMAIL');
    recipientName  = 'Campus Director';
  }

  if (!recipientEmail) {
    Logger.log('sendApprovalEmail: no email found for ' + (type === 'supervisor' ? ticket.supervisor : 'Campus Director'));
    return;
  }

  const approveUrl = webAppUrl + '?token=' + token + '&action=approve';
  const rejectUrl  = webAppUrl + '?token=' + token + '&action=reject';
  const subject    = '[ITJRF ' + jrfNo + '] Approval Required — ' + ticket.name;

  const divider = '\n' + '─'.repeat(48) + '\n';

  const body = type === 'supervisor'
    ? 'Dear ' + recipientName + ',\n\n' +
      'A staff member under your supervision has submitted an IT Job Request Form that requires your approval.\n' +
      divider +
      'JRF #:          ' + jrfNo                + '\n' +
      'Date Submitted: ' + ticket.date           + '\n' +
      'Name:           ' + ticket.name           + '\n' +
      'Position:       ' + ticket.position       + '\n' +
      'Department:     ' + (ticket.department || '—') + '\n' +
      divider +
      'PROBLEM DESCRIPTION\n' +
      ticket.problem + '\n' +
      divider +
      'Recommendation Type: ' + ticket.recommendation + '\n' +
      divider +
      'Please click one of the links below to respond:\n\n' +
      '  ✅ APPROVE:  ' + approveUrl + '\n\n' +
      '  ❌ REJECT:   ' + rejectUrl  + '\n\n' +
      'Each link can only be used once. If you did not expect this email, please contact the IT Unit.\n\n' +
      'PSHS ZRC IT Unit'
    : 'Dear ' + recipientName + ',\n\n' +
      'The IT Unit has completed its technical assessment for the following IT Job Request and is requesting your approval to proceed with the service.\n' +
      divider +
      'JRF #:          ' + jrfNo                          + '\n' +
      'Requester:      ' + ticket.name + ' (' + ticket.position + ')\n' +
      'Assigned Staff: ' + (ticket.assignedStaff || 'TBA') + '\n' +
      'Target Date:    ' + (ticket.targetDate    || 'TBA') + '\n' +
      divider +
      'PROBLEM DESCRIPTION\n' +
      ticket.problem + '\n' +
      divider +
      'TECHNICAL ASSESSMENT\n' +
      (ticket.assessment || '—') + '\n' +
      divider +
      'Recommendation Type: ' + ticket.recommendation + '\n' +
      divider +
      'Please click one of the links below to respond:\n\n' +
      '  ✅ APPROVE:  ' + approveUrl + '\n\n' +
      '  ❌ REJECT:   ' + rejectUrl  + '\n\n' +
      'Each link can only be used once. If you did not expect this email, please contact the IT Unit.\n\n' +
      'PSHS ZRC IT Unit';

  MailApp.sendEmail(recipientEmail, subject, body);
  Logger.log('Approval email sent (' + type + ') to ' + recipientEmail + ' for JRF ' + jrfNo);
}

/**
 * Looks up a staff member's email from the Staff sheet (columns: Name | Email).
 */
function getStaffEmail(name) {
  if (!name) return null;
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Staff');
    if (!sheet) return null;
    const data  = sheet.getDataRange().getValues();
    const lower = String(name).toLowerCase().trim();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase().trim() === lower) return data[i][1] || null;
    }
    return null;
  } catch (err) {
    Logger.log('getStaffEmail error: ' + err);
    return null;
  }
}

/**
 * Looks up a department/office in the Departments sheet.
 * Returns { supervisorName, supervisorEmail } or null if not found.
 *
 * Sheet columns: A = Department/Office | B = Supervisor Name | C = Supervisor Email
 */
function lookupDepartment(dept) {
  if (!dept) return null;
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Departments');
    if (!sheet) return null;
    const data  = sheet.getDataRange().getValues();
    const lower = String(dept).toLowerCase().trim();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase().trim() === lower) {
        return {
          supervisorName:  String(data[i][1] || ''),
          supervisorEmail: String(data[i][2] || ''),
        };
      }
    }
    return null;
  } catch (err) {
    Logger.log('lookupDepartment error: ' + err);
    return null;
  }
}

/**
 * Returns a simple styled HTML page for approval responses.
 */
function approvalHtmlPage(title, message) {
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<title>' + title + ' — PSHS ZRC IT</title>' +
    '<style>*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Arial,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh;}' +
    '.box{background:#fff;padding:40px 48px;border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,.1);text-align:center;max-width:440px;}' +
    'h2{color:#1a3c6e;font-size:20px;margin-bottom:14px;}p{color:#555;font-size:14px;line-height:1.6;}' +
    '.logo{font-size:11px;color:#aaa;margin-top:22px;}</style></head>' +
    '<body><div class="box"><h2>' + title + '</h2><p>' + message + '</p>' +
    '<p class="logo">PSHS ZRC IT Unit</p></div></body></html>'
  ).setTitle(title + ' — PSHS ZRC IT');
}

/**
 * Updates requester details (Name, Position, Supervisor, Problem) for a ticket.
 * Used by IT staff to correct typos entered during the chatbot flow.
 */
function updateTicketDetails(jrfNo, name, position, supervisor, problem) {
  if (!name || !name.trim()) return { ok: false, error: 'Name is required.' };

  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ITJRF_SHEET_NAME);
  if (!sheet) return { ok: false, error: 'Tickets sheet not found.' };

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(jrfNo)) {
      sheet.getRange(i + 1, 3).setValue(name.trim());            // C — Name
      sheet.getRange(i + 1, 4).setValue((position   || '').trim()); // D — Position
      sheet.getRange(i + 1, 5).setValue((supervisor || '').trim()); // E — Supervisor
      sheet.getRange(i + 1, 6).setValue((problem    || '').trim()); // F — Problem
      return { ok: true };
    }
  }
  return { ok: false, error: 'Ticket not found: ' + jrfNo };
}

/**
 * Assigns a staff member to a ticket (updates Assigned Staff column only).
 */
function assignStaff(jrfNo, staffName) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ITJRF_SHEET_NAME);
  if (!sheet) return false;

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(jrfNo)) {
      sheet.getRange(i + 1, 9).setValue(staffName); // I — Assigned Staff
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
    assignedStaff:  row[8]  || '',
    dateCompleted:  row[9]  ? Utilities.formatDate(new Date(row[9]),  Session.getScriptTimeZone(), 'MM/dd/yyyy') : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy'),
    assessment:     row[10] || '',
    actionTaken:    row[11] || '',
    taskResult:         row[12] || '',
    targetDate:         row[13] ? Utilities.formatDate(new Date(row[13]), Session.getScriptTimeZone(), 'MM/dd/yyyy') : '',
    othersDescription:  row[14] || '',
  };

  // Copy Template tab
  const template = ss.getSheetByName('Template');
  if (!template) throw new Error('Template sheet not found');

  const tempName = 'PDF_' + jrfNo;
  const existing = ss.getSheetByName(tempName);
  if (existing) ss.deleteSheet(existing);

  const temp = template.copyTo(ss);
  temp.setName(tempName);

  // Helper: write short value — centered horizontally and vertically
  function writeCell(range, value, bold) {
    const r = temp.getRange(range);
    r.setValue(value);
    r.setHorizontalAlignment('center');
    r.setVerticalAlignment('middle');
    if (bold) r.setFontWeight('bold');
  }

  // Helper: split text into lines of at most charsPerLine characters at word boundaries.
  function wordWrapLines(text, charsPerLine) {
    const words = String(text || '').split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? current + ' ' + word : word;
      if (candidate.length <= charsPerLine) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [''];
  }

  // Helper: break a multi-row merged block into individual per-row merges,
  // then write one pre-wrapped line per row with NO auto-expand wrap.
  function writeTextBlock(colStart, colEnd, rowStart, numRows, value) {
    // 1. Break the existing vertical merge
    temp.getRange(colStart + rowStart + ':' + colEnd + (rowStart + numRows - 1)).breakApart();

    // 2. Pre-wrap: split on newlines first, then word-wrap each segment at ~80 chars
    const allLines = [];
    for (const seg of String(value || '').split('\n')) {
      allLines.push(...wordWrapLines(seg, 120));
    }

    for (let i = 0; i < numRows; i++) {
      const row      = rowStart + i;
      const rowRange = temp.getRange(colStart + row + ':' + colEnd + row);
      // 3. Merge this single row horizontally
      rowRange.mergeAcross();
      // 4. Write one pre-wrapped line (no cell-level wrapping needed)
      rowRange.setValue(i < allLines.length ? allLines[i] : '');
      rowRange.setWrap(false);
      rowRange.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
      rowRange.setHorizontalAlignment('left');
      rowRange.setVerticalAlignment('middle');
      // 5. Lock the row height — CLIP prevents Sheets from auto-expanding
      temp.setRowHeight(row, 21);
    }
  }

  // Write ticket values — top-left cell of each merged range
  writeCell('O6',  ticket.jrfNumber);                        // JRF #:      O6:Q7
  writeCell('E6',  ticket.name,           true);            // Name:       E6:L6       bold
  writeCell('E7',  ticket.position);                        // Position:   E7:L7
  writeCell('E8',  ticket.supervisor,     true);            // Supervisor: E8:L8       bold
  writeCell('O8',  ticket.date);                            // Date:       O8:Q9
  writeTextBlock('E', 'Q', 10, 5, ticket.problem);          // Problem:    E10:Q14 (5 rows)
  writeTextBlock('E', 'Q', 15, 5, ticket.assessment);       // Assessment: E15:Q19 (5 rows)
  writeTextBlock('E', 'Q', 30, 4, ticket.actionTaken);      // Action Taken: E30:Q33 (4 rows)
  writeCell('B28', ticket.assignedStaff,  true);            // Assigned Staff: B28:F28 bold
  writeCell('H28', ticket.targetDate);                      // Target Date:    H28:L28
  writeCell('N28', 'Edman H. Gallamaso',  true);            // Campus Director: N28:Q28 bold
  writeCell('B39', ticket.dateCompleted);                   // Date Completed: B39:E39 (auto)
  writeCell('G39', ticket.assignedStaff,  true);            // Serviced By:    G39:K39 bold
  writeCell('M39', ticket.name,           true);            // Confirmed By:   M39:Q39 bold
  // Others, Repair description → P25:Q25
  if (ticket.recommendation === 'Others, Repair' && ticket.othersDescription) {
    writeCell('P25', ticket.othersDescription);
  }

  // Task result checkboxes
  if (ticket.taskResult === 'Successful') writeCell('F35', '✓'); // Task Successful: F35
  if (ticket.taskResult === 'Failed')     writeCell('L35', '✓'); // Task Failed:     L35

  // Recommendation type checkboxes
  const checkboxMap = {
    'Hardware Repair':                  'C23',
    'Hardware Installation':            'F23',
    'Network Connection':               'J23',
    'Preventive Maintenance':           'O23',
    'Software Development':             'C24',
    'Software Modification':            'F24',
    'Software Installation':            'J24',
    'Others, Repair':                   'O24',
    'In-Campus Repair':                 'F21',
    'External Service Provider Repair': 'J21',
  };
  const checkCell = checkboxMap[ticket.recommendation];
  if (checkCell) {
    const r = temp.getRange(checkCell);
    r.setValue('✓');
    r.setHorizontalAlignment('center');
    r.setVerticalAlignment('middle');
  }

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


/**
 * DEBUG: Writes labelled test values into every mapped cell of the Template sheet.
 * Run this once from the Apps Script editor, then open the Template tab in the
 * spreadsheet and visually confirm each label lands in the right place.
 * Delete or ignore the test values afterwards — they are written directly to Template,
 * not to a copy, so just undo or clear manually after checking.
 */
function debugTemplateMap() {
  const ss       = SpreadsheetApp.openById(SPREADSHEET_ID);
  const template = ss.getSheetByName('Template');
  if (!template) { Logger.log('Template sheet not found'); return; }

  const writes = {
    'O6':  '[JRF#] O6',
    'E6':  '[Name] E6',
    'E7':  '[Position] E7',
    'E8':  '[Supervisor] E8',
    'O8':  '[Date] O8',
    'E10': '[Problem] E10',
    'E15': '[Assessment] E15',
    'E30': '[Action Taken] E30',
    'B28': '[Assigned Staff] B28',
    'H28': '[Target Date] H28',
    'N28': '[Campus Director] N28',
    'C23': '[HW Repair] C23',
    'F23': '[HW Install] F23',
    'J23': '[Network] J23',
    'O23': '[Prev Maint] O23',
    'C24': '[SW Dev] C24',
    'F24': '[SW Mod] F24',
    'J24': '[SW Install] J24',
    'O24': '[Others] O24',
    'F21': '[In-Campus] F21',
    'J21': '[External SP] J21',
    'F35': '[Task OK] F35',
    'L35': '[Task Fail] L35',
    'B39': '[Date Completed] B39',
    'G39': '[Serviced By] G39',
    'M39': '[Confirmed By] M39',
  };

  for (const cell in writes) {
    try {
      template.getRange(cell).setValue(writes[cell]);
      Logger.log('OK  ' + cell + ' → ' + writes[cell]);
    } catch (e) {
      Logger.log('ERR ' + cell + ' → ' + e.message);
    }
  }

  SpreadsheetApp.flush();
  Logger.log('Done. Open the Template tab and verify each label is in the correct form field.');
}

/**Tests */
function testApprovalEmail() {
  const props      = PropertiesService.getScriptProperties();
  const webAppUrl  = props.getProperty('WEBAPP_URL');
  const dirEmail   = props.getProperty('DIRECTOR_EMAIL');
  const itEmail    = props.getProperty('IT_STAFF_EMAIL');

  Logger.log('--- Script Properties ---');
  Logger.log('WEBAPP_URL:      ' + (webAppUrl  || '(NOT SET)'));
  Logger.log('DIRECTOR_EMAIL:  ' + (dirEmail   || '(NOT SET)'));
  Logger.log('IT_STAFF_EMAIL:  ' + (itEmail    || '(NOT SET)'));

  // Check Departments sheet
  Logger.log('\n--- Departments Sheet ---');
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const dSheet = ss.getSheetByName('Departments');
  if (!dSheet) {
    Logger.log('ERROR: Departments sheet not found!');
  } else {
    const rows = dSheet.getDataRange().getValues();
    Logger.log('Rows found: ' + (rows.length - 1));
    rows.forEach(function(r, i) { Logger.log('Row ' + i + ': ' + JSON.stringify(r)); });
  }

  // Check Staff sheet
  Logger.log('\n--- Staff Sheet ---');
  const sSheet = ss.getSheetByName('Staff');
  if (!sSheet) {
    Logger.log('Staff sheet not found (optional — only needed if not using Departments sheet)');
  } else {
    const rows = sSheet.getDataRange().getValues();
    Logger.log('Rows found: ' + (rows.length - 1));
    rows.forEach(function(r, i) { Logger.log('Row ' + i + ': ' + JSON.stringify(r)); });
  }

  // Send a live test email
  Logger.log('\n--- Sending Test Approval Email ---');
  const testEmail = 'pgpadao@zrc.pshs.edu.ph';
  if (!webAppUrl) {
    Logger.log('SKIPPED: WEBAPP_URL is not set. Set it in Script Properties first.');
    return;
  }
  const token      = Utilities.getUuid();
  const approveUrl = webAppUrl + '?token=' + token + '&action=approve';
  const rejectUrl  = webAppUrl + '?token=' + token + '&action=reject';
  try {
    MailApp.sendEmail(
      testEmail,
      'TEST: IT Job Request Approval Email',
      'This is a test approval email from the PSHS ZRC ITJRF Chatbot.\n\n' +
      'If you received this, email sending is working correctly.\n\n' +
      'Test APPROVE link: ' + approveUrl + '\n' +
      'Test REJECT link:  ' + rejectUrl  + '\n\n' +
      '(These test links will fail since there is no real ticket — that is expected.)'
    );
    Logger.log('SUCCESS: Test email sent to ' + testEmail);
  } catch (err) {
    Logger.log('ERROR sending email: ' + err);
  }
}

function testGemini() {
  const result = callGemini('hello', [], null);
  Logger.log(result);
}
function testDirect() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  Logger.log('Key set: ' + !!apiKey);
  Logger.log('Key prefix: ' + (apiKey || '').substring(0, 8));

  const url = 'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=' + apiKey;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
    muteHttpExceptions: true,
  });
  Logger.log('HTTP ' + res.getResponseCode());
  Logger.log(res.getContentText().substring(0, 500));
}
function listModels() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1/models?key=' + apiKey,
    { muteHttpExceptions: true }
  );
  Logger.log(res.getContentText());
}
function testSaveTicket() {
  const result = saveTicket({
    name: 'Test User',
    position: 'Test Position',
    supervisor: 'Test Supervisor',
    description: 'Test problem',
    rec_type: 'Others, Repair',
  });
  Logger.log('Result: ' + result);
}