import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DockerDriver } from '../src/drivers/docker';

function container(image: string, port: number, env: string[] = []) {
  const driver = new DockerDriver({ id: 'd', name: 'docker', type: 'docker' });
  driver.api = (async () => ({
    Name: '/db',
    Config: { Image: image, Env: env },
    NetworkSettings: { Ports: { [`${port}/tcp`]: [{ HostIp: '0.0.0.0', HostPort: String(port + 10000) }] } },
  })) as DockerDriver['api'];
  return driver.connectionFor('id');
}

test('Docker containers of compatible databases open with their type, port and default user', async () => {
  assert.deepEqual(await container('cockroachdb/cockroach:latest', 26257), {
    type: 'postgres',
    name: 'db',
    host: '127.0.0.1',
    port: 36257,
    user: 'root',
    password: undefined,
    database: 'defaultdb',
  });
  assert.equal((await container('yugabytedb/yugabyte:latest', 5433))?.user, 'yugabyte');
  assert.deepEqual(await container('pingcap/tidb:latest', 4000), { type: 'mysql', name: 'db', host: '127.0.0.1', port: 14000, user: 'root' });
  assert.equal((await container('ghcr.io/singlestore-labs/singlestoredb-dev', 3306, ['ROOT_PASSWORD=x']))?.password, 'x');
  assert.equal((await container('ghcr.io/ferretdb/ferretdb-eval:2', 27017, ['POSTGRES_USER=u', 'POSTGRES_PASSWORD=p']))?.user, 'u');
  assert.equal((await container('valkey/valkey:8-alpine', 6379))?.type, 'redis');
});

test('OpenSearch containers use TLS and the admin user unless the security plugin is off', async () => {
  const secure = await container('opensearchproject/opensearch:2', 9200, ['OPENSEARCH_INITIAL_ADMIN_PASSWORD=Secret1!']);
  assert.equal(secure?.type, 'elasticsearch');
  assert.equal(secure?.user, 'admin');
  assert.equal(secure?.ssl, true);
  const open = await container('opensearchproject/opensearch:2', 9200, ['DISABLE_SECURITY_PLUGIN=true']);
  assert.equal(open?.ssl, undefined);
  assert.equal(open?.user, undefined);
});

test('Plain database images keep their existing credentials', async () => {
  assert.equal((await container('postgres:16-alpine', 5432, ['POSTGRES_PASSWORD=x']))?.user, 'postgres');
  assert.equal((await container('mariadb:11', 3306, ['MARIADB_ROOT_PASSWORD=x']))?.password, 'x');
});

test('Docker discovers SQL Server, Cassandra and DynamoDB Local with service-specific credentials', async () => {
  const sql = await container('mcr.microsoft.com/mssql/server:2022-latest', 1433, ['MSSQL_SA_PASSWORD=test']);
  assert.equal(sql?.type, 'mssql');
  assert.equal(sql?.user, 'sa');
  assert.equal(sql?.password, 'test');
  assert.equal(sql?.port, 11433);
  assert.equal(sql?.rejectUnauthorized, false);
  const cassandra = await container('cassandra:5.0', 9042, ['CASSANDRA_DC=dc2']);
  assert.equal(cassandra?.type, 'cassandra');
  assert.equal(cassandra?.localDatacenter, 'dc2');
  const dynamo = await container('amazon/dynamodb-local:3.1.0', 8000);
  assert.equal(dynamo?.type, 'dynamodb');
  assert.equal(dynamo?.endpoint, 'http://127.0.0.1:18000');
  assert.equal(dynamo?.user, 'local');
});
