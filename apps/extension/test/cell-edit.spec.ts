import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCellValue } from '../webview/cell-value';
import { MongoDriver } from '../src/drivers/mongo';

test('cell edits preserve strings and validate typed document values', () => {
  assert.equal(parseCellValue('123', 'old'), '123');
  assert.equal(parseCellValue('', 'old'), '');
  assert.equal(parseCellValue('12', 1), 12);
  assert.equal(parseCellValue('false', true), false);
  assert.deepEqual(parseCellValue('{"nested":[1]}', {}), { nested: [1] });
  assert.equal(parseCellValue('null', null), null);
  assert.equal(parseCellValue('hello', undefined), 'hello');
  assert.throws(() => parseCellValue('"12"', 1), /number/);
  assert.throws(() => parseCellValue('1', true), /true or false/);
  assert.throws(() => parseCellValue('{bad}', {}));
});

test('MongoDB cell updates change only the selected field and decode BSON IDs', async () => {
  const driver = new MongoDriver({ id: 'test', name: 'Test', type: 'mongodb' });
  let captured: unknown[] = [];
  driver.db = (() => ({
    collection: () => ({
      updateOne: async (...args: unknown[]) => {
        captured = args;
        return { matchedCount: 1 };
      },
    }),
  })) as unknown as typeof driver.db;
  await driver.updateField('db', 'users', { $oid: '507f1f77bcf86cd799439011' }, 'name', '"Ada"');
  const [filter, update] = captured as [{ _id: { toHexString(): string } }, unknown];
  assert.equal(filter._id.toHexString(), '507f1f77bcf86cd799439011');
  assert.deepEqual(update, { $set: { name: 'Ada' } });
  for (const field of ['_id', 'nested.value', '$bad', '']) await assert.rejects(driver.updateField('db', 'users', 'id', field, '1'), /cannot be edited/);
  driver.config.readonly = true;
  await assert.rejects(driver.updateField('db', 'users', 'id', 'name', '"Ada"'), /read-only/);
});
