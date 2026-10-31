import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterSuggestions, FieldHint, sqlSuggestions } from '../webview/filter-suggest';

const fields: FieldHint[] = [
  { name: '_id', type: 'string' },
  { name: 'admin', type: 'boolean' },
  { name: 'adminBlockedAt', type: 'date | null' },
  { name: 'status', type: 'string', values: ['active', 'banned'] },
  { name: 'score', type: 'number' },
];

const at = (text: string) => filterSuggestions(text, text.length, fields);

test('typing a field prefix offers its values and inserts valid JSON', () => {
  const list = at('{ "ad');
  assert.deepEqual(
    list.map((s) => s.label),
    ['admin = true', 'admin = false', 'adminBlockedAt = { "$date": "" }'],
  );
  assert.deepEqual(JSON.parse(list[0].text), { admin: true });
  assert.deepEqual(JSON.parse(list[1].text), { admin: false });
});

test('bare prefix without braces is wrapped into a filter object', () => {
  const [first] = at('ad');
  assert.equal(first.text, '{ "admin": true }');
  assert.equal(first.text.slice(0, first.caret), '{ "admin": true');
});

test('sampled string values are suggested and the caret goes inside empty placeholders', () => {
  assert.deepEqual(
    at('{ "st').map((s) => s.text),
    ['{ "status": "active" }', '{ "status": "banned" }'],
  );
  const [score] = at('{ "sc');
  assert.equal(score.text, '{ "score": 0 }');
  const [id] = at('{ "_i');
  assert.equal(id.text.slice(0, id.caret), '{ "_id": "');
});

test('later keys keep earlier conditions', () => {
  const [first] = at('{ "admin": true, "sta');
  assert.deepEqual(JSON.parse(first.text), { admin: true, status: 'active' });
});

test('typing inside a value suggests that field values only', () => {
  const list = at('{ "status": "ba');
  assert.deepEqual(
    list.map((s) => s.text),
    ['{ "status": "banned" }'],
  );
});

test('middle of a filter keeps the following keys', () => {
  const text = '{ "ad "status": "active" }';
  const [first] = filterSuggestions(text, 5, fields);
  assert.deepEqual(JSON.parse(first.text), { admin: true, status: 'active' });
});

test('unknown prefixes and finished values have no suggestions', () => {
  assert.deepEqual(at('{ "zzz'), []);
  assert.deepEqual(at('{ "admin": true }'), []);
});

const sqlColumns = [
  { name: 'id', type: 'integer' },
  { name: 'is_pro', type: 'boolean' },
  { name: 'is_affiliate', type: 'boolean', nullable: true },
  { name: 'region', type: 'character varying(50)', nullable: true },
  { name: 'Order', type: 'text' },
];
const ident = (n: string) => (/^[a-z_][a-z0-9_]*$/.test(n) ? n : `"${n}"`);
const sqlAt = (text: string) => sqlSuggestions(text, text.length, sqlColumns, ident);

test('SQL WHERE prefix offers boolean comparisons for matching columns', () => {
  assert.deepEqual(
    sqlAt('is').map((s) => s.text),
    ['is_pro = true', 'is_pro = false', 'is_affiliate = true', 'is_affiliate = false', 'is_affiliate IS NULL', 'is_affiliate IS NOT NULL'],
  );
});

test('SQL WHERE completes after AND and puts the caret inside string literals', () => {
  const [first] = sqlAt('is_pro = true AND reg');
  assert.equal(first.text, "is_pro = true AND region = ''");
  assert.equal(first.text.slice(0, first.caret), "is_pro = true AND region = '");
  assert.equal(sqlAt('or')[0].text, `"Order" = ''`);
});

test('SQL WHERE does not suggest inside values', () => {
  assert.deepEqual(sqlAt("region = 'is"), []);
  assert.deepEqual(sqlAt('id = 1'), []);
});
