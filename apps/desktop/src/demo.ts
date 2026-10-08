import { existsSync } from "node:fs";
import { join } from "node:path";

export function createDemoDatabase(directory: string): string {
  const file = join(directory, "demo-shop.sqlite");
  if (existsSync(file)) return file;
  const { DatabaseSync } =
    require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
      CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), status TEXT NOT NULL, total REAL NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO customers VALUES (1, 'Alex Morgan', 'alex@example.com'), (2, 'Sam Taylor', 'sam@example.com'), (3, 'Jordan Lee', 'jordan@example.com');
      INSERT INTO orders VALUES (1001, 1, 'paid', 129.00, '2026-10-01'), (1002, 2, 'pending', 49.90, '2026-10-02'), (1003, 1, 'paid', 259.00, '2026-10-03'), (1004, 3, 'shipped', 89.00, '2026-10-04');
    `);
  } finally {
    db.close();
  }
  return file;
}
