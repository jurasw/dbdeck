export type DbType = 'mysql' | 'postgres' | 'clickhouse' | 'bigquery' | 'snowflake' | 'mongodb' | 'redis' | 'elasticsearch' | 'docker' | 's3';

export type Family = 'sql' | 'mongo' | 'redis' | 'es' | 'docker' | 's3';

export const FAMILY: Record<DbType, Family> = {
  mysql: 'sql',
  postgres: 'sql',
  clickhouse: 'sql',
  bigquery: 'sql',
  snowflake: 'sql',
  mongodb: 'mongo',
  redis: 'redis',
  elasticsearch: 'es',
  docker: 'docker',
  s3: 's3',
};

export const TYPE_LABEL: Record<DbType, string> = {
  mysql: 'MySQL / MariaDB',
  postgres: 'PostgreSQL',
  clickhouse: 'ClickHouse',
  bigquery: 'BigQuery',
  snowflake: 'Snowflake',
  mongodb: 'MongoDB',
  redis: 'Redis',
  elasticsearch: 'Elasticsearch',
  docker: 'Docker',
  s3: 'S3',
};

export const DEFAULT_PORT: Record<DbType, number> = {
  mysql: 3306,
  postgres: 5432,
  clickhouse: 8123,
  bigquery: 443,
  snowflake: 443,
  mongodb: 27017,
  redis: 6379,
  elasticsearch: 9200,
  docker: 2375,
  s3: 443,
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
  endpoint?: string;
  region?: string;
  forcePathStyle?: boolean;
  project?: string;
  keyFile?: string;
  warehouse?: string;
  role?: string;
  authMethod?: 'token' | 'keyPair';
  showSystem?: boolean;
  readonly?: boolean;
  savePassword?: boolean;
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
  | 's3Bucket'
  | 's3Prefix'
  | 's3Object'
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

export interface ValueMatch {
  column: string;
  value: string;
}

export interface ValueSearchPage {
  matches: ValueMatch[];
  limited: boolean;
}
