import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DataSourceKind } from '../types/ecg';
import type { RecordingChunk } from '../engine/ecgEngine';

export interface SessionMeta {
  id: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  source: DataSourceKind;
  deviceId: string | null;
  sampleRateHz: number;
  sampleCount: number;
  avgBpm: number | null;
  minBpm: number | null;
  maxBpm: number | null;
  sdnnMs: number | null;
  rmssdMs: number | null;
  nnCount: number;
  meanQuality: number | null;
  minQuality: number | null;
  notes: string;
  chunkCount: number;
  /** Set when a stored record failed validation on read. */
  corrupt?: boolean;
}

export interface StoredChunk {
  sessionId: string;
  index: number;
  startIndex: number;
  sampleRateHz: number;
  samples: Int16Array;
  leadOff: Uint8Array;
}

interface CardioPulseDB extends DBSchema {
  sessions: { key: string; value: SessionMeta; indexes: { byStartedAt: number } };
  chunks: {
    key: [string, number];
    value: StoredChunk;
    indexes: { bySession: string };
  };
}

const DB_NAME = 'cardiopulse';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<CardioPulseDB>> | null = null;

function db(): Promise<IDBPDatabase<CardioPulseDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CardioPulseDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const sessions = database.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('byStartedAt', 'startedAt');
        const chunks = database.createObjectStore('chunks', { keyPath: ['sessionId', 'index'] });
        chunks.createIndex('bySession', 'sessionId');
      },
    });
  }
  return dbPromise;
}

export function newSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `cp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isValidMeta(value: unknown): value is SessionMeta {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<SessionMeta>;
  return (
    typeof m.id === 'string' &&
    typeof m.startedAt === 'number' &&
    typeof m.endedAt === 'number' &&
    typeof m.sampleRateHz === 'number' &&
    typeof m.sampleCount === 'number' &&
    (m.source === 'simulation' || m.source === 'hardware')
  );
}

/** Persist a finished recording (metadata + all sample chunks) atomically. */
export async function saveSession(meta: SessionMeta, chunks: RecordingChunk[]): Promise<void> {
  const database = await db();
  const tx = database.transaction(['sessions', 'chunks'], 'readwrite');
  const sessions = tx.objectStore('sessions');
  const chunkStore = tx.objectStore('chunks');

  await sessions.put(meta);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    await chunkStore.put({
      sessionId: meta.id,
      index,
      startIndex: chunk.startIndex,
      sampleRateHz: meta.sampleRateHz,
      samples: chunk.samples,
      leadOff: chunk.leadOff,
    });
  }
  await tx.done;
}

export async function listSessions(): Promise<SessionMeta[]> {
  const database = await db();
  const all = await database.getAll('sessions');
  return all
    .map((meta) => (isValidMeta(meta) ? meta : { ...(meta as SessionMeta), corrupt: true }))
    .sort((a, b) => b.startedAt - a.startedAt);
}

export async function getSession(id: string): Promise<SessionMeta | null> {
  const database = await db();
  const meta = await database.get('sessions', id);
  if (!meta) return null;
  return isValidMeta(meta) ? meta : { ...(meta as SessionMeta), corrupt: true };
}

export async function getSessionChunks(sessionId: string): Promise<StoredChunk[]> {
  const database = await db();
  const chunks = await database.getAllFromIndex('chunks', 'bySession', sessionId);
  return chunks.sort((a, b) => a.index - b.index);
}

export async function updateSessionNotes(id: string, notes: string): Promise<void> {
  const database = await db();
  const meta = await database.get('sessions', id);
  if (!meta) return;
  await database.put('sessions', { ...meta, notes });
}

export async function deleteSession(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(['sessions', 'chunks'], 'readwrite');
  const chunkStore = tx.objectStore('chunks');
  const keys = await chunkStore.index('bySession').getAllKeys(id);
  await Promise.all(keys.map((key) => chunkStore.delete(key)));
  await tx.objectStore('sessions').delete(id);
  await tx.done;
}

/** Best-effort storage estimate for the Settings page. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}
