export type DbType = 'mysql' | 'postgres' | 'clickhouse' | 'mongodb' | 'redis' | 'elasticsearch' | 'docker';

export type Family = 'sql' | 'mongo' | 'redis' | 'es' | 'docker';

export const FAMILY: Record<DbType, Family> = {
  mysql: 'sql',
  postgres: 'sql',
  clickhouse: 'sql',
  mongodb: 'mongo',
  redis: 'redis',
  elasticsearch: 'es',
  docker: 'docker',
};

export const TYPE_LABEL: Record<DbType, string> = {
  mysql: 'MySQL / MariaDB',
  postgres: 'PostgreSQL',
  clickhouse: 'ClickHouse',
  mongodb: 'MongoDB',
  redis: 'Redis',
  elasticsearch: 'Elasticsearch',
  docker: 'Docker',
};

export const DEFAULT_PORT: Record<DbType, number> = {
  mysql: 3306,
  postgres: 5432,
  clickhouse: 8123,
  mongodb: 27017,
  redis: 6379,
  elasticsearch: 9200,
  docker: 2375,
};

export interface SshConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

export interface ConnectionConfig {
  id: string;
  name: string;
  type: DbType;
  group?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
  rejectUnauthorized?: boolean;
  useUri?: boolean;
  uri?: string;
  authSource?: string;
  apiKey?: string;
  useSocket?: boolean;
  socketPath?: string;
  showSystem?: boolean;
  readonly?: boolean;
  ssh?: SshConfig;
}

export type NodeKind =
  | 'connection'
  | 'group'
  | 'database'
  | 'schema'
  | 'folder'
  | 'table'
  | 'view'
  | 'routine'
  | 'column'
  | 'collection'
  | 'redisDb'
  | 'redisFolder'
  | 'redisKey'
  | 'esIndex'
  | 'esField'
  | 'dockerFolder'
  | 'container'
  | 'image'
  | 'volume'
  | 'network'
  | 'info'
  | 'error';

export interface DbNode {
  connId: string;
  kind: NodeKind;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  color?: string;
  leaf?: boolean;
  expanded?: boolean;
  tags?: string;
  database?: string;
  schema?: string;
  table?: string;
  key?: string;
  prefix?: string;
  ref?: string;
  extra?: Record<string, unknown>;
}

export interface ColumnMeta {
  name: string;
  type?: string;
  pk?: boolean;
  nullable?: boolean;
  defaultValue?: string | null;
  comment?: string;
}

export interface QueryResult {
  columns: ColumnMeta[];
  rows: unknown[][];
  affectedRows?: number;
  message?: string;
  durationMs: number;
  sql?: string;
  error?: string;
  json?: unknown;
  truncated?: boolean;
}

export interface TableRef {
  database?: string;
  schema?: string;
  table: string;
}
