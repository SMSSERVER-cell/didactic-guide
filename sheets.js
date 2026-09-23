'use strict';

// Google Sheets call log.
//
// Every client has its own sheet (client.sheetId), but all sheets are written
// by ONE shared service account configured in .env:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY
// Share each client sheet with that service-account email as Editor.
//
// Contract for callers:
//   - Resolves false when this client has no sheetId (logging not set up).
//   - Resolves true when the row was written.
//   - Rejects on a real failure (bad credentials, sheet not shared, timeout)
//     so the caller can raise an [ALERT]. A rejection must never block,
//     retry, or undo the missed-call SMS. Logging is not a send path.

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const DEFAULT_TAB = 'Sheet1';
const REQUEST_TIMEOUT_MS = 5000; // Twilio gives a webhook ~15s; never spend it all here.

// Put these in row 1 of each client sheet. Order matches buildRow().
const COLUMNS = ['Timestamp (UTC)', 'From', 'To', 'Dial status', 'SMS sent'];

let sheetsClient = null;

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error(
      'Sheets logging: a client has a sheetId but GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY are not set'
    );
  }

  // Required lazily so clients without a sheet (and the tests) never load googleapis.
  const { google } = require('googleapis');
  const auth = new google.auth.JWT({ email, key, scopes: SCOPES });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

function text(value) {
  return value == null ? '' : String(value);
}

// Values are written RAW, so "+15551234567" stays text instead of becoming a
// number with its "+" stripped, and a caller ID can never be read as a formula.
function buildRow({ from, to, status, smsSent }, now = new Date()) {
  return [now.toISOString(), text(from), text(to), text(status), smsSent ? 'Yes' : 'No'];
}

// Quote the tab name so tabs with spaces ("Call Log") work in A1 notation.
function tabRange(tab) {
  const name = String(tab || DEFAULT_TAB).replace(/'/g, "''");
  return `'${name}'!A:E`;
}

async function logMissedCall({ sheetId, sheetTab, from, to, status, smsSent }) {
  if (!sheetId) return false;

  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append(
    {
      spreadsheetId: sheetId,
      range: tabRange(sheetTab),
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [buildRow({ from, to, status, smsSent })] },
    },
    { timeout: REQUEST_TIMEOUT_MS }
  );
  return true;
}

// Test hook only. Pass null to reset.
function _setSheetsClientForTests(client) {
  sheetsClient = client;
}

module.exports = { logMissedCall, buildRow, tabRange, COLUMNS, _setSheetsClientForTests };
