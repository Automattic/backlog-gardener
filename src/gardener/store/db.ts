import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

import { nowIso } from '../ids.js';
import { MIGRATIONS } from './schema.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => DatabaseHandle };

export interface DatabaseHandle {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
  close(): void;
}

export class StoreDb {
  readonly db: DatabaseHandle;

  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
  }

  migrate(): void {
    this.db.exec('BEGIN');
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);
      const get = this.db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
      const insert = this.db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)');
      for (const migration of MIGRATIONS) {
        if (get.get(migration.id) !== undefined) continue;
        this.db.exec(migration.sql);
        insert.run(migration.id, migration.name, nowIso());
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
