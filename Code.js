// ╔══════════════════════════════════════════════════════════════╗
// ║   BIDDERSHUB — DLSL Central Procurement Bidding Portal        ║
// ║   Public bid board · Vendor accreditation · Inquiries (Q&A)   ║
// ║   Auth: Email + OTP (2FA) for staff and vendors                ║
// ╚══════════════════════════════════════════════════════════════╝
//
// This is a STANDALONE Apps Script project bound by ID to its own
// spreadsheet — it does NOT read from or write to the DLSP Shared
// Supplier Database. See SPREADSHEET_ID below.

const SPREADSHEET_ID = '1M4Ns7GIO4veZ4rUgCUygjRBe2n-Wx_CdzZ1vZBsSprM';

const SH = {
  USERS:     'Users',
  VENDORS:   'Vendors',
  BIDS:      'BidOpportunities',
  INQUIRIES: 'Inquiries',
  AUDIT:     'AuditLog',
  CONFIG:    'Config',
};

const USER_HEADERS    = ['UserID','Email','FullName','Role','Department','Status','AddedBy','AddedOn'];
const VENDOR_HEADERS  = ['VendorID','AccreditationNo','CompanyName','TradeName','BusinessCategory','TINNumber','DTISECReg','ContactPerson','ContactNumber','Email','Address','Documents','AccreditationStatus','SubmittedOn','ReviewedBy','ReviewedOn','ReviewNotes','ExpiryDate','LastUpdated'];
const BID_HEADERS     = ['BidID','ReferenceNo','Title','Description','Category','Department','ProponentEmail','EstimatedBudget','Documents','SubmissionDeadline','Status','SubmittedOn','ApprovedBy','ApprovedOn','PublishedOn','ClosedOn','Outcome','ReviewNotes','CreatedBy','CreatedOn','LastModified','ViewCount'];
const INQUIRY_HEADERS = ['InquiryID','BidID','VendorEmail','VendorName','Question','SubmittedOn','Response','RespondedBy','RespondedOn','Status'];
const AUDIT_HEADERS   = ['LogID','Timestamp','ActorEmail','ActorRole','Action','EntityType','EntityID','Details'];

const CATEGORIES = [
  'Goods & Supplies', 'Infrastructure & Construction', 'Consulting Services',
  'IT & Technology', 'Janitorial & Security Services', 'Food & Catering',
  'Printing & Publication', 'Transportation & Logistics', 'Other',
];

// Philippine procurement vendor accreditation checklist (RA 9184 IRR / PhilGEPS-aligned).
// Each document type gets its own single-file upload slot — one file per slot, no bulk dump —
// so the CPD reviewer can immediately identify which document is which.
const DOCUMENT_TYPES = [
  { key: 'dtiSecCda',    label: 'DTI / SEC / CDA Registration Certificate', hint: 'DTI (sole proprietorship), SEC (corporation/partnership), or CDA (cooperative)', required: true },
  { key: 'mayorsPermit', label: "Mayor's / Business Permit",                hint: 'Current year, issued by the city/municipality where the business operates', required: true },
  { key: 'birCor',       label: 'BIR Certificate of Registration (Form 2303)', hint: '', required: true },
  { key: 'taxClearance', label: 'Tax Clearance Certificate',                hint: 'Per Executive Order No. 398', required: true },
  { key: 'omnibusSworn', label: 'Omnibus Sworn Statement',                  hint: 'Notarized, per RA 9184 IRR Annex H', required: false },
  { key: 'philgepsCert', label: 'PhilGEPS Registration Certificate',        hint: 'Platinum membership, if available', required: false },
  { key: 'auditedFS',    label: 'Latest Audited Financial Statement',       hint: 'Stamped "received" by BIR', required: false },
];

function getDocumentTypes() { return DOCUMENT_TYPES; }

// Standard Philippine bid bulletin package (RA 9184 IRR-aligned). Same
// one-file-per-slot pattern as vendor accreditation — a bid posting is a
// specific, named set of documents, not a bulk attachment dump.
const BID_DOCUMENT_TYPES = [
  { key: 'rfqItb',              label: 'Request for Quotation / Invitation to Bid', hint: 'The formal RFQ or ITB document', required: true },
  { key: 'tor',                 label: 'Terms of Reference / Technical Specifications', hint: '', required: true },
  { key: 'boq',                 label: 'Bill of Quantities / Price Schedule',        hint: 'For goods and infrastructure procurement', required: false },
  { key: 'bidForm',             label: 'Bid Form / Price Quotation Form',           hint: 'The form suppliers fill in when submitting a bid', required: false },
  { key: 'eligibilityChecklist',label: 'Eligibility Requirements Checklist',        hint: 'Per RA 9184 IRR', required: false },
  { key: 'draftContract',       label: 'Draft Contract / Purchase Order',           hint: '', required: false },
  { key: 'plansSpecs',          label: 'Plans / Drawings / Specifications',         hint: 'For infrastructure or construction projects, if applicable', required: false },
];

function getBidDocumentTypes() { return BID_DOCUMENT_TYPES; }

const SESSION_TTL_MS  = 8 * 60 * 60 * 1000; // 8 hours
const APP_TOKEN_TTL_MS = 60 * 60 * 1000;    // 1 hour to finish an accreditation application after verifying email
const CACHE_TTL_S    = 300;                 // 5 min
const CACHE_BIDS     = 'cache_bids_v1';

// ── PROPERTIES SERVICE SCHEMA (for audit reference) ───────────
// ScriptProperties keys managed by this application:
//   sess_<token>   — Session object: { username, expiry, profile }
//   otp_<email>    — OTP entry: { code, expiry } (single-use, deleted on verify)
// CacheService keys (script-scoped, auto-expires):
//   chk_<email>       — Cached login profile from checkAccess (TTL: 900s)
//   cache_bids_v1     — Published/Closed bid opportunities (TTL: 300s)
// ──────────────────────────────────────────────────────────────

// ── WEB APP ENTRY ─────────────────────────────────────────────
function doGet(e) {
  return HtmlService
    .createTemplateFromFile('index')
    .evaluate()
    .setTitle('BiddersHub — DLSL Procurement Portal')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getCategories() { return CATEGORIES; }

// ── SPREADSHEET HELPERS ────────────────────────────────────────
function _ss() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

function getSheet(name) {
  const ss = _ss();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function _rowFromObj(headers, obj) {
  return headers.map(h => obj[h] !== undefined ? obj[h] : '');
}

function _findRowIndex(sheet, idColName, idValue) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return -1;
  const h = data[0];
  const iId = h.indexOf(idColName);
  for (let i = 1; i < data.length; i++) {
    if (data[i][iId] === idValue) return i + 1; // 1-based row index
  }
  return -1;
}

function _rowObjectAt(sheet, headers, rowIndex1) {
  const values = sheet.getRange(rowIndex1, 1, 1, headers.length).getValues()[0];
  const obj = {};
  headers.forEach((h, i) => obj[h] = values[i]);
  return obj;
}

function _writeRowObject(sheet, headers, rowIndex1, obj) {
  sheet.getRange(rowIndex1, 1, 1, headers.length).setValues([_rowFromObj(headers, obj)]);
}

function _safeParseJSON(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch (e) { return fallback; }
}

// ── CACHE HELPERS ──────────────────────────────────────────────
function _cacheGet(key) {
  try {
    const raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function _cacheSet(key, value, ttl) {
  try {
    const str = JSON.stringify(value);
    if (str.length < 90000) CacheService.getScriptCache().put(key, str, ttl || CACHE_TTL_S);
  } catch (e) { /* cache miss is always safe */ }
}

function _cacheClear() {
  try { CacheService.getScriptCache().removeAll([CACHE_BIDS]); } catch (e) { console.error('cache clear failed:', e); }
}

// ── SESSION MANAGEMENT ─────────────────────────────────────────
function createSession(username, userProfile) {
  const token  = Utilities.getUuid().replace(/-/g, '') + Date.now().toString(36);
  const expiry = Date.now() + SESSION_TTL_MS;
  PropertiesService.getScriptProperties().setProperty(
    'sess_' + token, JSON.stringify({ username, expiry, profile: userProfile })
  );
  return token;
}

function resolveSession(token) {
  if (!token) return null;
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('sess_' + token);
    if (!raw) return null;
    const sess = JSON.parse(raw);
    if (Date.now() > sess.expiry) {
      PropertiesService.getScriptProperties().deleteProperty('sess_' + token);
      return null;
    }
    return sess.profile;
  } catch (e) { return null; }
}

function destroySession(token) {
  if (!token) return;
  PropertiesService.getScriptProperties().deleteProperty('sess_' + token);
}

// Run manually from the editor if needed: cleanExpiredSessions()
function cleanExpiredSessions() {
  try {
    const props = PropertiesService.getScriptProperties().getProperties();
    let removed = 0;
    Object.keys(props).forEach(k => {
      if (!k.startsWith('sess_')) return;
      try {
        const d = JSON.parse(props[k]);
        if (Date.now() > d.expiry) { PropertiesService.getScriptProperties().deleteProperty(k); removed++; }
      } catch (e) { PropertiesService.getScriptProperties().deleteProperty(k); removed++; }
    });
    console.log('Cleaned ' + removed + ' expired sessions.');
  } catch (e) { console.error('cleanExpiredSessions failed:', e); }
}

function requireAuth(token) {
  const user = resolveSession(token);
  if (!user) throw new Error('Session expired. Please log in again.');
  return user;
}

function isCPD(user)   { return ['cpd_admin', 'cpd_officer'].includes(user.role); }
function isAdmin(user) { return user.role === 'cpd_admin'; }

// ── EMAIL OTP AUTH ─────────────────────────────────────────────
function _maskEmail(email) {
  if (!email || !email.includes('@')) return email;
  return email.charAt(0) + '****@' + email.split('@')[1];
}

function _isValidEmail(email) {
  return !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * checkAccess(email) — Step 1 of login (sheet reads only, no email sent).
 * Looks up email among staff (Users) first, then vendors (Vendors).
 * Returns step: 'otp' | 'denied' | 'new_vendor'
 */
function checkAccess(email) {
  const normalized = (email || '').trim().toLowerCase();
  if (!_isValidEmail(normalized)) {
    return { success: false, message: 'Please enter a valid email address.' };
  }

  // 1. Staff lookup
  const uData = getSheet(SH.USERS).getDataRange().getValues();
  if (uData.length > 1) {
    const h = uData[0];
    const iEmail = h.indexOf('Email'), iStatus = h.indexOf('Status');
    for (let i = 1; i < uData.length; i++) {
      if ((uData[i][iEmail] || '').toString().toLowerCase() === normalized) {
        if (uData[i][iStatus] === 'Active') {
          const user = {
            userID:     uData[i][h.indexOf('UserID')],
            fullName:   uData[i][h.indexOf('FullName')],
            role:       uData[i][h.indexOf('Role')],
            department: uData[i][h.indexOf('Department')],
            email:      uData[i][iEmail],
            accountType: 'staff',
          };
          _cacheSet('chk_' + normalized, user, 900);
          return { success: true, step: 'otp', maskedEmail: _maskEmail(normalized) };
        }
        return { success: false, step: 'denied', message: 'Your staff account is inactive. Contact the CPD administrator.' };
      }
    }
  }

  // 2. Vendor lookup (any accreditation status — they can still log in to check status)
  const vData = getSheet(SH.VENDORS).getDataRange().getValues();
  if (vData.length > 1) {
    const h = vData[0];
    const iEmail = h.indexOf('Email');
    for (let i = 1; i < vData.length; i++) {
      if ((vData[i][iEmail] || '').toString().toLowerCase() === normalized) {
        const user = {
          vendorID:    vData[i][h.indexOf('VendorID')],
          fullName:    vData[i][h.indexOf('ContactPerson')],
          companyName: vData[i][h.indexOf('CompanyName')],
          role:        'vendor',
          vendorStatus: vData[i][h.indexOf('AccreditationStatus')],
          email:       vData[i][iEmail],
          accountType: 'vendor',
        };
        _cacheSet('chk_' + normalized, user, 900);
        return { success: true, step: 'otp', maskedEmail: _maskEmail(normalized) };
      }
    }
  }

  // 3. Not on file — offer the accreditation application form
  return { success: false, step: 'new_vendor' };
}

/**
 * sendOTP(email) — Step 2 of login. Uses the cache populated by checkAccess
 * when available, otherwise re-verifies against the sheets first.
 */
function sendOTP(email) {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return { success: false, message: 'Invalid session.' };
  if (!_cacheGet('chk_' + normalized)) {
    const check = checkAccess(email);
    if (check.step !== 'otp') {
      return { success: false, message: 'Account not found or not active. Please enter your email again.' };
    }
  }
  return _dispatchOTP(normalized);
}

function _dispatchOTP(email) {
  const propKey = 'otp_' + email;
  const existing = PropertiesService.getScriptProperties().getProperty(propKey);
  if (existing) {
    try {
      const d = JSON.parse(existing);
      if (d.expiry - Date.now() > 540000) {
        return { success: false, rateLimited: true, message: 'Please wait before requesting another code.' };
      }
    } catch (e) { console.error('_dispatchOTP: failed to parse existing OTP:', e); }
  }

  const code   = Math.floor(100000 + Math.random() * 900000).toString();
  const expiry = Date.now() + 600000; // 10 minutes
  PropertiesService.getScriptProperties().setProperty(propKey, JSON.stringify({ code, expiry }));

  try {
    MailApp.sendEmail({
      to: email,
      subject: 'BiddersHub — Your Access Code',
      body:
        'Your 6-digit access code is: ' + code + '\n\n' +
        'This code expires in 10 minutes.\n\n' +
        'If you did not request this code, please ignore this email.\n\n' +
        '— DLSL Central Procurement Department · BiddersHub',
    });
  } catch (e) {
    console.error('_dispatchOTP: MailApp.sendEmail failed for ' + email + ':', e);
    return { success: false, message: 'Failed to send the verification email. Please try again.' };
  }

  return { success: true, maskedEmail: _maskEmail(email) };
}

/**
 * verifyOTP(email, code) — Step 2 of EXISTING-account login (staff or an
 * already-registered vendor). Validates the OTP and creates a session.
 * New vendor applications never go through this — see startVendorVerification
 * / confirmVendorEmail below, which verify the email BEFORE any Vendor row
 * exists or any document can be uploaded.
 */
function verifyOTP(email, code) {
  const normalized  = (email || '').trim().toLowerCase();
  const trimmedCode = (code || '').trim();

  if (!normalized) return { success: false, message: 'Invalid session. Please start again.' };
  if (!/^\d{6}$/.test(trimmedCode)) return { success: false, message: 'Please enter a valid 6-digit code.' };

  const propKey = 'otp_' + normalized;
  const raw = PropertiesService.getScriptProperties().getProperty(propKey);
  if (!raw) return { success: false, message: 'No verification code found. Please request a new one.' };

  let otpData;
  try { otpData = JSON.parse(raw); }
  catch (e) { return { success: false, message: 'Code data corrupted. Please request a new one.' }; }

  if (Date.now() > otpData.expiry) {
    PropertiesService.getScriptProperties().deleteProperty(propKey);
    return { success: false, message: 'Code expired. Please request a new one.' };
  }
  if (otpData.code !== trimmedCode) return { success: false, message: 'Incorrect code. Please try again.' };

  PropertiesService.getScriptProperties().deleteProperty(propKey);

  let user = _cacheGet('chk_' + normalized);
  if (!user) {
    const check = checkAccess(normalized);
    if (check.step !== 'otp') return { success: false, message: 'Account not found. Please start again.' };
    user = _cacheGet('chk_' + normalized);
  }
  if (!user) return { success: false, message: 'Account not found.' };

  const token = createSession(normalized, user);
  _logRaw(user, 'LOGIN', 'Session', user.userID || user.vendorID, 'Logged in via Email OTP');
  return { success: true, token, user };
}

function logout(token) {
  destroySession(token);
  return { success: true };
}

// ── NEW VENDOR EMAIL VERIFICATION (must happen BEFORE any upload) ─────
/**
 * startVendorVerification(email) — Step 1 of a NEW (or re-applying) vendor
 * application. Sends an OTP without creating any Vendor row and without
 * allowing any upload yet — verification always comes first.
 */
function startVendorVerification(email) {
  const normalized = (email || '').trim().toLowerCase();
  if (!_isValidEmail(normalized)) return { success: false, message: 'Please enter a valid email address.' };

  const vSheet = getSheet(SH.VENDORS);
  const rowIndex = _findRowIndex(vSheet, 'Email', normalized);
  if (rowIndex !== -1) {
    const status = _rowObjectAt(vSheet, VENDOR_HEADERS, rowIndex).AccreditationStatus;
    if (['Pending', 'Approved'].includes(status)) {
      return { success: false, message: 'An accreditation record already exists for this email (status: ' + status + '). Contact the CPD to make changes.' };
    }
  }
  return _dispatchOTP(normalized);
}

/**
 * confirmVendorEmail(email, code) — Step 2. Validates the OTP and issues a
 * short-lived application token (NOT a login session) proving this email is
 * verified. Every subsequent upload and the final submission are gated by
 * this token instead of the raw email, so nothing can be uploaded or
 * submitted under an address nobody has proven ownership of.
 */
function confirmVendorEmail(email, code) {
  const normalized  = (email || '').trim().toLowerCase();
  const trimmedCode = (code || '').trim();
  if (!normalized) return { success: false, message: 'Invalid session. Please start again.' };
  if (!/^\d{6}$/.test(trimmedCode)) return { success: false, message: 'Please enter a valid 6-digit code.' };

  const propKey = 'otp_' + normalized;
  const raw = PropertiesService.getScriptProperties().getProperty(propKey);
  if (!raw) return { success: false, message: 'No verification code found. Please request a new one.' };

  let otpData;
  try { otpData = JSON.parse(raw); }
  catch (e) { return { success: false, message: 'Code data corrupted. Please request a new one.' }; }

  if (Date.now() > otpData.expiry) {
    PropertiesService.getScriptProperties().deleteProperty(propKey);
    return { success: false, message: 'Code expired. Please request a new one.' };
  }
  if (otpData.code !== trimmedCode) return { success: false, message: 'Incorrect code. Please try again.' };
  PropertiesService.getScriptProperties().deleteProperty(propKey);

  const appToken = Utilities.getUuid().replace(/-/g, '') + Date.now().toString(36);
  const expiry = Date.now() + APP_TOKEN_TTL_MS;
  PropertiesService.getScriptProperties().setProperty('apptoken_' + appToken, JSON.stringify({ email: normalized, expiry }));
  return { success: true, appToken };
}

function _resolveAppToken(appToken) {
  if (!appToken) throw new Error('Your email verification has expired. Please verify your email again.');
  const raw = PropertiesService.getScriptProperties().getProperty('apptoken_' + appToken);
  if (!raw) throw new Error('Your email verification has expired. Please verify your email again.');
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { throw new Error('Your email verification has expired. Please verify your email again.'); }
  if (Date.now() > data.expiry) {
    PropertiesService.getScriptProperties().deleteProperty('apptoken_' + appToken);
    throw new Error('Your email verification has expired. Please verify your email again.');
  }
  return data.email;
}

// ── FILE UPLOADS (Drive) ───────────────────────────────────────
const ALLOWED_UPLOAD_MIME = ['application/pdf'];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

// Vendor accreditation and bid documents are stored in a folder the script creates
// itself. Using drive.file scope (not full drive) deliberately — it needs no Google
// Workspace admin approval, unlike full Drive access which DLSL's domain was blocking
// for this unverified internal script. The folder can be freely renamed/moved/shared
// afterward in Drive; that doesn't require any re-authorization.
const UPLOAD_FOLDER_NAME = 'BiddersHub Documents';

function _getOrCreateUploadFolder() {
  const it = DriveApp.getFoldersByName(UPLOAD_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(UPLOAD_FOLDER_NAME);
}

function _uploadFile(base64Data, filename, mimeType) {
  if (ALLOWED_UPLOAD_MIME.indexOf(mimeType) === -1) throw new Error('Unsupported file type: ' + mimeType);
  const bytes = Utilities.base64Decode(base64Data);
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('File exceeds the 10MB limit.');
  const blob = Utilities.newBlob(bytes, mimeType, filename);
  const folder = _getOrCreateUploadFolder();
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { name: filename, url: file.getUrl(), fileId: file.getId() };
}

/**
 * Requires a verified-email application token (see confirmVendorEmail) —
 * this is what actually enforces "verify before upload": there is no path
 * to this function that accepts an unverified email.
 */
function uploadVendorDocument(appToken, base64Data, filename, mimeType) {
  _resolveAppToken(appToken);
  return _uploadFile(base64Data, filename, mimeType);
}

/** Used by an already-logged-in vendor updating documents after a ChangesRequested review. */
function uploadVendorDocumentAuthenticated(token, base64Data, filename, mimeType) {
  const user = requireAuth(token);
  if (user.role !== 'vendor') throw new Error('Vendor authorization required.');
  return _uploadFile(base64Data, filename, mimeType);
}

/** Used by staff attaching bid documents — requires an active session. */
function uploadBidDocument(token, base64Data, filename, mimeType) {
  const user = requireAuth(token);
  if (!['cpd_admin', 'cpd_officer', 'proponent'].includes(user.role)) throw new Error('Not authorized.');
  return _uploadFile(base64Data, filename, mimeType);
}

// ── VENDOR ACCREDITATION APPLICATION ───────────────────────────
/**
 * submitAccreditationApplication(appToken, d) — Step 3 of a new/re-applying
 * vendor. The email was already verified in confirmVendorEmail, so this just
 * records the application and logs the vendor straight in (no second OTP
 * round-trip). Throws on validation failure.
 */
function submitAccreditationApplication(appToken, d) {
  const email = _resolveAppToken(appToken);
  if (!d.companyName || !d.companyName.trim()) throw new Error('Company name is required.');
  if (!d.contactPerson || !d.contactPerson.trim()) throw new Error('Contact person is required.');
  if (!d.contactNumber || !d.contactNumber.trim()) throw new Error('Contact number is required.');
  if (d.companyName.trim().length > 200) throw new Error('Company name is too long.');
  if (d.contactPerson.trim().length > 120) throw new Error('Contact person name is too long.');
  const docs = (d.documents && typeof d.documents === 'object') ? d.documents : {};
  const missing = DOCUMENT_TYPES.filter(t => t.required && !(docs[t.key] && docs[t.key].url)).map(t => t.label);
  if (missing.length) throw new Error('Please upload the following required documents: ' + missing.join(', ') + '.');

  const sheet = getSheet(SH.VENDORS);
  const now   = new Date().toISOString();
  const rowIndex = _findRowIndex(sheet, 'Email', email);
  let vendorId;

  if (rowIndex !== -1) {
    const existing = _rowObjectAt(sheet, VENDOR_HEADERS, rowIndex);
    if (['Pending', 'Approved'].includes(existing.AccreditationStatus)) {
      throw new Error('An accreditation record already exists for this email. Contact the CPD to make changes.');
    }
    vendorId = existing.VendorID;
    const obj = Object.assign({}, existing, {
      CompanyName: d.companyName.trim(),
      TradeName: (d.tradeName || '').trim(),
      BusinessCategory: (d.businessCategory || '').trim(),
      TINNumber: (d.tinNumber || '').trim(),
      DTISECReg: (d.dtisecReg || '').trim(),
      ContactPerson: d.contactPerson.trim(),
      ContactNumber: d.contactNumber.trim(),
      Email: email,
      Address: (d.address || '').trim(),
      Documents: JSON.stringify(docs),
      AccreditationStatus: 'Pending',
      SubmittedOn: now, ReviewedBy: '', ReviewedOn: '', ReviewNotes: '', ExpiryDate: '',
      LastUpdated: now,
    });
    _writeRowObject(sheet, VENDOR_HEADERS, rowIndex, obj);
  } else {
    vendorId = _id();
    sheet.appendRow(_rowFromObj(VENDOR_HEADERS, {
      VendorID: vendorId,
      CompanyName: d.companyName.trim(),
      TradeName: (d.tradeName || '').trim(),
      BusinessCategory: (d.businessCategory || '').trim(),
      TINNumber: (d.tinNumber || '').trim(),
      DTISECReg: (d.dtisecReg || '').trim(),
      ContactPerson: d.contactPerson.trim(),
      ContactNumber: d.contactNumber.trim(),
      Email: email,
      Address: (d.address || '').trim(),
      Documents: JSON.stringify(docs),
      AccreditationStatus: 'Pending',
      SubmittedOn: now, ReviewedBy: '', ReviewedOn: '', ReviewNotes: '', ExpiryDate: '',
      LastUpdated: now,
    }));
  }

  PropertiesService.getScriptProperties().deleteProperty('apptoken_' + appToken);

  const user = {
    vendorID: vendorId, fullName: d.contactPerson.trim(), companyName: d.companyName.trim(),
    role: 'vendor', vendorStatus: 'Pending', email, accountType: 'vendor',
  };
  const token = createSession(email, user);
  _logRaw(user, 'CREATE', 'VendorAccreditation', vendorId, 'Submitted accreditation application');
  return { success: true, token, user };
}

function _getVendorProfileByEmail(email) {
  const rows = sheetToObjects(getSheet(SH.VENDORS));
  const row = rows.find(v => (v.Email || '').toLowerCase() === (email || '').toLowerCase());
  if (!row) return null;
  return { ...row, documents: _safeParseJSON(row.Documents, {}) };
}

function getMyVendorProfile(token) {
  const user = requireAuth(token);
  if (user.role !== 'vendor') throw new Error('Vendor authorization required.');
  return { success: true, profile: _getVendorProfileByEmail(user.email) };
}

function getAccreditationApplications(token, statusFilter) {
  const user = requireAuth(token);
  if (!isCPD(user)) throw new Error('CPD authorization required.');
  let rows = sheetToObjects(getSheet(SH.VENDORS));
  if (statusFilter) rows = rows.filter(v => v.AccreditationStatus === statusFilter);
  rows.sort((a, b) => new Date(b.SubmittedOn || 0) - new Date(a.SubmittedOn || 0));
  return { success: true, vendors: rows.map(v => ({ ...v, documents: _safeParseJSON(v.Documents, {}) })) };
}

function _emailVendor(email, subject, bodyIntro) {
  try {
    MailApp.sendEmail({
      to: email,
      subject: 'BiddersHub — ' + subject,
      body: bodyIntro + '\n\n— DLSL Central Procurement Department · BiddersHub',
    });
  } catch (e) { console.error('_emailVendor failed for ' + email + ':', e); }
}

/**
 * reviewAccreditation — CPD decides on a Pending application:
 *   Approved          — assigns a permanent accreditation number
 *   Rejected          — hard stop; vendor must start a fresh application
 *   ChangesRequested  — soft stop; vendor is emailed the specific issue and
 *                       can fix/re-upload documents without re-verifying
 *                       their email (see updateVendorDocuments below)
 */
function reviewAccreditation(token, vendorId, decision, notes, expiryDate) {
  const user = requireAuth(token);
  if (!isCPD(user)) throw new Error('CPD authorization required.');
  const ALLOWED = ['Approved', 'Rejected', 'ChangesRequested'];
  if (!ALLOWED.includes(decision)) throw new Error('Invalid decision.');
  if (decision !== 'Approved' && (!notes || !notes.trim())) throw new Error('Please explain the reason for this decision.');

  const sheet = getSheet(SH.VENDORS);
  const rowIndex = _findRowIndex(sheet, 'VendorID', vendorId);
  if (rowIndex === -1) throw new Error('Vendor application not found.');
  const obj = _rowObjectAt(sheet, VENDOR_HEADERS, rowIndex);
  if (obj.AccreditationStatus !== 'Pending') throw new Error('Only pending applications can be reviewed.');

  const now = new Date().toISOString();
  obj.AccreditationStatus = decision;
  obj.ReviewedBy = user.email;
  obj.ReviewedOn = now;
  obj.ReviewNotes = notes || '';
  if (decision === 'Approved') {
    const oneYear = new Date(); oneYear.setFullYear(oneYear.getFullYear() + 1);
    obj.ExpiryDate = expiryDate || oneYear.toISOString();
    if (!obj.AccreditationNo) obj.AccreditationNo = _nextRegistryNumber('ACC');
  }
  obj.LastUpdated = now;
  _writeRowObject(sheet, VENDOR_HEADERS, rowIndex, obj);
  _logRaw(user, 'REVIEW', 'VendorAccreditation', vendorId, decision + ': ' + (notes || ''));

  if (decision === 'ChangesRequested') {
    _emailVendor(obj.Email, 'Action Needed on Your Accreditation Application',
      'The CPD has reviewed your accreditation application for ' + obj.CompanyName + ' and needs ' +
      'some corrections before it can be approved:\n\n' + notes.trim() + '\n\n' +
      'Please log in to BiddersHub and update your documents from the Accreditation Status tab.');
  }
  return { success: true };
}

/** CPD can re-send the same revision-needed reminder if a vendor hasn't acted yet. */
function resendVendorReminder(token, vendorId) {
  const user = requireAuth(token);
  if (!isCPD(user)) throw new Error('CPD authorization required.');
  const sheet = getSheet(SH.VENDORS);
  const rowIndex = _findRowIndex(sheet, 'VendorID', vendorId);
  if (rowIndex === -1) throw new Error('Vendor application not found.');
  const obj = _rowObjectAt(sheet, VENDOR_HEADERS, rowIndex);
  if (obj.AccreditationStatus !== 'ChangesRequested') throw new Error('This vendor is not currently awaiting revision.');
  _emailVendor(obj.Email, 'Reminder: Action Needed on Your Accreditation Application',
    'This is a reminder that your accreditation application for ' + obj.CompanyName + ' needs corrections:\n\n' +
    obj.ReviewNotes + '\n\nPlease log in to BiddersHub and update your documents from the Accreditation Status tab.');
  _logRaw(user, 'REMIND', 'VendorAccreditation', vendorId, 'Resent revision reminder');
  return { success: true };
}

/**
 * updateVendorDocuments — a vendor already sitting in ChangesRequested fixes
 * their details/documents and resubmits. No re-verification needed since
 * they're acting from an authenticated session, not a fresh application.
 */
function updateVendorDocuments(token, d) {
  const user = requireAuth(token);
  if (user.role !== 'vendor') throw new Error('Vendor authorization required.');
  const sheet = getSheet(SH.VENDORS);
  const rowIndex = _findRowIndex(sheet, 'Email', user.email);
  if (rowIndex === -1) throw new Error('Vendor record not found.');
  const obj = _rowObjectAt(sheet, VENDOR_HEADERS, rowIndex);
  if (obj.AccreditationStatus !== 'ChangesRequested') throw new Error('Your application is not currently awaiting revision.');

  if (d.companyName) obj.CompanyName = d.companyName.trim();
  if (d.tradeName !== undefined) obj.TradeName = d.tradeName.trim();
  if (d.businessCategory !== undefined) obj.BusinessCategory = d.businessCategory;
  if (d.tinNumber !== undefined) obj.TINNumber = d.tinNumber.trim();
  if (d.dtisecReg !== undefined) obj.DTISECReg = d.dtisecReg.trim();
  if (d.contactPerson) obj.ContactPerson = d.contactPerson.trim();
  if (d.contactNumber) obj.ContactNumber = d.contactNumber.trim();
  if (d.address !== undefined) obj.Address = d.address.trim();
  if (d.documents && typeof d.documents === 'object') {
    const existingDocs = _safeParseJSON(obj.Documents, {});
    obj.Documents = JSON.stringify(Object.assign({}, existingDocs, d.documents));
  }
  const now = new Date().toISOString();
  obj.AccreditationStatus = 'Pending';
  obj.SubmittedOn = now;
  obj.LastUpdated = now;
  _writeRowObject(sheet, VENDOR_HEADERS, rowIndex, obj);
  _logRaw(user, 'RESUBMIT', 'VendorAccreditation', obj.VendorID, 'Vendor updated documents after CPD revision request');
  return { success: true };
}

// ── BID OPPORTUNITIES ───────────────────────────────────────────
function _getBidRow(bidId) {
  const sheet = getSheet(SH.BIDS);
  const rowIndex = _findRowIndex(sheet, 'BidID', bidId);
  if (rowIndex === -1) return null;
  return { sheet, rowIndex, obj: _rowObjectAt(sheet, BID_HEADERS, rowIndex) };
}

function _publicBidView(b) {
  return {
    bidId: b.BidID, referenceNo: b.ReferenceNo, title: b.Title, description: b.Description, category: b.Category,
    department: b.Department, estimatedBudget: b.EstimatedBudget, submissionDeadline: b.SubmissionDeadline,
    status: b.Status, outcome: b.Outcome, publishedOn: b.PublishedOn, closedOn: b.ClosedOn,
    documents: _safeParseJSON(b.Documents, {}),
  };
}

function createBid(token, d) {
  const user = requireAuth(token);
  if (!['cpd_admin', 'cpd_officer', 'proponent'].includes(user.role)) throw new Error('Not authorized.');
  if (!d.title || !d.title.trim()) throw new Error('Title is required.');
  if (d.title.trim().length > 200) throw new Error('Title is too long.');
  if (!d.category || !CATEGORIES.includes(d.category)) throw new Error('Please select a valid category.');
  if (!d.submissionDeadline) throw new Error('Submission deadline is required.');
  if (d.description && d.description.length > 5000) throw new Error('Description is too long.');

  const now = new Date().toISOString();
  const bidId = _id();
  const obj = {
    BidID: bidId,
    ReferenceNo: _nextRegistryNumber('ITB'),
    Title: d.title.trim(),
    Description: (d.description || '').trim(),
    Category: d.category,
    Department: (d.department || user.department || '').trim(),
    ProponentEmail: user.email,
    EstimatedBudget: Number(d.estimatedBudget) || 0,
    Documents: JSON.stringify(d.documents || {}),
    SubmissionDeadline: d.submissionDeadline,
    Status: 'Draft',
    SubmittedOn: '', ApprovedBy: '', ApprovedOn: '', PublishedOn: '', ClosedOn: '', Outcome: '', ReviewNotes: '',
    CreatedBy: user.email, CreatedOn: now, LastModified: now, ViewCount: 0,
  };
  getSheet(SH.BIDS).appendRow(_rowFromObj(BID_HEADERS, obj));
  _logRaw(user, 'CREATE', 'BidOpportunity', bidId, 'Created draft: ' + obj.Title);
  return { success: true, bidId };
}

function updateBid(token, bidId, d) {
  const user = requireAuth(token);
  const found = _getBidRow(bidId);
  if (!found) throw new Error('Bid opportunity not found.');
  const { sheet, rowIndex, obj } = found;
  if (obj.CreatedBy !== user.email && !isCPD(user)) throw new Error('Not authorized to edit this bid opportunity.');
  if (!['Draft', 'PendingApproval'].includes(obj.Status)) throw new Error('This bid opportunity can no longer be edited.');

  if (d.title !== undefined) obj.Title = d.title.trim();
  if (d.description !== undefined) obj.Description = d.description.trim();
  if (d.category !== undefined) obj.Category = d.category;
  if (d.department !== undefined) obj.Department = d.department.trim();
  if (d.estimatedBudget !== undefined) obj.EstimatedBudget = Number(d.estimatedBudget) || 0;
  if (d.documents !== undefined) obj.Documents = JSON.stringify(d.documents);
  if (d.submissionDeadline !== undefined) obj.SubmissionDeadline = d.submissionDeadline;
  obj.LastModified = new Date().toISOString();
  _writeRowObject(sheet, BID_HEADERS, rowIndex, obj);
  _logRaw(user, 'UPDATE', 'BidOpportunity', bidId, 'Updated bid opportunity');
  return { success: true };
}

function submitBidForApproval(token, bidId) {
  const user = requireAuth(token);
  const found = _getBidRow(bidId);
  if (!found) throw new Error('Bid opportunity not found.');
  const { sheet, rowIndex, obj } = found;
  if (obj.CreatedBy !== user.email && !isCPD(user)) throw new Error('Not authorized.');
  if (obj.Status !== 'Draft') throw new Error('Only draft bid opportunities can be submitted for approval.');
  const docs = _safeParseJSON(obj.Documents, {});
  const missing = BID_DOCUMENT_TYPES.filter(t => t.required && !(docs[t.key] && docs[t.key].url)).map(t => t.label);
  if (missing.length) throw new Error('Please upload the following required documents before submitting: ' + missing.join(', ') + '.');
  obj.Status = 'PendingApproval';
  obj.SubmittedOn = new Date().toISOString();
  obj.LastModified = obj.SubmittedOn;
  _writeRowObject(sheet, BID_HEADERS, rowIndex, obj);
  _logRaw(user, 'SUBMIT', 'BidOpportunity', bidId, 'Submitted for CPD approval');
  return { success: true };
}

function approveBid(token, bidId, notes) {
  const user = requireAuth(token);
  if (!isCPD(user)) throw new Error('CPD authorization required.');
  const found = _getBidRow(bidId);
  if (!found) throw new Error('Bid opportunity not found.');
  const { sheet, rowIndex, obj } = found;
  if (obj.Status !== 'PendingApproval') throw new Error('Only bids pending approval can be approved.');
  const now = new Date().toISOString();
  obj.Status = 'Approved';
  obj.ApprovedBy = user.email;
  obj.ApprovedOn = now;
  obj.ReviewNotes = notes || '';
  obj.LastModified = now;
  _writeRowObject(sheet, BID_HEADERS, rowIndex, obj);
  _logRaw(user, 'APPROVE', 'BidOpportunity', bidId, 'Approved bid opportunity');
  return { success: true };
}

function rejectBid(token, bidId, notes) {
  const user = requireAuth(token);
  if (!isCPD(user)) throw new Error('CPD authorization required.');
  const found = _getBidRow(bidId);
  if (!found) throw new Error('Bid opportunity not found.');
  const { sheet, rowIndex, obj } = found;
  if (obj.Status !== 'PendingApproval') throw new Error('Only bids pending approval can be sent back.');
  obj.Status = 'Draft';
  obj.ReviewNotes = notes || '';
  obj.LastModified = new Date().toISOString();
  _writeRowObject(sheet, BID_HEADERS, rowIndex, obj);
  _logRaw(user, 'REJECT', 'BidOpportunity', bidId, 'Returned to draft: ' + (notes || ''));
  return { success: true };
}

function publishBid(token, bidId) {
  const user = requireAuth(token);
  if (!isCPD(user)) throw new Error('CPD authorization required.');
  const found = _getBidRow(bidId);
  if (!found) throw new Error('Bid opportunity not found.');
  const { sheet, rowIndex, obj } = found;
  if (obj.Status !== 'Approved') throw new Error('Only approved bids can be published.');
  const now = new Date().toISOString();
  obj.Status = 'Published';
  obj.PublishedOn = now;
  obj.LastModified = now;
  _writeRowObject(sheet, BID_HEADERS, rowIndex, obj);
  _logRaw(user, 'PUBLISH', 'BidOpportunity', bidId, 'Published to public bid board');
  _cacheClear();
  return { success: true };
}

function closeBid(token, bidId, outcome) {
  const user = requireAuth(token);
  if (!isCPD(user)) throw new Error('CPD authorization required.');
  if (!['Awarded', 'Cancelled', 'No Award'].includes(outcome)) throw new Error('Invalid outcome.');
  const found = _getBidRow(bidId);
  if (!found) throw new Error('Bid opportunity not found.');
  const { sheet, rowIndex, obj } = found;
  if (obj.Status !== 'Published') throw new Error('Only published bids can be closed.');
  const now = new Date().toISOString();
  obj.Status = 'Closed';
  obj.Outcome = outcome;
  obj.ClosedOn = now;
  obj.LastModified = now;
  _writeRowObject(sheet, BID_HEADERS, rowIndex, obj);
  _logRaw(user, 'CLOSE', 'BidOpportunity', bidId, 'Closed with outcome: ' + outcome);
  _cacheClear();
  return { success: true };
}

/** Public bid board — no login required. */
function getPublicBidBoard(filters) {
  filters = filters || {};
  let bids = _cacheGet(CACHE_BIDS);
  if (!bids) {
    bids = sheetToObjects(getSheet(SH.BIDS)).filter(b => ['Published', 'Closed'].includes(b.Status));
    _cacheSet(CACHE_BIDS, bids);
  }
  let out = bids.slice();
  if (filters.category) out = out.filter(b => b.Category === filters.category);
  if (filters.q) {
    const q = filters.q.toLowerCase();
    out = out.filter(b => (b.Title || '').toLowerCase().includes(q) || (b.Description || '').toLowerCase().includes(q));
  }
  out.sort((a, b) => new Date(b.PublishedOn || 0) - new Date(a.PublishedOn || 0));
  return out.map(_publicBidView);
}

/** Public single bid view — no login required. */
function getBidById(id) {
  const sheet = getSheet(SH.BIDS);
  const rowIndex = _findRowIndex(sheet, 'BidID', id);
  if (rowIndex === -1) return { success: false, message: 'Bid opportunity not found.' };
  const obj = _rowObjectAt(sheet, BID_HEADERS, rowIndex);
  if (!['Published', 'Closed'].includes(obj.Status)) return { success: false, message: 'This bid opportunity is not publicly available.' };

  try { sheet.getRange(rowIndex, BID_HEADERS.indexOf('ViewCount') + 1).setValue((Number(obj.ViewCount) || 0) + 1); } catch (e) { /* non-critical */ }

  const inquiries = sheetToObjects(getSheet(SH.INQUIRIES))
    .filter(q => q.BidID === id && q.Status === 'Answered')
    .map(q => ({ question: q.Question, response: q.Response, respondedOn: q.RespondedOn }));

  return { success: true, bid: _publicBidView(obj), inquiries };
}

function getMyBids(token, statusFilter) {
  const user = requireAuth(token);
  let bids = sheetToObjects(getSheet(SH.BIDS));
  if (!isCPD(user)) bids = bids.filter(b => b.CreatedBy === user.email);
  if (statusFilter) bids = bids.filter(b => b.Status === statusFilter);
  bids.sort((a, b) => new Date(b.CreatedOn) - new Date(a.CreatedOn));
  return { success: true, bids: bids.map(b => ({ ...b, documents: _safeParseJSON(b.Documents, {}) })) };
}

function getDashboardStats(token) {
  const user = requireAuth(token);
  if (!isCPD(user)) throw new Error('CPD authorization required.');

  const bids      = sheetToObjects(getSheet(SH.BIDS));
  const vendors   = sheetToObjects(getSheet(SH.VENDORS));
  const inquiries = sheetToObjects(getSheet(SH.INQUIRIES));

  const byStatus = {};
  bids.forEach(b => byStatus[b.Status] = (byStatus[b.Status] || 0) + 1);

  const withApproval = bids.filter(b => b.ApprovedOn && b.PublishedOn);
  let within1Day = 0, totalHours = 0;
  withApproval.forEach(b => {
    const hrs = (new Date(b.PublishedOn) - new Date(b.ApprovedOn)) / 3600000;
    totalHours += hrs;
    if (hrs <= 24) within1Day++;
  });

  return {
    success: true,
    stats: {
      totalBids: bids.length,
      byStatus,
      publishedCount: bids.filter(b => ['Published', 'Closed'].includes(b.Status)).length,
      pctWithin1BusinessDay: withApproval.length ? Math.round(within1Day / withApproval.length * 1000) / 10 : 0,
      avgApprovalToPublishHours: withApproval.length ? Math.round(totalHours / withApproval.length * 10) / 10 : 0,
      totalVendors: vendors.length,
      approvedVendors: vendors.filter(v => v.AccreditationStatus === 'Approved').length,
      pendingVendors: vendors.filter(v => v.AccreditationStatus === 'Pending').length,
      totalInquiries: inquiries.length,
      openInquiries: inquiries.filter(q => q.Status === 'Open').length,
    },
  };
}

// ── INQUIRIES (Q&A) ─────────────────────────────────────────────
function submitInquiry(token, bidId, question) {
  const user = requireAuth(token);
  if (user.role !== 'vendor') throw new Error('Only registered vendors can submit inquiries.');
  if (!question || !question.trim()) throw new Error('Question cannot be empty.');
  if (question.trim().length > 1000) throw new Error('Question is too long (max 1000 characters).');
  const bidRow = _getBidRow(bidId);
  if (!bidRow || bidRow.obj.Status !== 'Published') throw new Error('Inquiries are only accepted for currently published bid opportunities.');

  const inquiryId = _id();
  const now = new Date().toISOString();
  getSheet(SH.INQUIRIES).appendRow(_rowFromObj(INQUIRY_HEADERS, {
    InquiryID: inquiryId, BidID: bidId, VendorEmail: user.email, VendorName: user.companyName || user.fullName,
    Question: question.trim(), SubmittedOn: now, Response: '', RespondedBy: '', RespondedOn: '', Status: 'Open',
  }));
  _logRaw(user, 'CREATE', 'Inquiry', inquiryId, 'Submitted inquiry for bid ' + bidId);
  return { success: true, inquiryId };
}

function getMyInquiries(token) {
  const user = requireAuth(token);
  if (user.role !== 'vendor') throw new Error('Vendor authorization required.');
  const rows = sheetToObjects(getSheet(SH.INQUIRIES)).filter(q => q.VendorEmail === user.email);
  rows.sort((a, b) => new Date(b.SubmittedOn) - new Date(a.SubmittedOn));
  return { success: true, inquiries: rows };
}

function getInquiriesForReview(token, statusFilter) {
  const user = requireAuth(token);
  if (!isCPD(user)) throw new Error('CPD authorization required.');
  let rows = sheetToObjects(getSheet(SH.INQUIRIES));
  if (statusFilter) rows = rows.filter(q => q.Status === statusFilter);
  rows.sort((a, b) => new Date(b.SubmittedOn) - new Date(a.SubmittedOn));
  return { success: true, inquiries: rows };
}

function respondToInquiry(token, inquiryId, response) {
  const user = requireAuth(token);
  if (!isCPD(user)) throw new Error('CPD authorization required.');
  if (!response || !response.trim()) throw new Error('Response cannot be empty.');

  const sheet = getSheet(SH.INQUIRIES);
  const rowIndex = _findRowIndex(sheet, 'InquiryID', inquiryId);
  if (rowIndex === -1) throw new Error('Inquiry not found.');
  const obj = _rowObjectAt(sheet, INQUIRY_HEADERS, rowIndex);
  obj.Response = response.trim();
  obj.RespondedBy = user.email;
  obj.RespondedOn = new Date().toISOString();
  obj.Status = 'Answered';
  _writeRowObject(sheet, INQUIRY_HEADERS, rowIndex, obj);
  _logRaw(user, 'RESPOND', 'Inquiry', inquiryId, 'Responded to vendor inquiry');
  return { success: true };
}

// ── STAFF (USERS) MANAGEMENT ────────────────────────────────────
function getUsers(token) {
  const user = requireAuth(token);
  if (!isAdmin(user)) throw new Error('CPD Administrator authorization required.');
  return { success: true, users: sheetToObjects(getSheet(SH.USERS)) };
}

function saveUser(token, d) {
  const user = requireAuth(token);
  if (!isAdmin(user)) throw new Error('CPD Administrator authorization required.');
  const email = (d.email || '').trim().toLowerCase();
  if (!_isValidEmail(email)) throw new Error('Valid email required.');
  if (!d.fullName || !d.fullName.trim()) throw new Error('Full name is required.');
  if (!['cpd_admin', 'cpd_officer', 'proponent'].includes(d.role)) throw new Error('Invalid role.');

  const sheet = getSheet(SH.USERS);
  const rowIndex = _findRowIndex(sheet, 'Email', email);
  const now = new Date().toISOString();
  if (rowIndex === -1) {
    sheet.appendRow(_rowFromObj(USER_HEADERS, {
      UserID: _id(), Email: email, FullName: d.fullName.trim(), Role: d.role,
      Department: (d.department || '').trim(), Status: 'Active', AddedBy: user.email, AddedOn: now,
    }));
  } else {
    const obj = _rowObjectAt(sheet, USER_HEADERS, rowIndex);
    obj.FullName = d.fullName.trim();
    obj.Role = d.role;
    obj.Department = (d.department || '').trim();
    obj.Status = d.status || obj.Status;
    _writeRowObject(sheet, USER_HEADERS, rowIndex, obj);
  }
  _logRaw(user, 'SAVE', 'User', email, 'Saved staff account');
  return { success: true };
}

function deactivateUser(token, userId) {
  const user = requireAuth(token);
  if (!isAdmin(user)) throw new Error('CPD Administrator authorization required.');
  const sheet = getSheet(SH.USERS);
  const rowIndex = _findRowIndex(sheet, 'UserID', userId);
  if (rowIndex === -1) throw new Error('User not found.');
  const obj = _rowObjectAt(sheet, USER_HEADERS, rowIndex);
  obj.Status = 'Inactive';
  _writeRowObject(sheet, USER_HEADERS, rowIndex, obj);
  _logRaw(user, 'DEACTIVATE', 'User', userId, 'Deactivated staff account');
  return { success: true };
}

// ── AUDIT LOG (DPA 2012 — data logs) ────────────────────────────
function _logRaw(user, action, entityType, entityId, details) {
  try {
    getSheet(SH.AUDIT).appendRow(_rowFromObj(AUDIT_HEADERS, {
      LogID: _id(), Timestamp: new Date().toISOString(),
      ActorEmail: user.email, ActorRole: user.role,
      Action: action, EntityType: entityType, EntityID: entityId, Details: details,
    }));
  } catch (e) { /* never block the main operation */ }
}

function getAuditLog(token, limit) {
  const user = requireAuth(token);
  if (!isAdmin(user)) throw new Error('CPD Administrator authorization required.');
  const rows = sheetToObjects(getSheet(SH.AUDIT));
  return { success: true, logs: rows.reverse().slice(0, limit || 150) };
}

// ── BOOT ─────────────────────────────────────────────────────────
function getBootData(token) {
  const user = requireAuth(token);
  const payload = { success: true, user };
  if (user.role === 'vendor') {
    payload.vendorProfile = _getVendorProfileByEmail(user.email);
  } else if (isCPD(user)) {
    payload.dashboard = getDashboardStats(token).stats;
  }
  return payload;
}

/**
 * One-time helper: run this from the Apps Script editor (Run menu — NOT
 * reachable from the web app) to force the Drive authorization prompt and
 * create the upload folder ahead of time. setup() and grantToicOfficeAdmin()
 * never call DriveApp, so running them alone never triggers this consent.
 */
function authorizeDriveAccess() {
  const folder = _getOrCreateUploadFolder();
  console.log('✅ Drive access authorized. Upload folder: "' + folder.getName() + '" — ' + folder.getUrl());
}

/**
 * One-time helper: grants (or upgrades) a staff account to CPD Administrator.
 * Safe to run anytime — adds a new row if the email isn't in the Users sheet
 * yet, or upgrades the existing row to cpd_admin/Active if it is. Run this
 * from the Apps Script editor (select "grantToicOfficeAdmin" → Run) to fix
 * "this email isn't on file yet" for the TOIC office account.
 */
function grantToicOfficeAdmin() {
  const sheet = getSheet(SH.USERS);

  // Self-heal: if the sheet is empty or its first row isn't the expected
  // header (e.g. because a row was appended before setup() ever ran),
  // insert a proper header row so every lookup by column name works.
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(USER_HEADERS);
  } else {
    const firstRow = sheet.getRange(1, 1, 1, USER_HEADERS.length).getValues()[0];
    const looksLikeHeader = firstRow[0] === 'UserID' && firstRow[1] === 'Email';
    if (!looksLikeHeader) {
      sheet.insertRowBefore(1);
      sheet.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS]);
      console.log('⚠️ Users sheet had no header row — inserted one. Check row 2 onward for any data that needs realigning.');
    }
  }

  const email = 'toic.office@dlsl.edu.ph';
  const rowIndex = _findRowIndex(sheet, 'Email', email);
  const now = new Date().toISOString();
  if (rowIndex === -1) {
    sheet.appendRow(_rowFromObj(USER_HEADERS, {
      UserID: _id(), Email: email, FullName: 'TOIC Office', Role: 'cpd_admin',
      Department: 'TOIC', Status: 'Active', AddedBy: 'system', AddedOn: now,
    }));
    console.log('✅ Added ' + email + ' as CPD Administrator.');
  } else {
    const obj = _rowObjectAt(sheet, USER_HEADERS, rowIndex);
    obj.Role = 'cpd_admin';
    obj.Status = 'Active';
    _writeRowObject(sheet, USER_HEADERS, rowIndex, obj);
    console.log('✅ Updated ' + email + ' to CPD Administrator / Active.');
  }
  _fmtHeader(sheet, '#1B5E20', USER_HEADERS.length);
}

/**
 * One-time helper: run from the Apps Script editor (Run menu — not exposed
 * to the web app) to seed 10 realistic dummy vendors covering every
 * accreditation status, for demoing/testing the review workflow. Documents
 * are intentionally left empty since no real files exist for dummy data —
 * the review table will show "No documents on file" for these rows.
 */
function seedSampleVendors() {
  const now = new Date().toISOString();
  const oneYear = new Date(); oneYear.setFullYear(oneYear.getFullYear() + 1);
  const reviewedBy = 'toic.test@dlsl.edu.ph';

  const SAMPLE_VENDORS = [
    { company: 'ABC Construction Corp', trade: 'ABC Builders', category: 'Infrastructure & Construction', tin: '123-456-789-000', dtisec: 'SEC-CS201512345', contact: 'Juan Dela Cruz', phone: '0917-123-4567', email: 'juan.delacruz@abcconstruction.ph', address: 'Brgy. Sabang, Lipa City, Batangas', status: 'Approved' },
    { company: 'Sunrise Trading Co.', trade: '', category: 'Goods & Supplies', tin: '234-567-890-000', dtisec: 'DTI-00123456', contact: 'Maria Santos', phone: '0918-234-5678', email: 'maria.santos@sunrisetrading.ph', address: 'Brgy. Marawoy, Lipa City, Batangas', status: 'Approved' },
    { company: 'Metro Office Supplies Inc.', trade: 'Metro Office', category: 'Goods & Supplies', tin: '345-678-901-000', dtisec: 'SEC-CS201598765', contact: 'Roberto Reyes', phone: '0919-345-6789', email: 'roberto.reyes@metrooffice.ph', address: 'P. Torres St., Batangas City', status: 'Pending' },
    { company: 'Green Valley Catering Services', trade: '', category: 'Food & Catering', tin: '456-789-012-000', dtisec: 'DTI-00234567', contact: 'Liza Fernandez', phone: '0920-456-7890', email: 'liza.fernandez@greenvalleycatering.ph', address: 'Brgy. Balintawak, Lipa City, Batangas', status: 'Pending' },
    { company: 'TechPro Solutions PH', trade: 'TechPro', category: 'IT & Technology', tin: '567-890-123-000', dtisec: 'SEC-CS201611111', contact: 'Mark Villanueva', phone: '0921-567-8901', email: 'mark.villanueva@techprosolutions.ph', address: 'Ayala Highway, Lipa City, Batangas', status: 'ChangesRequested', notes: "Mayor's/Business Permit submitted has expired (2024). Please upload a current-year permit." },
    { company: 'Prime Security Agency', trade: '', category: 'Janitorial & Security Services', tin: '678-901-234-000', dtisec: 'SEC-CS201722222', contact: 'Carlos Mendoza', phone: '0922-678-9012', email: 'carlos.mendoza@primesecurity.ph', address: 'Brgy. Tambo, Lipa City, Batangas', status: 'ChangesRequested', notes: 'BIR Certificate of Registration on file does not match the company name provided. Please re-upload the correct document.' },
    { company: 'Lipa Printing Press', trade: '', category: 'Printing & Publication', tin: '789-012-345-000', dtisec: 'DTI-00345678', contact: 'Ana Bautista', phone: '0923-789-0123', email: 'ana.bautista@lipaprinting.ph', address: 'C.M. Recto Ave., Lipa City, Batangas', status: 'Rejected', notes: 'Incomplete submission — Tax Clearance Certificate and BIR Certificate of Registration were not provided.' },
    { company: 'Batangas Builders Consortium', trade: 'BBC', category: 'Infrastructure & Construction', tin: '890-123-456-000', dtisec: 'SEC-CS201833333', contact: 'Ramon Aquino', phone: '0924-890-1234', email: 'ramon.aquino@batangasbuilders.ph', address: 'Brgy. Pagolingin, Batangas City', status: 'Rejected', notes: 'DTI/SEC registration submitted appears expired. Please reapply once renewed.' },
    { company: 'Star Logistics & Freight', trade: 'Star Logistics', category: 'Transportation & Logistics', tin: '901-234-567-000', dtisec: 'SEC-CS201944444', contact: 'Ella Ramos', phone: '0925-901-2345', email: 'ella.ramos@starlogistics.ph', address: 'National Highway, Malvar, Batangas', status: 'Pending' },
    { company: 'Golden Harvest Food Corp', trade: 'Golden Harvest', category: 'Food & Catering', tin: '012-345-678-000', dtisec: 'SEC-CS202055555', contact: 'Peter Lim', phone: '0926-012-3456', email: 'peter.lim@goldenharvest.ph', address: 'Brgy. Anilao, Mabini, Batangas', status: 'Approved' },
  ];

  const sheet = getSheet(SH.VENDORS);
  SAMPLE_VENDORS.forEach(v => {
    const isReviewed = v.status !== 'Pending';
    sheet.appendRow(_rowFromObj(VENDOR_HEADERS, {
      VendorID: _id(),
      AccreditationNo: v.status === 'Approved' ? _nextRegistryNumber('ACC') : '',
      CompanyName: v.company,
      TradeName: v.trade || '',
      BusinessCategory: v.category,
      TINNumber: v.tin,
      DTISECReg: v.dtisec,
      ContactPerson: v.contact,
      ContactNumber: v.phone,
      Email: v.email,
      Address: v.address,
      Documents: JSON.stringify({}),
      AccreditationStatus: v.status,
      SubmittedOn: now,
      ReviewedBy: isReviewed ? reviewedBy : '',
      ReviewedOn: isReviewed ? now : '',
      ReviewNotes: v.notes || '',
      ExpiryDate: v.status === 'Approved' ? oneYear.toISOString() : '',
      LastUpdated: now,
    }));
  });
  console.log('✅ Seeded ' + SAMPLE_VENDORS.length + ' sample vendors (mix of Pending / Approved / Rejected / Changes Requested).');
}

// ── SETUP ─────────────────────────────────────────────────────────
function setup() {
  _initUsers();
  _initVendors();
  _initBids();
  _initInquiries();
  _initAuditLog();
  _initConfig();
  console.log('✅ BiddersHub setup complete!');
  console.log('Seeded test accounts in the Users sheet: toic.test@dlsl.edu.ph (cpd_admin), cpd.test@dlsl.edu.ph (cpd_officer).');
  console.log('Replace these with real staff emails when ready, then sign in with the email on file.');
  console.log('Deploy as Web App → Execute as: Me (User deploying) | Access: Anyone');
}

function _fmtHeader(sheet, color, numCols) {
  sheet.getRange(1, 1, 1, numCols).setBackground(color).setFontColor('#fff').setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function _initUsers() {
  const sheet = getSheet(SH.USERS);
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow(USER_HEADERS);
  const now = new Date().toISOString();
  sheet.appendRow([_id(), 'toic.test@dlsl.edu.ph', 'CPD Administrator (Test)', 'cpd_admin', 'Central Procurement Department', 'Active', 'system', now]);
  sheet.appendRow([_id(), 'cpd.test@dlsl.edu.ph', 'CPD Officer (Test)', 'cpd_officer', 'Central Procurement Department', 'Active', 'system', now]);
  _fmtHeader(sheet, '#1B5E20', USER_HEADERS.length);
}

function _initVendors() {
  const sheet = getSheet(SH.VENDORS);
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow(VENDOR_HEADERS);
  _fmtHeader(sheet, '#1B5E20', VENDOR_HEADERS.length);
}

function _initBids() {
  const sheet = getSheet(SH.BIDS);
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow(BID_HEADERS);
  _fmtHeader(sheet, '#1B5E20', BID_HEADERS.length);
}

function _initInquiries() {
  const sheet = getSheet(SH.INQUIRIES);
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow(INQUIRY_HEADERS);
  _fmtHeader(sheet, '#1B5E20', INQUIRY_HEADERS.length);
}

function _initAuditLog() {
  const sheet = getSheet(SH.AUDIT);
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow(AUDIT_HEADERS);
  _fmtHeader(sheet, '#37474F', AUDIT_HEADERS.length);
}

function _initConfig() {
  const sheet = getSheet(SH.CONFIG);
  sheet.clearContents();
  sheet.appendRow(['Setting', 'Value', 'Notes']);
  sheet.appendRow(['SystemName', 'BiddersHub — DLSL Procurement Portal', '']);
  sheet.appendRow(['Version', '1.0', 'Public bid board + vendor accreditation + inquiries']);
  sheet.appendRow(['SetupDate', new Date().toISOString(), '']);
  _fmtHeader(sheet, '#1B5E20', 3);
}

// ── UTILITIES ─────────────────────────────────────────────────
function _id() { return Utilities.getUuid(); }

/**
 * Sequential registry number, e.g. ITB-2026-0001 / ACC-2026-0001 — mirrors how
 * Philippine procurement bulletins and accreditation certificates are numbered.
 * Lock-guarded so concurrent submissions never collide on the same number.
 */
function _nextRegistryNumber(prefix) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const year = new Date().getFullYear();
    const key = 'seq_' + prefix + '_' + year;
    const props = PropertiesService.getScriptProperties();
    const next = (parseInt(props.getProperty(key) || '0', 10) + 1);
    props.setProperty(key, String(next));
    return prefix + '-' + year + '-' + String(next).padStart(4, '0');
  } finally {
    lock.releaseLock();
  }
}
