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

// Security & rate limiting
const APPROVAL_TOKEN_TTL_DAYS  = 7;     // approval email links expire after 7 days
const DASHBOARD_SESSION_TTL    = 21600; // dashboard session: 6 hours (seconds) — CacheService max is 21600
const CHAT_SESSION_TTL         = 1800;  // chat session cache: 30 minutes (seconds)
const MAX_CHAT_MESSAGES        = 30;    // max user messages per chat session
const MAX_SUBMISSIONS_PER_HOUR = 20;    // global ticket submission rate limit per hour
const MAX_MESSAGE_LENGTH       = 1000;  // max characters accepted per user message

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

// Form fields collected step-by-step when state === 'collecting'.
// Identity (name/position/department/supervisor) is pre-filled from Google account
// via getUserIdentity() — only description is collected here.
const FORM_STEPS = [
  {
    key: 'description',
    prompt: 'Please describe the problem in detail.',
    // May be pre-filled from the chat signal — skipped if already set
    skippable: true,
  },
];

// Step order for quick-start buttons (Publication/Design, CCTV, Technical Assistance).
// Identity is pre-filled from Google account; only description is collected here.
const QUICK_START_FORM_STEPS = [
  {
    key: 'description',
    prompt: 'Please describe your request in detail.',
    // Prompt is customised per type in handleQuickStart(); this is a fallback only.
  },
];

// =============================================================================
// Security Functions
// =============================================================================

/**
 * Sanitizes a user input string: trims, enforces max length, strips common
 * prompt-injection delimiters so they cannot reach Gemini in raw form.
 */
function sanitizeInput(text) {
  if (typeof text !== 'string') return '';
  text = text.trim();
  if (text.length > MAX_MESSAGE_LENGTH) text = text.substring(0, MAX_MESSAGE_LENGTH);
  // Strip signal delimiters and injection markers
  text = text.replace(/%%[A-Z_]+(?::[\s\S]*?)?%%/g, '');
  text = text.replace(/<\|.*?\|>/g, '');
  text = text.replace(/\[INST\]|\[\/INST\]|<s>|<\/s>/gi, '');
  return text;
}

/**
 * Global ticket-submission rate limiter using CacheService.
 * Allows at most MAX_SUBMISSIONS_PER_HOUR submissions per rolling 60-minute window.
 * Throws if the limit is exceeded.
 */
function checkGlobalRateLimit() {
  const cache  = CacheService.getScriptCache();
  const key    = 'rate_limit_submissions';
  const now    = Date.now();
  const window = 3600000; // 1 hour in ms

  let timestamps = [];
  const raw = cache.get(key);
  if (raw) { try { timestamps = JSON.parse(raw); } catch (e) { timestamps = []; } }

  // Discard timestamps outside the rolling window
  timestamps = timestamps.filter(function(ts) { return now - ts < window; });

  if (timestamps.length >= MAX_SUBMISSIONS_PER_HOUR) {
    throw new Error('Submission limit reached. Please try again later.');
  }

  timestamps.push(now);
  cache.put(key, JSON.stringify(timestamps), 3660); // cache for slightly over 1 hour
}

/**
 * Authenticates an IT staff member for dashboard access.
 * Validates email against IT_STAFF_EMAIL script property and password against
 * DASHBOARD_PASSWORD script property.
 * Returns { ok: true, token, email } on success, or { ok: false, error } on failure.
 */
function dashboardLogin(email, password) {
  if (!email || !password) return { ok: false, error: 'Email and password are required.' };

  const props         = PropertiesService.getScriptProperties();
  const allowedEmails = (props.getProperty('IT_STAFF_EMAIL') || '')
    .split(',')
    .map(function(e) { return e.trim().toLowerCase(); })
    .filter(Boolean);
  const validPassword = props.getProperty('DASHBOARD_PASSWORD') || '';

  if (!allowedEmails.includes(email.toLowerCase().trim())) {
    return { ok: false, error: 'Unrecognized email address.' };
  }
  if (!validPassword || password !== validPassword) {
    return { ok: false, error: 'Incorrect password.' };
  }

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('dash_session_' + token, email.toLowerCase().trim(), DASHBOARD_SESSION_TTL);
  Logger.log('Dashboard login: ' + email);
  return { ok: true, token: token, email: email.toLowerCase().trim() };
}

/**
 * Returns the email address associated with a dashboard session token, or null if invalid/expired.
 */
function validateDashboardSession(token) {
  if (!token) return null;
  return CacheService.getScriptCache().get('dash_session_' + token);
}

/**
 * Invalidates a dashboard session token (logout).
 */
function dashboardLogout(token) {
  if (token) CacheService.getScriptCache().remove('dash_session_' + token);
}

/**
 * Internal auth guard for dashboard functions.
 * Validates that the currently signed-in Google account is an authorized IT staff member.
 * Throws 'Unauthorized' if not in the IT_STAFF_EMAIL list.
 * The token parameter is kept for backward compatibility but is no longer checked.
 */
function _requireDashboardAuth(token) {
  try {
    const email = Session.getActiveUser().getEmail();
    if (!email) throw new Error('Unauthorized: not signed in.');
    const allowed = (PropertiesService.getScriptProperties().getProperty('IT_STAFF_EMAIL') || '')
      .split(',').map(function(e) { return e.trim().toLowerCase(); }).filter(Boolean);
    if (!allowed.includes(email.toLowerCase().trim())) {
      throw new Error('Unauthorized: ' + email + ' is not an authorized IT staff member.');
    }
  } catch (err) {
    if (err.message && err.message.startsWith('Unauthorized')) throw err;
    // Session.getActiveUser() throws in some contexts — fall back to token check
    if (!validateDashboardSession(token)) {
      throw new Error('Session expired. Please log in again.');
    }
  }
}

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
    } else if (session.state === 'confirm_name') {
      result = handleConfirmName(message, session);
    } else if (session.state === 'cctv_letter_check') {
      result = handleCctvLetterCheck(message, session);
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
  // Sanitize raw input
  const message = sanitizeInput(params.message || '');

  // Load server-side session from cache (or create a new one)
  const cache     = CacheService.getScriptCache();
  let   currentId = params.sessionId || '';
  let   session   = {};

  if (currentId) {
    const stored = cache.get('chat_session_' + currentId);
    if (stored) { try { session = JSON.parse(stored); } catch (e) { session = {}; } }
  } else {
    // Issue a new session ID for this conversation
    currentId = Utilities.getUuid();
  }

  // Pre-fill identity fields from Google account lookup on first message.
  // Only applied once (when session is new and userIdentity is provided).
  if (params.userIdentity && !session.identityVerified) {
    const id = params.userIdentity;
    if (!session.formData) session.formData = {};
    session.formData.name             = id.name            || '';
    session.formData.position         = id.position        || '';
    session.formData.department       = id.department      || '';
    session.formData.departmentFull   = id.departmentFull  || id.department || '';
    session.formData.supervisor       = id.supervisor      || '';
    session.formData.supervisorEmail  = id.supervisorEmail || '';
    session.formData.userEmail        = id.email           || '';
    session.formData.identityVerified = true;
    session.userEmail                 = id.email           || '';
    session.identityVerified          = true;
  }

  // Handle quick-start buttons for chat-only types (it_issue, question).
  // publication / cctv / technical now use the inline form panel and submit via
  // submitFormTicket() — they no longer route through processChat().
  if (params.quickStart && !session.state) {
    const type = params.quickStart;
    if (type === 'publication' || type === 'cctv' || type === 'technical') {
      // Stale client — return a safe informational reply
      return {
        reply: 'Please use the form panel to submit this type of request.',
        sessionId: currentId,
      };
    }
    const result = handleQuickStart(type, session);
    cache.put('chat_session_' + currentId, JSON.stringify(
      Object.assign({}, result.session, { messageCount: 1 })
    ), CHAT_SESSION_TTL);
    return { reply: result.reply, replies: result.replies, sessionId: currentId };
  }

  if (!message) return { reply: 'Please type a message.', sessionId: currentId };

  // Enforce per-session message limit
  session.messageCount = (session.messageCount || 0) + 1;
  if (session.messageCount > MAX_CHAT_MESSAGES) {
    return {
      reply: 'This conversation has reached the message limit. Please start a new conversation.',
      sessionId: currentId,
    };
  }

  let result;
  if (session.state === 'collecting') {
    result = handleFormStep(message, session);
  } else if (session.state === 'confirm') {
    result = handleConfirm(message, session);
  } else if (session.state === 'confirm_name') {
    result = handleConfirmName(message, session);
  } else if (session.state === 'cctv_letter_check') {
    result = handleCctvLetterCheck(message, session);
  } else {
    result = handleChat(message, session);
  }

  // Persist the updated session, or clear it if the ticket was submitted
  const newKey = 'chat_session_' + currentId;
  if (result.submitted) {
    cache.remove(newKey);
  } else {
    const toStore = Object.assign({}, result.session, { messageCount: session.messageCount });
    cache.put(newKey, JSON.stringify(toStore), CHAT_SESSION_TTL);
  }

  return {
    reply:     result.reply,
    replies:   result.replies,
    submitted: result.submitted,
    sessionId: currentId,
  };
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

  // Unified nonsense counter — increments on gibberish OR unrelated-to-IT input.
  // 3 combined strikes from any mix of gibberish/unrelated messages ends the conversation.
  const NONSENSE_JOKES = [
    'Alright, I give up trying to decode keyboard poetry. 😄 Please start a new conversation when you\'re ready to type normally — I\'ll be here!',
    'Three strikes and the keyboard wins! 🎹 My gibberish translator is currently on vacation. Start a new conversation when you\'re ready!',
    'I think your cat may have walked across the keyboard one too many times. 🐱 Let\'s start fresh — begin a new conversation when you\'re ready!',
  ];
  if (isGibberish(message)) {
    session.strikeCount = (session.strikeCount || 0) + 1;
    if (session.strikeCount >= 3) {
      const joke = NONSENSE_JOKES[Math.floor(Math.random() * NONSENSE_JOKES.length)];
      return { reply: joke, session: {}, submitted: true };
    }
    const warnings = [
      'That doesn\'t look like a valid message. Could you describe your IT issue in plain text?',
      'Hmm, that still doesn\'t look right. One more like that and I\'ll have to give up on us! 😅',
    ];
    return { reply: warnings[session.strikeCount - 1], session };
  }

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

    // Pre-fill recommendation for known request types
    const lowerDesc = prefillDesc.toLowerCase();
    const isOthers =
      lowerDesc.includes('cctv')         || lowerDesc.includes('footage')     || lowerDesc.includes('camera')  ||
      lowerDesc.includes('poster')       || lowerDesc.includes('tarpaulin')   || lowerDesc.includes('tarps')   ||
      lowerDesc.includes('pubmat')       || lowerDesc.includes('design')      || lowerDesc.includes('layout')  ||
      lowerDesc.includes('social media') || lowerDesc.includes('facebook')    || lowerDesc.includes('post')    ||
      lowerDesc.includes('certificate')  || lowerDesc.includes('announcement')|| lowerDesc.includes('publication');

    // When identity is already known (Google account pre-fill), auto-file the ticket
    // immediately — but only if the conversation contains actual IT-related details.
    if (session.identityVerified) {
      // Build a comprehensive description from the full conversation, then paraphrase
      const rawDesc    = buildDescriptionFromHistory(session) || prefillDesc;

      // Guard: reject filing if there is no real IT context in the conversation.
      // Any mix of gibberish + unrelated inputs counts toward the shared 3-strike limit.
      if (!hasEnoughContext(rawDesc)) {
        session.strikeCount = (session.strikeCount || 0) + 1;
        if (session.strikeCount >= 3) {
          const joke = NONSENSE_JOKES[Math.floor(Math.random() * NONSENSE_JOKES.length)];
          return { reply: joke, session: {}, submitted: true };
        }
        const clarifyPrompts = [
          'I\'d be happy to file an IT request, but I need a few more details first. ' +
          'Could you describe the specific IT issue you\'re experiencing? ' +
          '(e.g. which device, what problem, what you\'ve already tried)',
          'I still need some IT-related details to file a request. ' +
          'What device or system is having a problem, and what exactly is happening?',
        ];
        const clarifyReply = clarifyPrompts[session.strikeCount - 1];
        session.history = appendHistory(session.history, message, clarifyReply);
        return { reply: clarifyReply, session };
      }
      // Reset strike counter once valid IT context is confirmed
      session.strikeCount = 0;

      const formalDesc = paraphraseDescription(rawDesc);

      const ticketData = {
        name:            session.formData.name            || '',
        position:        session.formData.position        || '',
        department:      session.formData.department      || '',
        departmentFull:  session.formData.departmentFull  || '',
        supervisor:      session.formData.supervisor      || '',
        supervisorEmail: session.formData.supervisorEmail || '',
        userEmail:       session.formData.userEmail       || session.userEmail || '',
        description:     formalDesc,
        rawDescription:  rawDesc,
        recType:         isOthers ? 'Others, Repair' : '',
      };

      const saved = saveTicket(ticketData);
      const jrfNo = (saved.ok && saved.jrfNo) || '—';

      const finalReply = saved.ok
        ? '✅ Your IT Job Request has been submitted!\n\n' +
          '📌 Ticket #' + jrfNo + '\n' +
          '👤 ' + (ticketData.name     || '—') + '\n' +
          '🏢 ' + (ticketData.departmentFull || ticketData.department || '—') + '\n' +
          '👨‍💼 Supervisor: ' + (ticketData.supervisor || '—') + '\n' +
          '📝 ' + rawDesc + '\n\n' +
          'Your supervisor will receive an approval email shortly. Once approved, IT staff will be assigned to take action.\n\n' +
          'You can check your ticket status anytime via 📋 My Tickets.'
        : (saved.error || 'There was a problem saving your request. Please try again or contact the IT unit directly.');

      // Prepend the visible Gemini reply (e.g. "Waste ink pad is full…") as a separate bubble.
      // Only lock the chat (submitted: true) on actual success — rate-limit errors let the
      // user start a new conversation instead of being permanently locked out.
      session.history = appendHistory(session.history, message, finalReply);
      const replies = [visibleReply, finalReply].filter(Boolean);
      return { reply: finalReply, replies, session: {}, submitted: saved.ok };
    }

    // Identity not yet known — fall back to form collection.
    // (Normally shouldn't happen since identity is pre-filled on page load.)
    session.state    = 'collecting';
    session.step     = 0;
    session.formData = { description: prefillDesc };
    if (isOthers) session.formData.recType = 'Others, Repair';

    const introMessage =
      'I\'ll need a few details to fill out the IT Job Request Form. ' +
      'Once submitted, your supervisor will receive an approval email — then IT staff will be notified to take action.';

    const firstPrompt = getNextPrompt(session);
    const combined    = (visibleReply ? visibleReply + '\n\n' : '') + introMessage + '\n\n' + firstPrompt;

    session.history = appendHistory(session.history, message, combined);
    const replies = [visibleReply, introMessage, firstPrompt].filter(Boolean);
    return { reply: combined, replies, session };
  }

  // Normal reply — message was legitimate, reset the strike counter
  session.strikeCount = 0;
  session.history = appendHistory(session.history, message, geminiReply);
  return { reply: geminiReply, session };
}

// =============================================================================
// Quick-Start (direct form bypass — no Gemini)
// =============================================================================

/**
 * Handles quick-start button types for the chat flow.
 * 'publication', 'cctv', and 'technical' now use the inline form panel in Index.html
 * and submit directly via submitFormTicket() — they no longer go through processChat().
 * This function is kept for safety but should not be reached in normal operation.
 *
 * @param {string} type - 'it_issue' | 'question' (form types are now handled client-side)
 * @param {object} session
 */
function handleQuickStart(type, session) {
  // Form-type buttons now use the inline form panel + submitFormTicket() directly.
  // Guard against stale clients that may still send quickStart for these types.
  if (type === 'publication' || type === 'cctv' || type === 'technical') {
    const msg = 'This request type now uses the form — please use the form panel in the chat interface.';
    return { reply: msg, replies: [msg], session };
  }

  // it_issue and question are handled directly in Index.html (no quickStart call needed).
  // This branch is a fallback only.
  const msg = 'How can I help you today?';
  return { reply: msg, replies: [msg], session };
}

// =============================================================================
// Form Collection State
// =============================================================================

/**
 * Advances through form steps one answer at a time.
 * Quick-start flows (Publication/Design, CCTV, Technical Assistance) use
 * QUICK_START_FORM_STEPS (description first); normal Gemini flows use FORM_STEPS.
 */
function handleFormStep(message, session) {
  const steps = session.quickStartSteps ? QUICK_START_FORM_STEPS : FORM_STEPS;
  const step  = steps[session.step];

  // --- Gibberish detection (name / position / department / supervisor only) ---
  // Description is free-form text, so gibberish detection is skipped for it.
  const GIBBERISH_JOKES = [
    'Alright, I give up trying to decode keyboard poetry. 😄 Please start a new conversation when you\'re ready to type normally — I\'ll be here!',
    'Three strikes and the keyboard wins! 🎹 My gibberish translator is currently on vacation. Start a new conversation when you\'re ready!',
    'I think your cat may have walked across the keyboard one too many times. 🐱 Let\'s start fresh — begin a new conversation when you\'re ready!',
  ];
  const STEP_LABELS = {
    name:       'full name',
    position:   'position or designation',
    department: 'department or office',
    supervisor: 'immediate supervisor',
  };
  if (STEP_LABELS[step.key] && isGibberish(message)) {
    session.strikeCount = (session.strikeCount || 0) + 1;
    if (session.strikeCount >= 3) {
      // End the conversation with a joke after 3 consecutive gibberish inputs
      const joke = GIBBERISH_JOKES[Math.floor(Math.random() * GIBBERISH_JOKES.length)];
      return { reply: joke, session: {}, submitted: true };
    }
    const label = STEP_LABELS[step.key];
    const warnings = [
      'That doesn\'t look like a valid ' + label + '. Could you please try again?\n\n' + step.prompt,
      'Hmm, that still doesn\'t look right. One more like that and I\'ll have to give up on us! 😅\n\n' + step.prompt,
    ];
    return { reply: warnings[session.strikeCount - 1], session };
  }
  // Reset strike counter once the user types something valid
  session.strikeCount = 0;

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
  } else if (step.key === 'name') {
    session.formData[step.key] = message;
    // Look up the employee in the Employees sheet (exact match first, then fuzzy).
    // If a match is found, pause and ask the user to confirm before auto-filling.
    const emp = lookupEmployee(message);
    if (emp) {
      session.pendingEmployee = emp;
      session.state = 'confirm_name';
      const confirmMsg =
        'I found "' + emp.matchedName + '" (' + emp.position + ', ' + (emp.departmentFull || emp.department) + ') in our records. ' +
        'Is this you? Reply "yes" to auto-fill your details, or "no" to enter them manually.';
      return { reply: confirmMsg, session };
    }
  } else if (step.key === 'department') {
    session.formData[step.key] = message;
    // Auto-fill supervisor; falls back to Campus Director for Chief-level positions
    const lookup = resolveAutoSupervisor(session.formData.position || '', message, session.formData.name || '');
    if (lookup && lookup.supervisorName) {
      session.formData.supervisor      = lookup.supervisorName;
      session.formData.supervisorEmail = lookup.supervisorEmail;
    }
  } else {
    if (step.key === 'description') {
      // Context sufficiency check — ask once if too vague
      if (!session.descriptionFollowUpAsked && !hasEnoughContext(message)) {
        session.descriptionFollowUpAsked = true;
        const followUp = session.quickStartLabel
          ? (session.quickStartLabel.includes('Publication')
              ? 'Could you share a few more details? For example: the title or topic, the occasion or event it\'s for, and when you need it.'
              : session.quickStartLabel.includes('CCTV')
              ? 'Could you briefly describe the purpose of the CCTV request? (e.g. incident investigation, security review)'
              : 'Could you describe the issue in a bit more detail? Which device or system, what you were trying to do, and what happened.')
          : 'Before I file the request, could you give me a bit more detail? Which device or system is affected, what exactly happens, and whether you\'ve already tried anything.';
        return { reply: followUp, session };
      }
      // Build description from full conversation history, then formally paraphrase
      const rawDescription = buildDescriptionFromHistory(session) || message;
      const formalDescription = paraphraseDescription(
        session.quickStartLabel ? session.quickStartLabel + ': ' + rawDescription : rawDescription
      );
      session.formData.rawDescription = rawDescription;
      session.formData[step.key] = formalDescription;
    } else {
      session.formData[step.key] = message;
    }
  }

  // After collecting description in a quick-start flow, show the form intro
  // message before asking for the user's name (next step).
  const justFinishedDescription = session.quickStartSteps && step.key === 'description';

  session.step++;

  // Skip steps that are already pre-filled
  while (
    session.step < steps.length &&
    steps[session.step].skippable &&
    session.formData[steps[session.step].key]
  ) {
    session.step++;
  }

  if (session.step < steps.length) {
    const note       = session.formData._nameNote || null;
    delete session.formData._nameNote;
    const nextPrompt = getNextPrompt(session);

    // Build reply bubbles; inject form intro between description and name steps
    const bubbles = [];
    if (justFinishedDescription) {
      bubbles.push(
        'I\'ll need a few details to fill out the IT Job Request Form. ' +
        'Once submitted, your supervisor will receive an approval email — then IT staff will be notified to take action.'
      );
    }
    if (note) bubbles.push(note);
    bubbles.push(nextPrompt);

    const reply = bubbles.join('\n\n');
    return bubbles.length > 1
      ? { reply, replies: bubbles, session }
      : { reply, session };
  }

  // All fields collected — if identity is already verified, auto-file the ticket
  // immediately without showing a confirmation prompt.
  const note = session.formData._nameNote || null;
  delete session.formData._nameNote;

  if (session.identityVerified) {
    const saved   = saveTicket(session.formData);
    const jrfNo   = (saved.ok && saved.jrfNo) || '—';
    const rawDesc = (session.formData.rawDescription || session.formData.description || '');

    const resultMsg = saved.ok
      ? '✅ Your IT Job Request has been submitted!\n\n' +
        '📌 Ticket #' + jrfNo + '\n' +
        '👤 ' + (session.formData.name || '—') + '\n' +
        '🏢 ' + (session.formData.departmentFull || session.formData.department || '—') + '\n' +
        '👨‍💼 Supervisor: ' + (session.formData.supervisor || '—') + '\n' +
        '📝 ' + rawDesc + '\n\n' +
        'Your supervisor will receive an approval email shortly. Once approved, IT staff will be assigned to take action.\n\n' +
        'You can check your ticket status anytime via 📋 My Tickets.'
      : (saved.error || 'There was a problem saving your request. Please try again or contact the IT unit directly.');

    const bubbles = [];
    if (note) bubbles.push(note);
    bubbles.push(resultMsg);
    const reply = bubbles.join('\n\n');
    // Only lock the chat on success — rate-limit or other errors let user retry/start over
    return bubbles.length > 1
      ? { reply, replies: bubbles, session: {}, submitted: saved.ok }
      : { reply, session: {}, submitted: saved.ok };
  }

  // Identity not pre-filled — fall back to confirmation step
  session.state = 'confirm';
  const confirmMsg = buildConfirmationMessage(session.formData);
  if (note) {
    return { reply: note + '\n\n' + confirmMsg, replies: [note, confirmMsg], session };
  }
  return { reply: confirmMsg, session };
}

/**
 * Returns the prompt for the current step, skipping already-filled skippable steps.
 */
function getNextPrompt(session) {
  const steps = session.quickStartSteps ? QUICK_START_FORM_STEPS : FORM_STEPS;
  while (
    session.step < steps.length &&
    steps[session.step].skippable &&
    session.formData[steps[session.step].key]
  ) {
    session.step++;
  }
  if (session.step >= steps.length) return null;
  return steps[session.step].prompt;
}

/**
 * Handles the cctv_letter_check state — asks if the user has a Director-approved letter.
 * Yes → proceed to description step.
 * No  → explain requirement, end conversation (no ticket filed).
 * Unrecognised → re-ask once.
 */
function handleCctvLetterCheck(message, session) {
  const lower = message.toLowerCase().trim();

  // Yes phrases (English + Bisaya/Filipino)
  const yesPatterns = ['ok', 'yes', 'meron', 'naa na', 'naa ko', 'i have', 'i will',
    'got it', 'noted', "i'll prepare", 'oo', 'sige', 'ok na', 'go', 'i do',
    'i already have', 'already approved', 'approved na'];

  // No phrases (English + Bisaya/Filipino)
  const noPatterns = ["wala pa", "i don't have", "no letter", "wala ko letter",
    "i haven't", 'not yet', 'wala', 'dili pa', 'wala ko', 'dili ko',
    'not approved', 'no', 'wala gyud', 'dili pa ko', 'wala pa ko'];

  const isYes = yesPatterns.some(function(p) { return lower.includes(p); });
  const isNo  = noPatterns.some(function(p) { return lower.includes(p); });

  if (isNo || (!isYes && session.cctvFollowUpAsked)) {
    // No letter → explain and end
    return {
      reply:
        'Please prepare a formal letter addressed to the Campus Director containing ' +
        'the exact date, time range, camera location, and reason for the footage review. ' +
        'Once the Campus Director approves your letter, you may return here to file the ' +
        'IT Job Request. The IT unit cannot proceed without the Director\'s approval.',
      session: {},
      submitted: true, // lock chat
    };
  }

  if (isYes) {
    // Has letter → proceed to description collection
    session.state = 'collecting';
    session.step  = 0;
    if (!session.formData) session.formData = {};
    session.formData.recType = 'Others, Repair';
    const descPrompt =
      'Please provide a brief description of your CCTV viewing request.\n' +
      '(Include: the date/time range of the footage needed, camera location, and reason.)';
    return { reply: descPrompt, session: session };
  }

  // Unrecognised — re-ask once
  session.cctvFollowUpAsked = true;
  return {
    reply:
      'Do you currently have a letter approved by the Campus Director for this CCTV request? ' +
      'Reply yes or no.',
    session: session,
  };
}

/**
 * Handles the yes/no confirmation before saving the ticket.
 */
function handleConfirm(message, session) {
  const lower = message.toLowerCase().trim();

  if (lower === 'yes' || lower === 'y' || lower === 'confirm' ||
      lower === 'oo' || lower === 'oo na' || lower === 'sige' || lower === 'sige na' ||
      lower === 'naa na' || lower === 'ok na' || lower === 'go na' || lower === 'laban' ||
      lower === 'mao na' || lower === 'tama na') {
    const saved  = saveTicket(session.formData);
    const jrfNo  = (saved.ok && saved.jrfNo) || '—';
    const problemSummary = (session.formData.rawDescription || session.formData.description || '').substring(0, 60);
    const reply = saved.ok
      ? '✅ Your IT Job Request has been submitted successfully!\n\n' +
        '📌 Ticket number: ' + jrfNo + '\n' +
        '📝 Request: ' + problemSummary + ((session.formData.rawDescription || '').length > 60 ? '…' : '') + '\n' +
        '👤 Status: Pending supervisor approval\n\n' +
        'Your supervisor will receive an approval email shortly.\n' +
        'You can track this ticket using the 📋 My Tickets button.'
      : (saved.error || 'There was a problem saving your request. Please contact IT directly or try again.');
    // Only lock the chat on success — rate-limit errors let the user start a new conversation
    return { reply, session: {}, submitted: saved.ok };
  }

  if (lower === 'no' || lower === 'n' || lower === 'cancel' ||
      lower === 'dili' || lower === 'dili pa' || lower === 'wala pa' ||
      lower === 'wala' || lower === 'wala ko' || lower === 'dili ko' ||
      lower === 'wala gyud' || lower === 'dili na') {
    // If the ticket came from a quick-start button, restart that same flow
    // (re-ask the description question) instead of resetting to neutral.
    const qsType = session.quickStartType;
    if (qsType) {
      const restart = handleQuickStart(qsType, {});
      const cancelNote = 'No problem — your request was not submitted.';
      const replies = [cancelNote].concat(restart.replies || [restart.reply]);
      return { reply: cancelNote, replies, session: restart.session };
    }
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

/**
 * Handles the confirm_name state — user is asked to confirm whether the
 * employee record found by lookupEmployee() matches them.
 * "yes" → auto-fills position, department, and supervisor, then advances.
 * "no"  → clears pending data and asks the user to enter their details manually.
 */
function handleConfirmName(message, session) {
  const lower = message.toLowerCase().trim();
  const emp   = session.pendingEmployee;
  delete session.pendingEmployee;
  session.state = 'collecting'; // resume collecting

  const isYes = lower === 'yes' || lower === 'y';

  if (isYes) {
    // Use the full canonical name from the sheet, not whatever the user typed
    session.formData.name       = emp.matchedName;
    session.formData.position   = emp.position;
    session.formData.department = emp.department;
    // resolveAutoSupervisor tries the Departments sheet first; falls back to the
    // Campus Director for Chief-level positions (detected via self-referential lookup).
    const supLookup = resolveAutoSupervisor(emp.position, emp.department, emp.matchedName);
    if (supLookup && supLookup.supervisorName) {
      session.formData.supervisor      = supLookup.supervisorName;
      session.formData.supervisorEmail = supLookup.supervisorEmail;
    }
  }

  // Advance past the name step (step was held while waiting for confirmation)
  session.step++;
  // getNextPrompt() skips over any pre-filled skippable steps
  const nextPrompt = getNextPrompt(session);

  if (!nextPrompt) {
    // All steps complete — go to submission confirmation
    session.state = 'confirm';
    const confirmMsg = buildConfirmationMessage(session.formData);
    if (isYes) {
      const note = 'Got it! I\'ve pre-filled your details.';
      return { reply: note + '\n\n' + confirmMsg, replies: [note, confirmMsg], session };
    }
    return { reply: confirmMsg, session };
  }

  if (isYes) {
    const note = 'Got it! I\'ve pre-filled your details.';
    return { reply: note + '\n\n' + nextPrompt, replies: [note, nextPrompt], session };
  }
  return { reply: nextPrompt, session };
}

/**
 * Lightweight Gemini call to check if a message has enough detail to file a ticket.
 * Returns true ('yes') or false ('no'). On API error: returns true (fail open).
 */
function hasEnoughContext(message) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) return true;

    const systemPrompt =
      'You are checking if an IT help desk request has enough detail to file an official form. ' +
      'Reply ONLY with "yes" or "no". ' +
      'Answer "yes" if the message contains: what the problem/request is AND at least one specific detail ' +
      '(device/system affected, event/occasion, what happened, when it started, what was already tried). ' +
      'Answer "no" if too vague, under 8 words, or no context — e.g. "broken", "not working", ' +
      '"need help", "poster", "CCTV", "assistance". ' +
      'Message: ' + message;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4 },
    };
    const response = UrlFetchApp.fetch(GEMINI_ENDPOINT + '?key=' + apiKey, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const text = JSON.parse(response.getContentText())
      ?.candidates?.[0]?.content?.parts?.[0]?.text || 'yes';
    return text.trim().toLowerCase().startsWith('y');
  } catch (err) {
    console.error('hasEnoughContext error: ' + err);
    return true; // fail open
  }
}

/**
 * Builds a comprehensive description from the full conversation history.
 * Used instead of a single-field answer to capture context from the whole chat.
 * Falls back to session.formData.description on API error.
 */
function buildDescriptionFromHistory(session) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey || !session.history || session.history.length === 0) {
      return session.formData && session.formData.description ? session.formData.description : '';
    }

    const historyText = session.history
      .map(function(turn) { return (turn.role === 'user' ? 'User: ' : 'Bot: ') + turn.text; })
      .join('\n');

    const systemPrompt =
      'You are extracting the core IT problem or request from a conversation log. ' +
      'Read the full conversation and write one comprehensive description of what the user needs. ' +
      'Include: what the problem/request is, which device/system is involved (if mentioned), ' +
      'what has already been tried (if mentioned), relevant occasion/event details (for design), ' +
      'relevant footage date/time/location (for CCTV). ' +
      'Rules: use only information from the conversation, plain English or Filipino, ' +
      'maximum 4 sentences, output ONLY the description text.\n' +
      'Conversation:\n' + historyText;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 256 },
    };
    const response = UrlFetchApp.fetch(GEMINI_ENDPOINT + '?key=' + apiKey, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const text = JSON.parse(response.getContentText())
      ?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? text.trim() : (session.formData && session.formData.description ? session.formData.description : '');
  } catch (err) {
    console.error('buildDescriptionFromHistory error: ' + err);
    return session.formData && session.formData.description ? session.formData.description : '';
  }
}

/**
 * Formally paraphrases a raw IT request description into Philippine government document style.
 * Returns rawText unchanged on API error.
 */
function paraphraseDescription(rawText) {
  try {
    if (!rawText) return rawText;
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) return rawText;

    const systemPrompt =
      'You are a formal document editor for a Philippine government school (PSHS ZRC). ' +
      'Rewrite the following IT problem or service request description in clear, formal ' +
      'Filipino-English — the style used in Philippine government office documents. ' +
      'Rules:\n' +
      '- Keep all technical details and specifics exactly as stated\n' +
      '- Do not add information not present in the input\n' +
      '- Do not remove any detail\n' +
      '- Begin with: "The requesting party reports that..." or "The unit/device..." ' +
      '  or "A request has been made for..." depending on context\n' +
      '- Maximum 3 sentences\n' +
      '- Output ONLY the rewritten text, nothing else\n' +
      'Input: ' + rawText;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 256 },
    };
    const response = UrlFetchApp.fetch(GEMINI_ENDPOINT + '?key=' + apiKey, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const text = JSON.parse(response.getContentText())
      ?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? text.trim() : rawText;
  } catch (err) {
    console.error('paraphraseDescription error: ' + err);
    return rawText;
  }
}

function buildConfirmationMessage(data) {
  const deptDisplay = data.departmentFull || data.department || '—';
  const lines = [
    'Please confirm your IT Job Request before submitting:\n',
    'Name:              ' + (data.name       || '—'),
    'Position:          ' + (data.position   || '—'),
    'Department/Office: ' + deptDisplay,
    'Supervisor:        ' + (data.supervisor || '—'),
  ];
  if (data.rawDescription && data.rawDescription !== data.description) {
    lines.push('\n📋 Problem (as described):\n' + data.rawDescription);
    lines.push('\n📝 Problem (formal for form):\n' + (data.description || '—'));
  } else {
    lines.push('\nProblem Description:\n' + (data.description || '—'));
  }
  lines.push('\nReply "yes" to submit or "no" to cancel.');
  return lines.join('\n');
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
    'You help staff troubleshoot IT issues and file IT Job Request Forms (ITJRF).\n' +
    'The user has been identified via their Google account. ' +
    'Name, position, department, and supervisor are already known — do NOT ask for them.\n\n' +

    // ── CRITICAL OVERRIDES — read these first, they override everything else ──
    'CRITICAL OVERRIDES (apply before all other rules):\n\n' +

    'OVERRIDE A — Publication / design mentions INSIDE the IT Issue / Repair or Ask a Question chat:\n' +
    '(This override does NOT apply when using the Publication / Design form button — that goes directly to submitFormTicket().)\n' +
    'The IT Unit is also the designated Information Officers of PSHS ZRC, so they handle ALL publication and design work.\n' +
    'Trigger words: poster, tarpaulin, tarps, pubmat, design, layout, social media, facebook, post, certificate, announcement, publication, graphic, infographic, flyer, banner.\n' +
    'WHEN ANY of these words appear in the IT Issue chat — even in passing — you MUST:\n' +
    '  1. Write EXACTLY ONE short sentence acknowledging the request. Example: "Got it, I\'ll file a request for your poster design."\n' +
    '  2. IMMEDIATELY end your reply with: %%FILE_TICKET:<one-sentence description>%%\n' +
    'NEVER ask for design details, event info, dimensions, content, deadline, or any other specifics.\n' +
    'NEVER ask for Name / Position / Department / Supervisor — the form collects those automatically.\n' +
    'NEVER give a normal chat reply — acknowledgment sentence + signal, nothing else.\n\n' +

    'OVERRIDE B — User says they already sent details or already talked to IT:\n' +
    'Trigger phrases: "I already sent", "I sent", "already told IT", "already talked to IT", "I emailed IT", "already gave the details", "already reported".\n' +
    'WHEN any of these appear — you MUST:\n' +
    '  1. Reply with EXACTLY this sentence: "Noted — I still need to file an official IT Job Request Form as the record for this request."\n' +
    '  2. IMMEDIATELY end your reply with: %%FILE_TICKET:<one-sentence description>%%\n' +
    'NEVER just say "thank you" or "noted" and stop — always file the ticket.\n' +
    'NEVER ask for Name / Position / Department / Supervisor — the form collects those automatically.\n\n' +

    // ── General rules ──
    'General rules:\n' +
    '1. Be concise, professional, and friendly.\n' +
    '2. When answering technical questions, use the Knowledge Base entries provided.\n' +
    '3. If no KB entry is relevant, use your own knowledge to help troubleshoot.\n' +
    '4. For IT Issue / Repair requests:\n' +
       '   a. FIRST provide troubleshooting steps using Knowledge Base entries or your own knowledge.\n' +
       '   b. Ask the user to try the steps and confirm the result before filing a ticket.\n' +
       '   c. Only send %%FILE_TICKET:<one-sentence summary>%% when:\n' +
       '      - The user explicitly asks to file (e.g. "file a ticket", "submit", "i-submit na",\n' +
       '        "mag-ticket na", "i give up", "please file", "can you file")\n' +
       '      - The user confirms troubleshooting failed (e.g. "still not working", "hindi pa rin",\n' +
       '        "wala gihapon", "di pa gumana", "na-try na", "same problem", "wala gyud",\n' +
       '        "dili pa gumana", "di jud mo-on")\n' +
       '      - The problem clearly requires physical intervention (hardware broken,\n' +
       '        needs on-site inspection, requires parts replacement)\n' +
       '   d. NEVER send %%FILE_TICKET%% in the same reply as troubleshooting questions.\n' +
       '   e. For Technical Assistance and CCTV mentions inside the IT Issue chat: send %%FILE_TICKET%%\n' +
       '      immediately. Note: Publication, CCTV, and Technical Assistance each have their own\n' +
       '      dedicated form panel — if the user is using those buttons, this rule does not apply.\n' +
    '5. Do not make up ticket numbers or form details.\n' +
    '6. This chatbot does NOT support file uploads. If a user mentions attaching files, inform them and ask them to describe in text.\n' +
    '7. CCTV viewing requests are governed by the Data Privacy Act. First inform the user they need a formal letter to the Campus Director with the exact date, time range, camera location, and reason — the Director must approve before IT can proceed. Do NOT ask for CCTV details. Then end with %%FILE_TICKET:<description>%%.\n\n' +

    '8. Language: You understand and respond in Filipino, English, and Bisaya/Cebuano.\n' +
       '   Detect the user\'s language and reply in the SAME language or mix if they code-switch.\n' +
       '   Common Bisaya IT phrases:\n' +
       '   - dili mo-on / dili mo bukas = won\'t turn on\n' +
       '   - dugay kaayo = very slow\n' +
       '   - wala signal / wala internet = no connection\n' +
       '   - na-freeze / natulog = frozen/unresponsive\n' +
       '   - dili ma-print = cannot print\n' +
       '   - naputol = disconnected / cut off\n' +
       '   - di ko mabukas = I can\'t open it\n' +
       '   - wala gyud = nothing works / still not working\n' +
       '   - na-try na nako = I already tried that\n' +
       '   - naa ko problema sa = I have a problem with\n' +
       '   - unsay buhaton = what should I do\n' +
       '   - nag-restart ra = keeps restarting\n' +
       '   - wala na = doesn\'t work anymore\n\n' +
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
 * @returns {{ ok: boolean, jrfNo?: string, error?: string }}
 */
function saveTicket(data) {
  try {
    // Enforce global submission rate limit before writing to the sheet
    checkGlobalRateLimit();

    // Per-user rate limit: max 3 submissions per day.
    // IT staff (IT_STAFF_EMAIL) are exempt so they can test without hitting the limit.
    const itStaffEmails = (PropertiesService.getScriptProperties().getProperty('IT_STAFF_EMAIL') || '')
      .split(',').map(function(e) { return e.trim().toLowerCase(); }).filter(Boolean);
    const isITStaff = data.userEmail &&
      itStaffEmails.includes(data.userEmail.toLowerCase().trim());

    if (data.userEmail && !isITStaff) {
      const userRateKey = 'rate_user_' + data.userEmail;
      const todayCount  = parseInt(CacheService.getScriptCache().get(userRateKey) || '0', 10);
      if (todayCount >= 3) {
        // Calculate hours remaining until midnight PHT (UTC+8)
        const nowPht           = Math.floor(Date.now() / 1000) + 28800;
        const secondsUntilReset = Math.floor(86400 - (nowPht % 86400));
        const hoursLeft         = Math.ceil(secondsUntilReset / 3600);
        return {
          ok: false,
          error:
            'You have already submitted 3 IT Job Requests today. ' +
            'Your limit resets in about ' + hoursLeft + ' hour(s). ' +
            'If this is urgent, please contact the IT unit directly.',
        };
      }
      // TTL = seconds until midnight PHT (UTC+8)
      const nowPht = Math.floor(Date.now() / 1000) + 28800;
      const ttl    = Math.floor(86400 - (nowPht % 86400));
      CacheService.getScriptCache().put(userRateKey, String(todayCount + 1), ttl);
    }

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
        'Others Description',
        'Service Location',
        'Raw Description',    // col Q — raw unparaphrased description from chat
        'Requester Email',    // col R — Google account email
      ]);
      sheet.setFrozenRows(1);
    }

    // Ensure col Q and R headers exist for existing sheets (no-op if already present)
    const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headerRow.length < 17 || !headerRow[16]) {
      sheet.getRange(1, 17).setValue('Raw Description');
    }
    if (headerRow.length < 18 || !headerRow[17]) {
      sheet.getRange(1, 18).setValue('Requester Email');
    }

    // Auto-increment JRF number: count existing data rows + 1
    const lastRow = sheet.getLastRow();             // includes header
    const jrfNo   = lastRow;                        // row 1 = header → first ticket = 1
    const jrfStr  = String(jrfNo).padStart(4, '0'); // e.g. "0001"

    const today = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );

    sheet.appendRow([
      jrfStr,
      today,
      data.name           || '',
      data.position       || '',
      data.supervisor     || '',
      data.description    || '',
      data.recType        || '',  // Recommendation Type — pre-filled for known types; otherwise set by IT staff
      'Pending Supervisor Approval', // default Status
      '',                           // Assigned Staff — filled by IT staff later
      '',                           // Date Completed — filled by IT staff later
      '',                           // Assessment — filled by IT staff later
      '',                           // Action Taken — filled by IT staff later
      '',                           // Task Result — filled by IT staff later
      '',                           // Target Date — filled by IT staff later
      '',                           // Others Description — filled by IT staff later
      '',                           // Service Location — filled by IT staff later
      data.rawDescription || '',    // col Q — raw description before formal paraphrase
      data.userEmail      || '',    // col R — requester Google account email
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
        recommendation:  data.recType          || '',
        date:            today,
      });
    } catch (emailErr) {
      Logger.log('Supervisor approval email error: ' + emailErr);
    }

    Logger.log('Ticket saved: JRF #' + jrfStr);
    return { ok: true, jrfNo: jrfStr };
  } catch (err) {
    Logger.log('saveTicket error: ' + err + '\n' + err.stack);
    return { ok: false, error: 'There was a problem saving your request. Please try again or contact the IT unit directly.' };
  }
}

// =============================================================================
// submitFormTicket() — inline form panel submission for publication/cctv/technical
// =============================================================================

/**
 * Handles direct form-panel submissions for publication, CCTV, and technical assistance.
 * Called from Index.html when the inline form is submitted — bypasses the chat
 * session state machine entirely.
 *
 * @param {object} params - {
 *   description: string,            // raw description typed by user
 *   quickStartType: string,         // 'publication' | 'cctv' | 'technical'
 *   userIdentity: object,           // { email, name, position, department, departmentFull, supervisor, supervisorEmail }
 *   sessionId: string,              // for logging (not used for rate limiting here)
 *   cctvLetterConfirmed: boolean,   // true only for CCTV; checkbox value from the form
 * }
 * @returns {{ jrfNo, rawDesc, name, departmentFull, supervisor } | { error, message }}
 */
function submitFormTicket(params) {
  try {
    // 1. Validate identity
    const id = params.userIdentity;
    if (!id || !id.email || !id.name) {
      return { error: 'no_identity', message: 'Identity not verified. Please reload the page and try again.' };
    }

    // 2. CCTV letter check (server-side — belt-and-suspenders; the checkbox already
    //    prevents submission in Index.html, but validate here too for security)
    if (params.quickStartType === 'cctv' && !params.cctvLetterConfirmed) {
      return { error: 'cctv_no_letter', message: 'A Campus Director-approved letter is required before filing a CCTV viewing request.' };
    }

    // 3. Check global rate limit
    try { checkGlobalRateLimit(); } catch (e) {
      return { error: 'rate_limit', message: e.message };
    }

    // 4. Check per-user rate limit (max 3/day; resets at midnight PHT)
    const itStaffEmails = (PropertiesService.getScriptProperties().getProperty('IT_STAFF_EMAIL') || '')
      .split(',').map(function(e) { return e.trim().toLowerCase(); }).filter(Boolean);
    const isITStaff = itStaffEmails.includes(id.email.toLowerCase().trim());
    if (!isITStaff) {
      const userRateKey = 'rate_user_' + id.email;
      const todayCount  = parseInt(CacheService.getScriptCache().get(userRateKey) || '0', 10);
      if (todayCount >= 3) {
        const nowPht    = Math.floor(Date.now() / 1000) + 28800;
        const hoursLeft = Math.ceil(Math.floor(86400 - (nowPht % 86400)) / 3600);
        return {
          error:   'rate_limit',
          message: 'You have already submitted 3 IT Job Requests today. Your limit resets in about ' +
                   hoursLeft + ' hour(s). If this is urgent, please contact the IT unit directly.',
        };
      }
    }

    // 5. Validate description — the 8-word minimum on the form is sufficient for
    //    structured form submissions. hasEnoughContext() is skipped here because its
    //    Gemini prompt is tuned for IT-repair chat (device/system/what happened) and
    //    will incorrectly reject valid publication/design/technical/CCTV requests.
    const rawDesc = sanitizeInput(params.description || '');
    if (!rawDesc) {
      return { error: 'no_description', message: 'Please enter a description.' };
    }

    // 6. Build description with label prefix, then formally paraphrase
    const labelMap = {
      publication: 'Publication/Design Request',
      cctv:        'CCTV Viewing Request',
      technical:   'Technical Assistance',
    };
    const label          = labelMap[params.quickStartType] || params.quickStartType;
    const rawDescription = label + ': ' + rawDesc;
    const formalDesc     = paraphraseDescription(rawDescription);

    // 7. Save ticket — recType always 'Others, Repair' for all three form types
    const saved = saveTicket({
      name:            id.name            || '',
      position:        id.position        || '',
      department:      id.department      || '',
      departmentFull:  id.departmentFull  || id.department || '',
      supervisor:      id.supervisor      || '',
      supervisorEmail: id.supervisorEmail || '',
      userEmail:       id.email           || '',
      description:     formalDesc,
      rawDescription:  rawDescription,
      recType:         'Others, Repair',
    });

    if (!saved.ok) {
      return { error: 'save_failed', message: saved.error || 'There was a problem saving your request.' };
    }

    // 8. Return success payload to Index.html for the confirmation bubble
    return {
      jrfNo:          saved.jrfNo,
      rawDesc:        rawDescription.substring(0, 120),
      name:           id.name            || '',
      departmentFull: id.departmentFull  || id.department || '',
      supervisor:     id.supervisor      || '',
    };
  } catch (err) {
    Logger.log('submitFormTicket error: ' + err + '\n' + err.stack);
    return { error: 'save_failed', message: 'Something went wrong. Please try again or contact the IT unit directly.' };
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
 * Detects keyboard-mashing / gibberish input.
 * Returns true if the text looks like random key presses rather than a real answer.
 *
 * Three checks (any one triggers gibberish = true):
 *   1. The whole string is one short repeating pattern (e.g. "asdasd", "vcvcvcvc").
 *   2. Very few unique characters relative to total length (e.g. "asdasdvcvcv" — only 5 unique chars).
 *   3. Extremely low vowel ratio for longer strings (e.g. "qwrtpsdfg").
 *   4. A run of 6+ consecutive consonants (e.g. "sdfjklqwrt").
 *
 * Short strings (< 4 chars) are never flagged — they may be abbreviations like "SSD" or "OCD".
 */
function isGibberish(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 4) return false; // too short to judge — could be a dept code

  const cleaned = trimmed.toLowerCase().replace(/[^a-z]/g, '');
  if (cleaned.length < 4) return false;

  // 1. Whole string (with up to 3 trailing chars) is one repeating 2–4 char n-gram
  //    e.g. "asdasdasd", "vcvcvcvc", "sdfsdf"
  if (cleaned.length >= 6 && /^(.{2,4})\1+.{0,3}$/.test(cleaned)) return true;

  // 2. Very few unique characters relative to length (threshold: < 40% for strings ≥ 8 chars)
  //    e.g. "asdasdasdvcvcv" — 5 unique chars out of 14 = 35.7%
  if (cleaned.length >= 8) {
    const uniqueRatio = new Set(cleaned.split('')).size / cleaned.length;
    if (uniqueRatio < 0.40) return true;
  }

  // 3. Very low vowel ratio for strings longer than 6 chars (threshold: < 10%)
  //    e.g. "qwrtpsdfg" — 0 vowels
  if (cleaned.length > 6) {
    const vowelRatio = (cleaned.match(/[aeiou]/g) || []).length / cleaned.length;
    if (vowelRatio < 0.10) return true;
  }

  // 4. Consecutive consonant run of 6 or more (e.g. "sdfjklqw")
  if (/[^aeiou]{6,}/.test(cleaned)) return true;

  return false;
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
 * @param {string} token - Dashboard session token
 */
function getTickets(token) {
  _requireDashboardAuth(token);
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
      assignedStaff:  data[i][8]  || '',
      dateCompleted:  data[i][9]  ? Utilities.formatDate(new Date(data[i][9]),  Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
      assessment:     data[i][10] || '',
      actionTaken:        data[i][11] || '',
      taskResult:         data[i][12] || '',
      targetDate:         data[i][13] ? Utilities.formatDate(new Date(data[i][13]), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
      othersDescription:  data[i][14] || '',
      serviceLocation:    data[i][15] || '',
    });
  }
  return tickets;
}

/**
 * Marks an In Progress ticket as Completed. Writes Action Taken and Task Result.
 * Assessment and Target Date are set earlier by submitAssessment().
 * Returns { ok: true } or { ok: false, error: string }.
 * @param {string} token - Dashboard session token
 */
function updateTicketStatus(token, jrfNo, actionTaken, taskResult) {
  _requireDashboardAuth(token);
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
 * @param {string} token - Dashboard session token
 */
function submitAssessment(token, jrfNo, assignedStaff, recommendation, assessment, targetDate, othersDescription, serviceLocation) {
  _requireDashboardAuth(token);
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
      sheet.getRange(i + 1, 15).setValue(othersDescription  || '');   // O — Others Description
      sheet.getRange(i + 1, 16).setValue(serviceLocation   || '');   // P — Service Location

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

    // Check token age against TTL (col E = index 4 = Created timestamp)
    if (approvalRow[4]) {
      const ageDays = (Date.now() - new Date(approvalRow[4]).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > APPROVAL_TOKEN_TTL_DAYS) {
        return approvalHtmlPage(
          'Link Expired',
          'This approval link has expired (links are valid for ' + APPROVAL_TOKEN_TTL_DAYS + ' days). ' +
          'Please contact the IT Unit to resend the request if still needed.'
        );
      }
    }

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
    aSheet.appendRow(['Token', 'JRF#', 'Type', 'Used', 'Created']);
    aSheet.setFrozenRows(1);
  }
  // Col E (index 4) — ISO timestamp used to enforce APPROVAL_TOKEN_TTL_DAYS expiry
  aSheet.appendRow([token, jrfNo, type, '', new Date().toISOString()]);

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
      (ticket.recommendation ? divider + 'Recommendation Type: ' + ticket.recommendation + '\n' : '') +
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
 * Returns { supervisorName, supervisorEmail, fullName } or null if not found.
 * Matches on col A (abbreviated code) OR col D (full office name).
 *
 * Sheet columns: A = Department/Office | B = Supervisor Name | C = Supervisor Email | D = Full Name
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
      const abbrev   = String(data[i][0] || '').toLowerCase().trim();
      const fullName = String(data[i][3] || '').toLowerCase().trim();
      if (abbrev === lower || fullName === lower) {
        return {
          supervisorName:  String(data[i][1] || ''),
          supervisorEmail: String(data[i][2] || ''),
          fullName:        String(data[i][3] || ''),
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
 * Resolves supervisor name + email from a department code.
 * Falls back to the Campus Director for Chief-level positions
 * when the department code has no matching entry in the Departments sheet.
 * This covers division heads (e.g. Milo S. Saldon, Mary Sheryl M. Saldon-Raznee,
 * Keisel Van Valerie V. Gamil) who report directly to the Campus Director.
 *
 * @param {string} position   - Employee position title (used for the Chief fallback check)
 * @param {string} department - Department/Office code from the Employees sheet
 * @returns {{ supervisorName, supervisorEmail, fullName } | null}
 */
function resolveAutoSupervisor(position, department, employeeName) {
  // 1. Try the Departments sheet first
  const deptLookup = lookupDepartment(department);
  if (deptLookup && deptLookup.supervisorName) {
    // If the Departments sheet lists this employee as their OWN department's supervisor,
    // they are a division head (e.g. Milo S. Saldon, Mary Sheryl M. Saldon-Raznee,
    // Keisel Van Valerie V. Gamil) — their supervisor is the Campus Director, not themselves.
    const isSelf = employeeName &&
      deptLookup.supervisorName.toLowerCase().trim() === String(employeeName).toLowerCase().trim();
    if (!isSelf) return deptLookup;
    // Fall through to Campus Director
  }

  // 2. Fall back to the Campus Director when no Departments entry is found,
  //    or when the employee IS the listed supervisor (division head).
  const directorEmail = PropertiesService.getScriptProperties().getProperty('DIRECTOR_EMAIL') || '';
  return {
    supervisorName:  'Edman H. Gallamaso',
    supervisorEmail: directorEmail,
    fullName:        'Campus Director',
  };
}

/**
 * Returns the identity of the currently signed-in user by reading their Google
 * account email and looking it up in the Employees sheet (col D).
 * Called from Index.html on page load via google.script.run.
 *
 * Returns one of:
 *   { email, name, position, department, departmentFull, supervisor, supervisorEmail }
 *   { error: 'not_signed_in' }
 *   { error: 'wrong_domain', domain }
 *   { error: 'not_in_employees', email }
 */
function getUserIdentity() {
  try {
    const email = Session.getActiveUser().getEmail();
    if (!email) return { error: 'not_signed_in' };

    // Optional domain restriction
    const allowedDomain = PropertiesService.getScriptProperties().getProperty('ALLOWED_DOMAIN') || '';
    if (allowedDomain && !email.toLowerCase().endsWith('@' + allowedDomain.toLowerCase())) {
      return { error: 'wrong_domain', domain: allowedDomain };
    }

    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Employees');
    if (!sheet) return { error: 'not_in_employees', email };

    const data       = sheet.getDataRange().getValues();
    const emailLower = email.toLowerCase().trim();

    for (let i = 1; i < data.length; i++) {
      const rowEmail = String(data[i][3] || '').toLowerCase().trim(); // col D
      if (rowEmail !== emailLower) continue;

      const name     = String(data[i][0] || '');
      const position = String(data[i][1] || '');
      const deptCode = String(data[i][2] || '');

      // Resolve supervisor and full department name from Departments sheet
      const deptLookup = lookupDepartment(deptCode);
      let supervisorName  = '';
      let supervisorEmail = '';
      let departmentFull  = deptCode; // fallback

      if (deptLookup) {
        // Self-reference check: if this employee IS the listed supervisor, use Director
        const isSelf = deptLookup.supervisorName &&
          deptLookup.supervisorName.toLowerCase().trim() === name.toLowerCase().trim();
        if (isSelf) {
          supervisorName  = 'Edman H. Gallamaso';
          supervisorEmail = PropertiesService.getScriptProperties().getProperty('DIRECTOR_EMAIL') || '';
        } else {
          supervisorName  = deptLookup.supervisorName;
          supervisorEmail = deptLookup.supervisorEmail;
        }
        departmentFull = deptLookup.fullName || deptCode;
      } else {
        // No Departments entry → use Campus Director
        supervisorName  = 'Edman H. Gallamaso';
        supervisorEmail = PropertiesService.getScriptProperties().getProperty('DIRECTOR_EMAIL') || '';
      }

      Logger.log('getUserIdentity: found ' + name + ' <' + email + '>');
      return {
        email:          email,
        name:           name,
        position:       position,
        department:     deptCode,
        departmentFull: departmentFull,
        supervisor:     supervisorName,
        supervisorEmail: supervisorEmail,
      };
    }

    // Email not found in Employees sheet
    Logger.log('getUserIdentity: email not in Employees sheet: ' + email);
    return { error: 'not_in_employees', email: email };
  } catch (err) {
    console.error('getUserIdentity error: ' + err);
    return { error: 'not_signed_in' };
  }
}

/**
 * Returns the signed-in user's email and whether they are an authorized IT staff member.
 * Called from Dashboard.html on page load.
 */
function getDashboardUser() {
  try {
    const email = Session.getActiveUser().getEmail();
    if (!email) return { email: '', authorized: false };
    const allowedEmails = (PropertiesService.getScriptProperties().getProperty('IT_STAFF_EMAIL') || '')
      .split(',').map(function(e) { return e.trim().toLowerCase(); }).filter(Boolean);
    return { email: email, authorized: allowedEmails.includes(email.toLowerCase().trim()) };
  } catch (err) {
    console.error('getDashboardUser error: ' + err);
    return { email: '', authorized: false };
  }
}

/**
 * Returns recent ticket status updates for a given requester email (col R).
 * Only returns tickets not in 'Pending Supervisor Approval' status.
 * Used by the chatbot to show status updates when user opens the page.
 *
 * @param {string} email - Requester's Google account email
 * @returns {Array} Up to 5 most recent tickets with status changes
 */
function getTicketUpdates(email) {
  try {
    if (!email) return [];
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(ITJRF_SHEET_NAME);
    if (!sheet) return [];

    const data    = sheet.getDataRange().getValues();
    const results = [];
    const emailLower = email.toLowerCase().trim();

    for (let i = 1; i < data.length; i++) {
      const rowEmail = String(data[i][17] || '').toLowerCase().trim(); // col R
      if (rowEmail !== emailLower) continue;
      const status = String(data[i][7] || '');
      if (status === 'Pending Supervisor Approval') continue;

      results.push({
        jrfNo:         String(data[i][0]),
        problem:       String(data[i][5] || ''),
        status:        status,
        assignedStaff: String(data[i][8]  || ''),
        targetDate:    data[i][13] ? Utilities.formatDate(new Date(data[i][13]), Session.getScriptTimeZone(), 'MM/dd/yyyy') : '',
        dateCompleted: data[i][9]  ? Utilities.formatDate(new Date(data[i][9]),  Session.getScriptTimeZone(), 'MM/dd/yyyy') : '',
      });
    }

    // Sort by JRF # descending, return top 5
    results.sort(function(a, b) { return Number(b.jrfNo) - Number(a.jrfNo); });
    return results.slice(0, 5);
  } catch (err) {
    console.error('getTicketUpdates error: ' + err);
    return [];
  }
}

/**
 * Returns ALL tickets for a given requester email (col R), all statuses.
 * Used by the My Tickets panel in the chatbot UI.
 *
 * @param {string} email - Requester's Google account email
 * @returns {Array} All tickets for this email, sorted by JRF # descending
 */
function getMyTickets(email) {
  try {
    if (!email) return [];
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(ITJRF_SHEET_NAME);
    if (!sheet) return [];

    const data    = sheet.getDataRange().getValues();
    const results = [];
    const emailLower = email.toLowerCase().trim();

    for (let i = 1; i < data.length; i++) {
      const rowEmail = String(data[i][17] || '').toLowerCase().trim(); // col R
      if (rowEmail !== emailLower) continue;
      results.push({
        jrfNo:          String(data[i][0]),
        date:           data[i][1] ? Utilities.formatDate(new Date(data[i][1]), Session.getScriptTimeZone(), 'MM/dd/yyyy') : '',
        problem:        String(data[i][5] || ''),
        status:         String(data[i][7] || ''),
        recommendation: String(data[i][6] || ''),
        assignedStaff:  String(data[i][8]  || ''),
        targetDate:     data[i][13] ? Utilities.formatDate(new Date(data[i][13]), Session.getScriptTimeZone(), 'MM/dd/yyyy') : '',
        dateCompleted:  data[i][9]  ? Utilities.formatDate(new Date(data[i][9]),  Session.getScriptTimeZone(), 'MM/dd/yyyy') : '',
      });
    }

    results.sort(function(a, b) { return Number(b.jrfNo) - Number(a.jrfNo); });
    return results;
  } catch (err) {
    console.error('getMyTickets error: ' + err);
    return [];
  }
}

/**
 * Looks up an employee by name in the Employees sheet.
 * Returns { position, department, matchedName, fuzzy } or null if not found.
 *
 * Matching strategy:
 *   1. Exact match (case-insensitive).
 *   2. Fuzzy match — if the user typed ≥2 words, check whether every typed word appears
 *      in the employee's name words. Only used when exactly 1 candidate is found
 *      (avoids false positives when multiple employees share a word).
 *
 * Sheet columns: A = Name | B = Position | C = Department/Office
 * Department/Office in col C should match the abbreviated code in the Departments sheet col A.
 */
function lookupEmployee(name) {
  if (!name) return null;
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Employees');
    if (!sheet) return null;
    const data  = sheet.getDataRange().getValues();
    const lower = String(name).toLowerCase().trim();

    // Helper: normalize a name string into an array of lowercase word tokens
    const tokenize = str => String(str).toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);

    // 1. Exact match
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase().trim() === lower) {
        return {
          matchedName: String(data[i][0]),
          position:    String(data[i][1] || ''),
          department:  String(data[i][2] || ''),
          fuzzy:       false,
        };
      }
    }

    // 2. Fuzzy match — only attempt when the user typed ≥2 words
    const inputWords = tokenize(lower);
    if (inputWords.length < 2) return null;

    const candidates = [];
    for (let i = 1; i < data.length; i++) {
      const empWords = tokenize(data[i][0]);
      // All words the user typed must appear somewhere in the employee's name
      if (inputWords.every(w => empWords.includes(w))) {
        candidates.push(i);
      }
    }

    // Only auto-fill if exactly one candidate — multiple matches are ambiguous
    if (candidates.length !== 1) return null;

    const idx = candidates[0];
    return {
      matchedName: String(data[idx][0]),
      position:    String(data[idx][1] || ''),
      department:  String(data[idx][2] || ''),
      fuzzy:       true,
    };
  } catch (err) {
    Logger.log('lookupEmployee error: ' + err);
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
 * @param {string} token - Dashboard session token
 */
function updateTicketDetails(token, jrfNo, name, position, supervisor, problem) {
  _requireDashboardAuth(token);
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
 * @param {string} token - Dashboard session token
 */
function assignStaff(token, jrfNo, staffName) {
  _requireDashboardAuth(token);
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
 * @param {string} authToken - Dashboard session token (named authToken to avoid
 *                             collision with the internal OAuth token variable)
 */
function generateFormPdf(authToken, jrfNo) {
  _requireDashboardAuth(authToken);
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
    serviceLocation:    row[15] || '',
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

  // Service location checkboxes (row 21)
  const locationMap = {
    'In-Campus Repair':                 'F21',
    'External Service Provider Repair': 'J21',
  };
  const locationCell = locationMap[ticket.serviceLocation];
  if (locationCell) {
    const r = temp.getRange(locationCell);
    r.setValue('✓');
    r.setHorizontalAlignment('center');
    r.setVerticalAlignment('middle');
  }

  // Recommendation type checkboxes (rows 23-24)
  const checkboxMap = {
    'Hardware Repair':        'C23',
    'Hardware Installation':  'F23',
    'Network Connection':     'J23',
    'Preventive Maintenance': 'O23',
    'Software Development':   'C24',
    'Software Modification':  'F24',
    'Software Installation':  'J24',
    'Others, Repair':         'O24',
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


// =============================================================================
// Operational / Maintenance Functions
// =============================================================================

/**
 * Sends overdue ticket reminder emails to assigned IT staff.
 * A ticket is overdue when: status = 'In Progress' AND target date is set AND before today.
 * Set up as a daily time-driven trigger (8:00–9:00 AM).
 * Skip if CacheService key 'overdue_reminded_[jrfNo]' exists (20-hour TTL).
 */
function sendOverdueReminders() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ITJRF_SHEET_NAME);
  if (!sheet) return;

  const data    = sheet.getDataRange().getValues();
  const today   = new Date();
  const cache   = CacheService.getScriptCache();
  const itEmail = PropertiesService.getScriptProperties().getProperty('IT_STAFF_EMAIL') || '';
  let   count   = 0;

  for (let i = 1; i < data.length; i++) {
    const status     = String(data[i][7] || '');
    const targetDate = data[i][13];
    if (status !== 'In Progress' || !targetDate) continue;

    const target = new Date(targetDate);
    if (target >= today) continue; // not yet overdue

    const jrfNo    = String(data[i][0]);
    const cacheKey = 'overdue_reminded_' + jrfNo;
    if (cache.get(cacheKey)) continue; // already reminded recently

    const name       = String(data[i][2] || '');
    const problem    = String(data[i][5] || '');
    const assignedTo = String(data[i][8] || '');
    const daysOver   = Math.floor((today - target) / 86400000);

    if (itEmail) {
      try {
        MailApp.sendEmail(
          itEmail,
          'Overdue IT Ticket — ' + jrfNo,
          'The following IT Job Request is overdue:\n\n' +
          'JRF #:        ' + jrfNo      + '\n' +
          'Requester:    ' + name        + '\n' +
          'Problem:      ' + problem     + '\n' +
          'Target Date:  ' + Utilities.formatDate(target, Session.getScriptTimeZone(), 'MM/dd/yyyy') + '\n' +
          'Days Overdue: ' + daysOver    + '\n' +
          'Assigned To:  ' + (assignedTo || 'Unassigned') + '\n\n' +
          'Please update the ticket status on the IT Dashboard.'
        );
        cache.put(cacheKey, '1', 72000); // 20-hour TTL
        count++;
      } catch (emailErr) {
        Logger.log('sendOverdueReminders email error: ' + emailErr);
      }
    }
  }
  Logger.log('sendOverdueReminders: ' + count + ' reminder(s) sent');
}

/**
 * Deletes Approvals sheet rows older than 30 days.
 * Set up as a weekly time-driven trigger (Monday, 2:00–3:00 AM).
 */
function cleanupApprovalTokens() {
  const ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  const aSheet = ss.getSheetByName(APPROVALS_SHEET_NAME);
  if (!aSheet) return;

  const data    = aSheet.getDataRange().getValues();
  const cutoff  = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago
  let   deleted = 0;

  // Iterate from bottom to preserve row indices when deleting
  for (let i = data.length - 1; i >= 1; i--) {
    const created = data[i][4]; // col E
    if (!created) continue;
    if (new Date(created).getTime() < cutoff) {
      aSheet.deleteRow(i + 1);
      deleted++;
    }
  }
  Logger.log('cleanupApprovalTokens: deleted ' + deleted + ' old token(s)');
}

/**
 * Moves Completed/Rejected tickets older than 90 days to an Archive sheet.
 * Creates Archive sheet if it doesn't exist.
 * Set up as a monthly time-driven trigger (1st of month, 3:00–4:00 AM).
 */
function archiveOldTickets() {
  const ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tSheet = ss.getSheetByName(ITJRF_SHEET_NAME);
  if (!tSheet) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  // Get or create Archive sheet
  let aSheet = ss.getSheetByName('Archive');
  if (!aSheet) {
    aSheet = ss.insertSheet('Archive');
    // Copy header row
    const headers = tSheet.getRange(1, 1, 1, tSheet.getLastColumn()).getValues();
    aSheet.appendRow(headers[0]);
    aSheet.setFrozenRows(1);
  }

  const data     = tSheet.getDataRange().getValues();
  let   archived = 0;

  // Iterate from bottom so row indices stay valid
  for (let i = data.length - 1; i >= 1; i--) {
    const status = String(data[i][7] || '');
    const date   = data[i][1];
    if (!date) continue;
    if (status !== 'Completed' && status !== 'Rejected') continue;
    if (new Date(date).getTime() >= cutoff.getTime()) continue;

    aSheet.appendRow(data[i]);
    tSheet.deleteRow(i + 1);
    archived++;
  }
  Logger.log('archiveOldTickets: archived ' + archived + ' ticket(s)');
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