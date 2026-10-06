import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSql, statementAt } from '../src/sqlSplit';

test('splits statements without splitting quoted semicolons or comments', () => {
  const source = "  SELECT 'a;b'; -- ignored ;\nSELECT 2; /* ignored ; */";
  const statements = splitSql(source);
  assert.deepEqual(
    statements.map((s) => s.text),
    ["SELECT 'a;b'", '-- ignored ;\nSELECT 2'],
  );
  for (const s of statements) assert.equal(source.slice(s.start, s.end), s.text);
});
test('keeps PostgreSQL dollar-quoted function bodies together', () => {
  assert.equal(splitSql('DO $body$ BEGIN PERFORM 1; PERFORM 2; END $body$; SELECT 3;').length, 2);
});
test('handles MySQL backslash escapes and hash comments', () => {
  assert.equal(splitSql("SELECT 'a\\';b'; # ignored ;\nSELECT 2", 'mysql').length, 2);
});
test('ignores empty and comment-only scripts', () => {
  assert.deepEqual(splitSql(' ; -- comment\n /* comment */;'), []);
});
test('selects the statement at the cursor and falls back across whitespace', () => {
  const statements = splitSql('SELECT 1;    SELECT 2;');
  assert.equal(statementAt(statements, 5), statements[0]);
  assert.equal(statementAt(statements, 17), statements[1]);
  assert.equal(statementAt(statements, 11), statements[0]);
  assert.equal(statementAt([], 0), undefined);
});
