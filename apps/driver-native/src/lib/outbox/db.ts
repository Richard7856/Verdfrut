// SQLite wrapper para el outbox. expo-sqlite, modo async (SDK 53+).
//
// Una sola DB (`tripdrive-outbox.db`), una tabla (`outbox`) con índices por
// status y created_at para queries eficientes del worker.
//
// El esquema se crea idempotentemente en `openOutboxDb()` — no usamos
// expo-sqlite migrations, no es necesario para 1 tabla.

import * as SQLite from 'expo-sqlite';
import type { OutboxItem, OutboxStatus } from './types';

const DB_NAME = 'tripdrive-outbox.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openOutboxDb(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_attempt_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);
    CREATE INDEX IF NOT EXISTS idx_outbox_created_at ON outbox(created_at);
  `);
  return db;
}

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openOutboxDb();
  }
  return dbPromise;
}

interface OutboxRow {
  id: string;
  type: string;
  status: string;
  payload: string;
  attempts: number;
  last_error: string | null;
  last_attempt_at: number | null;
  created_at: number;
}

function toItem(row: OutboxRow): OutboxItem {
  return {
    id: row.id,
    type: row.type as OutboxItem['type'],
    status: row.status as OutboxStatus,
    payload: row.payload,
    attempts: row.attempts,
    lastError: row.last_error,
    lastAttemptAt: row.last_attempt_at,
    createdAt: row.created_at,
  };
}

export async function insertItem(item: OutboxItem): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO outbox (id, type, status, payload, attempts, last_error, last_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.type,
      item.status,
      item.payload,
      item.attempts,
      item.lastError,
      item.lastAttemptAt,
      item.createdAt,
    ],
  );
}

export async function updateItem(
  id: string,
  patch: Partial<Pick<OutboxItem, 'status' | 'attempts' | 'lastError' | 'lastAttemptAt'>>,
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (patch.status !== undefined) {
    sets.push('status = ?');
    args.push(patch.status);
  }
  if (patch.attempts !== undefined) {
    sets.push('attempts = ?');
    args.push(patch.attempts);
  }
  if (patch.lastError !== undefined) {
    sets.push('last_error = ?');
    args.push(patch.lastError);
  }
  if (patch.lastAttemptAt !== undefined) {
    sets.push('last_attempt_at = ?');
    args.push(patch.lastAttemptAt);
  }
  if (sets.length === 0) return;
  args.push(id);
  await db.runAsync(`UPDATE outbox SET ${sets.join(', ')} WHERE id = ?`, args);
}

export async function deleteItem(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM outbox WHERE id = ?`, [id]);
}

export async function listAll(): Promise<OutboxItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<OutboxRow>(
    `SELECT * FROM outbox ORDER BY created_at ASC`,
  );
  return rows.map(toItem);
}

export async function listByStatus(status: OutboxStatus): Promise<OutboxItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<OutboxRow>(
    `SELECT * FROM outbox WHERE status = ? ORDER BY created_at ASC`,
    [status],
  );
  return rows.map(toItem);
}

export async function getItem(id: string): Promise<OutboxItem | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<OutboxRow>(
    `SELECT * FROM outbox WHERE id = ?`,
    [id],
  );
  return row ? toItem(row) : null;
}

/**
 * Para ejecutarse al iniciar el worker después de un crash: cualquier item
 * que quedó `in_flight` lo regresamos a `pending` para que se reintente.
 */
export async function resetOrphanedInFlight(): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(`UPDATE outbox SET status = 'pending' WHERE status = 'in_flight'`);
  return result.changes;
}

/**
 * Cuenta items por status — para el indicador en RouteHeader.
 */
export async function countByStatus(): Promise<Record<OutboxStatus, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ status: string; n: number }>(
    `SELECT status, COUNT(*) as n FROM outbox GROUP BY status`,
  );
  const result: Record<OutboxStatus, number> = {
    pending: 0,
    in_flight: 0,
    failed: 0,
    done: 0,
  };
  for (const row of rows) {
    if (row.status in result) {
      result[row.status as OutboxStatus] = row.n;
    }
  }
  return result;
}
