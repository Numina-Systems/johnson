import { Database } from "bun:sqlite";

// ── Row types ──────────────────────────────────────────────────────────

export interface DocumentRow {
  rkey: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRow {
  id: string;
  name: string;
  code: string;
  schedule: string;
  deliverTo: string | null;
  format: string | null;
  skill: string | null;
  createdAt: string;
  runCount: number;
  lastRunAt: string | null;
  lastRunOutput: string | null;
  lastRunSuccess: boolean | null;
}

export interface GrantRow {
  skillName: string;
  codeHash: string;
  status: string;
  secrets: ReadonlyArray<string>;
  createdAt: string;
  updatedAt: string;
}

export type GrantStatus = 'pending' | 'granted' | 'revoked';

// ── Store interface ────────────────────────────────────────────────────

export interface Store {
  // Documents (unified notes + skills)
  docUpsert(rkey: string, content: string): void;
  docGet(rkey: string): DocumentRow | null;
  docList(limit?: number, cursor?: string): { documents: DocumentRow[]; cursor?: string };
  docDelete(rkey: string): boolean;
  docSearch(query: string, limit?: number): Array<{ rkey: string; content: string; rank: number }>;

  // Embeddings
  saveEmbedding(rkey: string, embedding: Array<number>, model: string): void;
  getEmbedding(rkey: string): { embedding: Array<number>; model: string; updatedAt: string } | null;
  getAllEmbeddings(): Array<{ rkey: string; embedding: Array<number>; model: string }>;
  getStaleEmbeddings(model: string): Array<{ rkey: string; content: string }>;

  // Sessions
  createSession(id: string, title?: string): void;
  ensureSession(id: string, title?: string): void;
  getSession(id: string): { id: string; title: string | null; createdAt: string; updatedAt: string } | null;
  listSessions(limit?: number): Array<{ id: string; title: string | null; updatedAt: string }>;
  updateSessionTitle(id: string, title: string): void;
  appendMessage(sessionId: string, role: string, content: string): void;
  getMessages(sessionId: string, limit?: number): Array<{ role: string; content: string; createdAt: string }>;
  clearMessages(sessionId: string): void;
  deleteSession(id: string): boolean;
  getSessionMessageCount(sessionId: string): number;

  // Tasks
  saveTask(task: {
    id: string;
    name: string;
    code: string;
    schedule: string;
    deliverTo?: string;
    format?: string;
    skill?: string;
    createdAt: string;
  }): void;
  listTasks(): Array<TaskRow>;
  getTask(id: string): TaskRow | null;
  updateTaskRun(id: string, output: string, success: boolean): void;
  deleteTask(id: string): boolean;

  // Grants (for skill: documents that need secrets)
  saveGrant(skillRkey: string, codeHash: string, status: GrantStatus, secrets?: ReadonlyArray<string>): void;
  getGrant(skillRkey: string): GrantRow | null;
  listGrants(): Array<GrantRow>;
  updateGrantStatus(skillRkey: string, status: GrantStatus): void;
  updateGrantSecrets(skillRkey: string, secrets: ReadonlyArray<string>): void;
  deleteGrant(skillRkey: string): boolean;

  // Discord managed threads
  addManagedThread(threadId: string, parentChannelId: string): void;
  removeManagedThread(threadId: string): boolean;
  getManagedThreadIds(): Set<string>;

  /** Close the underlying database connection */
  close(): void;
}

// ── Helpers ────────────────────────────────────────────────────────────

function iso(): string {
  return new Date().toISOString();
}

function blobToFloat32(blob: Buffer | Uint8Array): Array<number> {
  const u8 = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  const f32 = new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
  return Array.from(f32);
}

function float32ToBuffer(arr: Array<number>): Buffer {
  return Buffer.from(new Float32Array(arr).buffer);
}

function mapTaskRow(r: any): TaskRow {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    schedule: r.schedule,
    deliverTo: r.deliver_to ?? null,
    format: r.format ?? null,
    skill: r.skill ?? null,
    createdAt: r.created_at,
    runCount: r.run_count ?? 0,
    lastRunAt: r.last_run_at ?? null,
    lastRunOutput: r.last_run_output ?? null,
    lastRunSuccess: r.last_run_success == null ? null : Boolean(r.last_run_success),
  };
}

function mapGrantRow(r: any): GrantRow {
  return {
    skillName: r.skill_name,
    codeHash: r.code_hash,
    status: r.status,
    secrets: r.secrets ? JSON.parse(r.secrets) : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Schema ─────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  rkey TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  rkey, content, content=documents, content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, rkey, content) VALUES (new.rowid, new.rkey, new.content);
END;

CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, rkey, content) VALUES('delete', old.rowid, old.rkey, old.content);
END;

CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, rkey, content) VALUES('delete', old.rowid, old.rkey, old.content);
  INSERT INTO documents_fts(rowid, rkey, content) VALUES (new.rowid, new.rkey, new.content);
END;

CREATE TABLE IF NOT EXISTS embeddings (
  rkey TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  schedule TEXT NOT NULL,
  deliver_to TEXT,
  format TEXT,
  skill TEXT,
  created_at TEXT NOT NULL,
  run_count INTEGER DEFAULT 0,
  last_run_at TEXT,
  last_run_output TEXT,
  last_run_success INTEGER
);

CREATE TABLE IF NOT EXISTS grants (
  skill_name TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  secrets TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discord_threads (
  thread_id TEXT PRIMARY KEY,
  parent_channel_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

// ── Factory ────────────────────────────────────────────────────────────

export function createStore(dbPath: string): Store {
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(SCHEMA);

  // ── Prepared statements ──────────────────────────────────────────

  // Documents
  const stmtDocUpsert = db.prepare(
    `INSERT INTO documents (rkey, content, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(rkey) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
  );
  const stmtDocGet = db.prepare(
    `SELECT rkey, content, created_at, updated_at FROM documents WHERE rkey = ?`,
  );
  const stmtDocList = db.prepare(
    `SELECT rkey, content, created_at, updated_at FROM documents
     WHERE rkey > ? ORDER BY rkey LIMIT ?`,
  );
  const stmtDocListAll = db.prepare(
    `SELECT rkey, content, created_at, updated_at FROM documents ORDER BY rkey LIMIT ?`,
  );
  const stmtDocDelete = db.prepare(`DELETE FROM documents WHERE rkey = ?`);
  const stmtDocSearch = db.prepare(
    `SELECT d.rkey, d.content, rank
     FROM documents_fts f
     JOIN documents d ON d.rowid = f.rowid
     WHERE documents_fts MATCH ?
     ORDER BY rank
     LIMIT ?`,
  );

  // Embeddings
  const stmtUpsertEmbed = db.prepare(
    `INSERT INTO embeddings (rkey, embedding, model, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(rkey) DO UPDATE SET embedding = excluded.embedding, model = excluded.model, updated_at = excluded.updated_at`,
  );
  const stmtGetEmbed = db.prepare(
    `SELECT embedding, model, updated_at FROM embeddings WHERE rkey = ?`,
  );
  const stmtAllEmbeds = db.prepare(
    `SELECT rkey, embedding, model FROM embeddings`,
  );
  const stmtStaleEmbeds = db.prepare(
    `SELECT d.rkey, d.content FROM documents d
     LEFT JOIN embeddings e ON e.rkey = d.rkey
     WHERE e.rkey IS NULL OR e.model != ? OR e.updated_at < d.updated_at`,
  );

  // Sessions
  const stmtCreateSession = db.prepare(
    `INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  );
  const stmtGetSession = db.prepare(
    `SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?`,
  );
  const stmtListSessions = db.prepare(
    `SELECT id, title, updated_at FROM sessions ORDER BY updated_at DESC LIMIT ?`,
  );
  const stmtUpdateTitle = db.prepare(
    `UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`,
  );
  const stmtAppendMsg = db.prepare(
    `INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)`,
  );
  const stmtUpdateSessionTs = db.prepare(
    `UPDATE sessions SET updated_at = ? WHERE id = ?`,
  );
  const stmtGetMessages = db.prepare(
    `SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT ?`,
  );
  const stmtEnsureSession = db.prepare(
    `INSERT OR IGNORE INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  );
  const stmtClearMessages = db.prepare(
    `DELETE FROM messages WHERE session_id = ?`,
  );
  const stmtDeleteSession = db.prepare(
    `DELETE FROM sessions WHERE id = ?`,
  );
  const stmtSessionMessageCount = db.prepare(
    `SELECT COUNT(*) as count FROM messages WHERE session_id = ?`,
  );

  // Tasks
  const stmtSaveTask = db.prepare(
    `INSERT INTO tasks (id, name, code, schedule, deliver_to, format, skill, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, code=excluded.code, schedule=excluded.schedule,
       deliver_to=excluded.deliver_to, format=excluded.format, skill=excluded.skill`,
  );
  const stmtListTasks = db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`);
  const stmtGetTask = db.prepare(`SELECT * FROM tasks WHERE id = ?`);
  const stmtUpdateTaskRun = db.prepare(
    `UPDATE tasks SET run_count = run_count + 1, last_run_at = ?, last_run_output = ?, last_run_success = ? WHERE id = ?`,
  );
  const stmtDeleteTask = db.prepare(`DELETE FROM tasks WHERE id = ?`);

  // Grants
  const stmtSaveGrant = db.prepare(
    `INSERT INTO grants (skill_name, code_hash, status, secrets, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(skill_name) DO UPDATE SET code_hash=excluded.code_hash, status=excluded.status,
       secrets=excluded.secrets, updated_at=excluded.updated_at`,
  );
  const stmtGetGrant = db.prepare(`SELECT * FROM grants WHERE skill_name = ?`);
  const stmtListGrants = db.prepare(`SELECT * FROM grants ORDER BY created_at DESC`);
  const stmtUpdateGrantStatus = db.prepare(
    `UPDATE grants SET status = ?, updated_at = ? WHERE skill_name = ?`,
  );
  const stmtUpdateGrantSecrets = db.prepare(
    `UPDATE grants SET secrets = ?, updated_at = ? WHERE skill_name = ?`,
  );
  const stmtDeleteGrant = db.prepare(`DELETE FROM grants WHERE skill_name = ?`);

  // Discord threads
  const stmtAddThread = db.prepare(
    `INSERT OR IGNORE INTO discord_threads (thread_id, parent_channel_id, created_at) VALUES (?, ?, ?)`,
  );
  const stmtRemoveThread = db.prepare(`DELETE FROM discord_threads WHERE thread_id = ?`);
  const stmtListThreads = db.prepare(`SELECT thread_id FROM discord_threads`);

  // ── Store implementation ─────────────────────────────────────────

  const store: Store = {
    // ── Documents ──────────────────────────────────────────────────
    docUpsert(rkey: string, content: string): void {
      const now = iso();
      stmtDocUpsert.run(rkey, content, now, now);
    },

    docGet(rkey: string): DocumentRow | null {
      const row = stmtDocGet.get(rkey) as any | null;
      if (!row) return null;
      return { rkey: row.rkey, content: row.content, createdAt: row.created_at, updatedAt: row.updated_at };
    },

    docList(limit = 50, cursor?: string): { documents: DocumentRow[]; cursor?: string } {
      const fetchLimit = Math.max(1, Math.min(limit, 500));
      const rows = cursor
        ? (stmtDocList.all(cursor, fetchLimit + 1) as any[])
        : (stmtDocListAll.all(fetchLimit + 1) as any[]);

      let nextCursor: string | undefined;
      if (rows.length > fetchLimit) {
        rows.pop();
        nextCursor = rows[rows.length - 1]?.rkey;
      }

      const documents = rows.map((r: any) => ({
        rkey: r.rkey,
        content: r.content,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));

      const result: { documents: DocumentRow[]; cursor?: string } = { documents };
      if (nextCursor) result.cursor = nextCursor;
      return result;
    },

    docDelete(rkey: string): boolean {
      return stmtDocDelete.run(rkey).changes > 0;
    },

    docSearch(query: string, limit = 20): Array<{ rkey: string; content: string; rank: number }> {
      return stmtDocSearch.all(query, limit) as Array<{ rkey: string; content: string; rank: number }>;
    },

    // ── Embeddings ────────────────────────────────────────────────
    saveEmbedding(rkey: string, embedding: Array<number>, model: string): void {
      stmtUpsertEmbed.run(rkey, float32ToBuffer(embedding), model, iso());
    },

    getEmbedding(rkey: string): { embedding: Array<number>; model: string; updatedAt: string } | null {
      const row = stmtGetEmbed.get(rkey) as { embedding: Buffer; model: string; updated_at: string } | null;
      if (!row) return null;
      return { embedding: blobToFloat32(row.embedding), model: row.model, updatedAt: row.updated_at };
    },

    getAllEmbeddings(): Array<{ rkey: string; embedding: Array<number>; model: string }> {
      const rows = stmtAllEmbeds.all() as Array<{ rkey: string; embedding: Buffer; model: string }>;
      return rows.map((r) => ({ rkey: r.rkey, embedding: blobToFloat32(r.embedding), model: r.model }));
    },

    getStaleEmbeddings(model: string): Array<{ rkey: string; content: string }> {
      return stmtStaleEmbeds.all(model) as Array<{ rkey: string; content: string }>;
    },

    // ── Sessions ──────────────────────────────────────────────────
    createSession(id: string, title?: string): void {
      const now = iso();
      stmtCreateSession.run(id, title ?? null, now, now);
    },

    ensureSession(id: string, title?: string): void {
      const now = iso();
      stmtEnsureSession.run(id, title ?? null, now, now);
    },

    getSession(id: string): { id: string; title: string | null; createdAt: string; updatedAt: string } | null {
      const row = stmtGetSession.get(id) as any | null;
      if (!row) return null;
      return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
    },

    listSessions(limit = 50): Array<{ id: string; title: string | null; updatedAt: string }> {
      const rows = stmtListSessions.all(limit) as Array<{ id: string; title: string | null; updated_at: string }>;
      return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
    },

    updateSessionTitle(id: string, title: string): void {
      stmtUpdateTitle.run(title, iso(), id);
    },

    appendMessage(sessionId: string, role: string, content: string): void {
      const now = iso();
      stmtAppendMsg.run(sessionId, role, content, now);
      stmtUpdateSessionTs.run(now, sessionId);
    },

    getMessages(sessionId: string, limit = 200): Array<{ role: string; content: string; createdAt: string }> {
      const rows = stmtGetMessages.all(sessionId, limit) as Array<{ role: string; content: string; created_at: string }>;
      return rows.map((r) => ({ role: r.role, content: r.content, createdAt: r.created_at }));
    },

    clearMessages(sessionId: string): void {
      stmtClearMessages.run(sessionId);
    },

    deleteSession(id: string): boolean {
      stmtClearMessages.run(id);
      return stmtDeleteSession.run(id).changes > 0;
    },

    getSessionMessageCount(sessionId: string): number {
      const row = stmtSessionMessageCount.get(sessionId) as { count: number } | null;
      return row?.count ?? 0;
    },

    // ── Tasks ─────────────────────────────────────────────────────
    saveTask(task): void {
      stmtSaveTask.run(
        task.id, task.name, task.code, task.schedule,
        task.deliverTo ?? null, task.format ?? null, task.skill ?? null,
        task.createdAt,
      );
    },

    listTasks(): Array<TaskRow> {
      return (stmtListTasks.all() as any[]).map(mapTaskRow);
    },

    getTask(id: string): TaskRow | null {
      const row = stmtGetTask.get(id) as any | null;
      return row ? mapTaskRow(row) : null;
    },

    updateTaskRun(id: string, output: string, success: boolean): void {
      stmtUpdateTaskRun.run(iso(), output, success ? 1 : 0, id);
    },

    deleteTask(id: string): boolean {
      return stmtDeleteTask.run(id).changes > 0;
    },

    // ── Grants ────────────────────────────────────────────────────
    saveGrant(skillRkey: string, codeHash: string, status: GrantStatus, secrets?: ReadonlyArray<string>): void {
      const now = iso();
      stmtSaveGrant.run(skillRkey, codeHash, status, JSON.stringify(secrets ?? []), now, now);
    },

    getGrant(skillRkey: string): GrantRow | null {
      const row = stmtGetGrant.get(skillRkey) as any | null;
      return row ? mapGrantRow(row) : null;
    },

    listGrants(): Array<GrantRow> {
      return (stmtListGrants.all() as any[]).map(mapGrantRow);
    },

    updateGrantStatus(skillRkey: string, status: GrantStatus): void {
      stmtUpdateGrantStatus.run(status, iso(), skillRkey);
    },

    updateGrantSecrets(skillRkey: string, secrets: ReadonlyArray<string>): void {
      stmtUpdateGrantSecrets.run(JSON.stringify(secrets), iso(), skillRkey);
    },

    deleteGrant(skillRkey: string): boolean {
      return stmtDeleteGrant.run(skillRkey).changes > 0;
    },

    // ── Discord Threads ──────────────────────────────────────────
    addManagedThread(threadId: string, parentChannelId: string): void {
      stmtAddThread.run(threadId, parentChannelId, iso());
    },

    removeManagedThread(threadId: string): boolean {
      return stmtRemoveThread.run(threadId).changes > 0;
    },

    getManagedThreadIds(): Set<string> {
      const rows = stmtListThreads.all() as Array<{ thread_id: string }>;
      return new Set(rows.map((r) => r.thread_id));
    },

    // ── Lifecycle ─────────────────────────────────────────────────
    close(): void {
      db.close();
    },
  };

  return store;
}
