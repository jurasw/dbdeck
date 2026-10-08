import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as oracledb from 'oracledb';
import { oracleNumber, OracleDriver } from '../src/drivers/oracle';
import { splitSql } from '../src/sqlSplit';
import { loadSchemaDiagram } from '../src/schema-diagram';
import { ConnectionConfig } from '../src/types';

const config: ConnectionConfig = { id: 'oracle', name: 'Oracle', type: 'oracle', host: '127.0.0.1', port: 11521, database: 'FREEPDB1', user: 'dbdeck', password: 'dbdeckTest123' };

test('Oracle NUMBER results preserve integers and decimals beyond JavaScript precision', () => {
  assert.equal(oracleNumber('42'), 42);
  assert.equal(oracleNumber('12.50'), 12.5);
  assert.equal(oracleNumber('9007199254740993'), '9007199254740993');
  assert.equal(oracleNumber('1.234567890123456789'), '1.234567890123456789');
  assert.equal(oracleNumber(null), null);
});

function fixture(fail = false) {
  const events: string[] = [];
  const statements: { sql: string; binds: unknown; options: oracledb.ExecuteOptions | undefined }[] = [];
  let options: oracledb.PoolAttributes | undefined;
  const connection = {
    execute: async (sql: string, binds?: unknown, executeOptions?: oracledb.ExecuteOptions) => {
      statements.push({ sql, binds, options: executeOptions });
      if (fail && sql.startsWith('INSERT')) throw new Error('constraint violation');
      return sql.startsWith('SELECT') ? { rows: [[1]], metaData: [{ name: 'ID', dbTypeName: 'NUMBER' }] } : { rowsAffected: 1 };
    },
    getStatementInfo: async (sql: string) => ({ statementType: /DELETE/i.test(sql) ? oracledb.STMT_TYPE_DELETE : oracledb.STMT_TYPE_SELECT }),
    commit: async () => {
      events.push('commit');
    },
    rollback: async () => {
      events.push('rollback');
    },
    close: async () => {
      events.push('close');
    },
  };
  const client = {
    createPool: async (o: oracledb.PoolAttributes) => {
      options = o;
      return {
        getConnection: async () => connection,
        close: async () => {
          events.push('pool close');
        },
      };
    },
  } as unknown as typeof oracledb;
  return { driver: new OracleDriver(config, client), statements, events, options: () => options };
}

test('Oracle connects in Thin mode, pages with FETCH NEXT and binds staged edits in one transaction', async () => {
  const f = fixture();
  await f.driver.connect();
  assert.match(f.options()!.connectString!, /^tcp:\/\/127.0.0.1:11521\/FREEPDB1/);
  assert.equal(f.statements[0].options!.autoCommit, true);
  const ref = { database: 'FREEPDB1', schema: 'DBDECK', table: 'USERS' };
  assert.equal(f.driver.selectSql(ref, { limit: 50, offset: 100 }), 'SELECT * FROM "DBDECK"."USERS" OFFSET 100 ROWS FETCH NEXT 50 ROWS ONLY');
  assert.match(f.driver.searchWhere([{ name: 'NAME' }], undefined, "O'Neil")!, /INSTR\(LOWER\(TO_CHAR\("NAME"\)\), LOWER\('O''Neil'\)\)/);
  f.events.length = 0;
  assert.equal(await f.driver.apply(ref, { updates: [{ key: { ID: 1 }, values: { NAME: "O'Neil" } }], inserts: [{ ID: 2, NAME: 'Ala' }], deletes: [] }), 2);
  assert.deepEqual(f.events, ['commit', 'close']);
  assert.deepEqual(f.statements[1].binds, ["O'Neil", 1]);
  assert.equal(f.statements[1].sql, 'UPDATE "DBDECK"."USERS" SET "NAME" = :1 WHERE "ID" = :2');
  assert.equal(f.statements[1].options!.autoCommit, false);
  await f.driver.close();
  assert.equal(f.events.at(-1), 'pool close');
});

test('Oracle rolls back the full staged change on failure and closes read-only transactions', async () => {
  const f = fixture(true);
  await f.driver.connect();
  f.events.length = 0;
  await assert.rejects(
    f.driver.apply({ schema: 'APP', table: 'USERS' }, { updates: [{ key: { ID: 1 }, values: { NAME: 'x' } }], inserts: [{ ID: 2 }], deletes: [] }),
    /constraint violation/,
  );
  assert.deepEqual(f.events, ['rollback', 'close']);
  f.events.length = 0;
  assert.deepEqual((await f.driver.runReadOnly('SELECT 1 FROM DUAL;')).rows, [[1]]);
  assert.deepEqual(f.events, ['rollback', 'close']);
  assert.equal(f.statements.at(-2)!.sql, 'SET TRANSACTION READ ONLY');
  await assert.rejects(f.driver.runReadOnly('WITH x AS (SELECT 1 FROM DUAL) DELETE FROM users'), /not read-only|SELECT and WITH/);
  await f.driver.close();
});

test('Oracle SQL splitting preserves PL/SQL blocks, alternative quotes and literal backslashes', () => {
  const source = "SELECT q'[a';b]' FROM DUAL;\nBEGIN\n NULL;\n NULL;\nEND;\n/\nSELECT 'C:\\' FROM DUAL;";
  const parts = splitSql(source, 'oracle');
  assert.deepEqual(
    parts.map((p) => p.text),
    ["SELECT q'[a';b]' FROM DUAL", 'BEGIN\n NULL;\n NULL;\nEND;', "SELECT 'C:\\' FROM DUAL"],
  );
});

test('Oracle integration: metadata, DDL, paging, row transactions, search, diagrams and read-only execution', { skip: process.env.DBDECK_ORACLE_INTEGRATION !== '1' }, async () => {
  const driver = new OracleDriver(config);
  const readonly = new OracleDriver({ ...config, readonly: true });
  await driver.connect();
  const users = `DBDECK_USERS_${Date.now()}`;
  const orders = `DBDECK_ORDERS_${Date.now()}`;
  const ref = { database: 'FREEPDB1', schema: 'DBDECK', table: users };
  try {
    await driver.run(`CREATE TABLE "${users}" (ID NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, NAME VARCHAR2(100) NOT NULL, NOTE CLOB)`);
    await driver.run(`CREATE TABLE "${orders}" (ID NUMBER PRIMARY KEY, USER_ID NUMBER REFERENCES "${users}"(ID))`);
    assert.deepEqual((await driver.run('SELECT 42, 9007199254740993 FROM DUAL')).rows, [[42, '9007199254740993']]);
    await driver.apply(ref, { inserts: [{ NAME: 'Jurek', NOTE: 'long text' }, { NAME: 'Ala' }], updates: [], deletes: [] });
    assert.deepEqual(
      (await driver.columns(ref)).map((c) => [c.name, c.pk, c.nullable]),
      [
        ['ID', true, false],
        ['NAME', false, false],
        ['NOTE', false, true],
      ],
    );
    assert.equal((await driver.page(ref, { limit: 1, offset: 1 })).rows[0][1], 'Ala');
    assert.equal(await driver.count(ref, undefined, 'jUr'), 1);
    assert.deepEqual((await driver.searchValues(ref, 'jUr', () => false)).matches, [{ column: 'NAME', value: 'Jurek' }]);
    assert.match(await driver.ddl(ref, 'table'), /CREATE TABLE/);
    const diagram = await loadSchemaDiagram(driver, 'FREEPDB1', 'DBDECK');
    assert.ok(diagram.relations.some((r) => r.sourceColumn === 'USER_ID' && r.targetColumn === 'ID'));
    await assert.rejects(driver.apply(ref, { updates: [{ key: { ID: 1 }, values: { NAME: 'changed' } }], inserts: [{ NAME: null }], deletes: [] }), /ORA-01400/);
    assert.equal((await driver.run(`SELECT NAME FROM "${users}" WHERE ID = 1`)).rows[0][0], 'Jurek');
    await readonly.connect();
    await assert.rejects(readonly.run(`DELETE FROM "${users}"`), /read-only/);
    assert.equal((await readonly.runReadOnly(`SELECT COUNT(*) FROM "${users}"`)).rows[0][0], 2);
  } finally {
    await readonly.close();
    await driver.run(`DROP TABLE "${orders}" PURGE`).catch(() => undefined);
    await driver.run(`DROP TABLE "${users}" PURGE`).catch(() => undefined);
    await driver.close();
  }
});
