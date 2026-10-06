import { timingSafeEqual } from 'node:crypto';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { ColumnMeta, QueryResult } from './types';

export interface McpBackend {
  connections(): { id: string; name: string; type: string; database?: string }[];
  databases(connectionId: string): Promise<string[]>;
  tables(connectionId: string, database: string, schema?: string): Promise<{ name: string; schema?: string }[]>;
  columns(connectionId: string, database: string, table: string, schema?: string): Promise<ColumnMeta[]>;
  query(connectionId: string, database: string, sql: string): Promise<QueryResult>;
  open(connectionId: string, database: string, sql: string): Promise<void>;
  maxRows(): number;
}

export interface RunningMcpServer {
  port: number;
  close(): Promise<void>;
}

const MAX_OUTPUT = 200000;

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }] };
}

function guarded<A>(action: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return text(await action(args));
    } catch (e) {
      return { ...text(e instanceof Error ? e.message : String(e)), isError: true };
    }
  };
}

export function queryOutput(result: QueryResult, maxRows: number): string {
  let rows = result.rows.slice(0, maxRows);
  let truncated = result.rows.length > rows.length || !!result.truncated;
  const render = () =>
    JSON.stringify({
      columns: result.columns.map((c) => ({ name: c.name, type: c.type })),
      rows,
      rowCount: rows.length,
      truncated,
      durationMs: result.durationMs,
      message: result.message,
    });
  let output = render();
  while (output.length > MAX_OUTPUT && rows.length > 1) {
    rows = rows.slice(0, Math.floor(rows.length / 2));
    truncated = true;
    output = render();
  }
  return output;
}

function createMcp(backend: McpBackend, version: string): McpServer {
  const mcp = new McpServer(
    { name: 'dbdeck', version },
    {
      instructions:
        'DBDeck exposes the SQL connections the user saved in their editor. Inspect tables and columns before writing SQL. run_query only runs one read-only statement. To change data or schema, call open_query so the user can review and run it.',
    },
  );
  const connectionId = z.string().describe('Connection id from list_connections');
  const database = z.string().describe('Database name from list_databases');
  const schema = z.string().optional().describe('PostgreSQL schema, for example public');
  const readOnly = { readOnlyHint: true, openWorldHint: false };
  mcp.registerTool(
    'list_connections',
    { description: 'List the SQL database connections saved in DBDeck.', annotations: readOnly },
    guarded(async () => backend.connections()),
  );
  mcp.registerTool(
    'list_databases',
    { description: 'List databases on a DBDeck connection.', inputSchema: { connectionId }, annotations: readOnly },
    guarded(async (a: { connectionId: string }) => backend.databases(a.connectionId)),
  );
  mcp.registerTool(
    'list_tables',
    { description: 'List tables and views in a database.', inputSchema: { connectionId, database, schema }, annotations: readOnly },
    guarded(async (a: { connectionId: string; database: string; schema?: string }) => backend.tables(a.connectionId, a.database, a.schema)),
  );
  mcp.registerTool(
    'describe_table',
    {
      description: 'List the columns of a table or view with types, nullability and primary keys.',
      inputSchema: { connectionId, database, schema, table: z.string() },
      annotations: readOnly,
    },
    guarded(async (a: { connectionId: string; database: string; schema?: string; table: string }) => backend.columns(a.connectionId, a.database, a.table, a.schema)),
  );
  mcp.registerTool(
    'run_query',
    {
      description:
        'Run one read-only SQL statement (SELECT, WITH, SHOW, DESCRIBE or EXPLAIN) inside a read-only transaction and return the rows as JSON. Results are limited in size.',
      inputSchema: { connectionId, database, sql: z.string().max(100000) },
      annotations: readOnly,
    },
    guarded(async (a: { connectionId: string; database: string; sql: string }) => queryOutput(await backend.query(a.connectionId, a.database, a.sql), backend.maxRows())),
  );
  mcp.registerTool(
    'open_query',
    {
      description: 'Open SQL in a new DBDeck query editor for the user to review. It does not run the SQL. Use it for INSERT, UPDATE, DELETE and schema changes.',
      inputSchema: { connectionId, database, sql: z.string().max(100000) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    guarded(async (a: { connectionId: string; database: string; sql: string }) => {
      await backend.open(a.connectionId, a.database, a.sql);
      return 'Opened in a DBDeck query editor. The user reviews and runs it.';
    }),
  );
  return mcp;
}

function authorized(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function reply(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

export async function startMcpServer(backend: McpBackend, options: { token: string; port: number; version: string }): Promise<RunningMcpServer> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const port = (server.address() as AddressInfo).port;
      if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/mcp') return reply(res, 404, 'Not found');
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host ?? '')) return reply(res, 403, 'Invalid Host header');
      if (!authorized(req.headers.authorization, options.token)) return reply(res, 401, 'Unauthorized');
      const mcp = createMcp(backend, options.version);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) reply(res, 500, 'Internal error');
    }
  });
  const listen = (port: number) =>
    new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
  try {
    await listen(options.port);
  } catch (e) {
    if (!options.port || (e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    await listen(0);
  }
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
