import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { ensureDatabaseSchema } from '../src/db.js';

describe('Status notification schema DDL', () => {
    it('creates the log/outbox tables and indexes (3-phase order)', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-status-ddl-'));
        const dbPath = path.join(dir, 'database.sqlite');
        try {
            ensureDatabaseSchema(dbPath);
            // Running twice must be idempotent (legacy database upgrade path).
            ensureDatabaseSchema(dbPath);

            const db = new Database(dbPath, { readonly: true });
            const tables = (
                db
                    .prepare(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'StatusNotification%' ORDER BY name"
                    )
                    .all() as Array<{ name: string }>
            ).map((r) => r.name);
            const indexes = db
                .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'StatusNotification%'")
                .all() as Array<{ name: string }>;
            db.close();

            assert.deepStrictEqual(tables, ['StatusNotificationLog', 'StatusNotificationOutbox']);
            assert.ok(indexes.length >= 6, `expected >= 6 indexes, got ${indexes.length}`);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
