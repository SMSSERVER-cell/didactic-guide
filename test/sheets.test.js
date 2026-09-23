'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sheets = require('../sheets');

test.afterEach(() => sheets._setSheetsClientForTests(null));

test('blank sheetId skips without touching Google', async () => {
  sheets._setSheetsClientForTests({
    spreadsheets: { values: { append: () => assert.fail('should not append') } },
  });
  assert.equal(await sheets.logMissedCall({ sheetId: '', from: '+15551112222' }), false);
});

test('missing credentials with a sheetId rejects with a clear error', async () => {
  const saved = { e: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, k: process.env.GOOGLE_PRIVATE_KEY };
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_PRIVATE_KEY;
  try {
    await assert.rejects(sheets.logMissedCall({ sheetId: 'abc' }), /GOOGLE_SERVICE_ACCOUNT_EMAIL/);
  } finally {
    if (saved.e !== undefined) process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = saved.e;
    if (saved.k !== undefined) process.env.GOOGLE_PRIVATE_KEY = saved.k;
  }
});

test('buildRow keeps phone numbers and odd caller IDs as plain text', () => {
  const now = new Date('2026-01-02T03:04:05.000Z');
  assert.deepEqual(
    sheets.buildRow({ from: '+15551112222', to: '+15553334444', status: 'no-answer', smsSent: true }, now),
    ['2026-01-02T03:04:05.000Z', '+15551112222', '+15553334444', 'no-answer', 'Yes']
  );
  assert.deepEqual(sheets.buildRow({ from: undefined, to: null, status: 'busy', smsSent: false }, now), [
    '2026-01-02T03:04:05.000Z',
    '',
    '',
    'busy',
    'No',
  ]);
  assert.equal(sheets.buildRow({}, now).length, sheets.COLUMNS.length);
});

test('tabRange quotes tab names', () => {
  assert.equal(sheets.tabRange(), "'Sheet1'!A:E");
  assert.equal(sheets.tabRange('Call Log'), "'Call Log'!A:E");
  assert.equal(sheets.tabRange("Bob's"), "'Bob''s'!A:E");
});

test('append is RAW, targets the client sheet, and has a timeout', async () => {
  let call;
  sheets._setSheetsClientForTests({
    spreadsheets: { values: { append: async (params, opts) => { call = { params, opts }; } } },
  });
  const ok = await sheets.logMissedCall({
    sheetId: 'sheet-123',
    from: '+15551112222',
    to: '+15553334444',
    status: 'no-answer',
    smsSent: true,
  });
  assert.equal(ok, true);
  assert.equal(call.params.spreadsheetId, 'sheet-123');
  assert.equal(call.params.valueInputOption, 'RAW');
  assert.equal(call.params.range, "'Sheet1'!A:E");
  assert.deepEqual(call.params.requestBody.values[0].slice(1), ['+15551112222', '+15553334444', 'no-answer', 'Yes']);
  assert.ok(call.opts.timeout > 0);
});

test('a Google failure rejects so the caller can alert', async () => {
  sheets._setSheetsClientForTests({
    spreadsheets: { values: { append: async () => { throw new Error('403 caller does not have permission'); } } },
  });
  await assert.rejects(sheets.logMissedCall({ sheetId: 'x' }), /403/);
});
