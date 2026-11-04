import pg from 'pg';

/** Local default matches `npm run db`; a shared server sets DATABASE_URL. */
export const DEFAULT_DB_URL = 'postgres://agentview:agentview@127.0.0.1:5433/agentview';

export type Session = { id: string; target: string; title: string; createdAt: string; updatedAt: string };
/** activity: JSON list of the run's steps (who did what with which tool). */
export type Message = { id: number; runId: string | null; role: 'user' | 'assistant' | 'activity' | 'error'; content: string; model: string | null; createdAt: string };

export type Db = Awaited<ReturnType<typeof createDb>>;

/** Sessions (one conversation with an agent or team) and their messages. Run events stay in runs/*.jsonl. */
export async function createDb(url: string, opts: { schema?: string } = {}) {
  if (opts.schema && !/^[a-z_][a-z0-9_]{0,40}$/.test(opts.schema)) throw new Error(`invalid schema name: ${opts.schema}`);
  const pool = new pg.Pool({ connectionString: url, max: 5, ...(opts.schema ? { options: `-c search_path=${opts.schema}` } : {}) });
  if (opts.schema) await pool.query(`create schema if not exists ${opts.schema}`);
  // ponytail: create-if-missing instead of a migration tool; add one when the schema starts changing
  await pool.query(`
    create table if not exists sessions (
      id text primary key,
      target text not null,
      title text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists sessions_target on sessions (target, updated_at desc);
    create table if not exists messages (
      id bigserial primary key,
      session_id text not null references sessions (id) on delete cascade,
      run_id text,
      role text not null,
      content text not null,
      model text,
      created_at timestamptz not null default now()
    );
    create index if not exists messages_session on messages (session_id, id);
  `);

  const toSession = (r: Record<string, unknown>): Session =>
    ({ id: String(r.id), target: String(r.target), title: String(r.title), createdAt: (r.created_at as Date).toISOString(), updatedAt: (r.updated_at as Date).toISOString() });

  return {
    /** Create the session on its first run; later runs only bump updated_at. A session belongs to one target. */
    async touch(id: string, target: string, title: string): Promise<Session> {
      const { rows } = await pool.query(
        `insert into sessions (id, target, title) values ($1, $2, $3)
         on conflict (id) do update set updated_at = now() returning *`, [id, target, title.slice(0, 80) || '새 대화']);
      return toSession(rows[0]);
    },
    async add(sessionId: string, m: Omit<Message, 'id' | 'createdAt'>): Promise<void> {
      await pool.query('insert into messages (session_id, run_id, role, content, model) values ($1, $2, $3, $4, $5)',
        [sessionId, m.runId, m.role, m.content, m.model]);
    },
    async list(target?: string): Promise<Session[]> {
      const { rows } = target
        ? await pool.query('select * from sessions where target = $1 order by updated_at desc limit 200', [target])
        : await pool.query('select * from sessions order by updated_at desc limit 200');
      return rows.map(toSession);
    },
    async get(id: string): Promise<(Session & { messages: Message[] }) | null> {
      const s = await pool.query('select * from sessions where id = $1', [id]);
      if (!s.rows[0]) return null;
      const m = await pool.query('select * from messages where session_id = $1 order by id', [id]);
      return {
        ...toSession(s.rows[0]),
        messages: m.rows.map((r) => ({ id: Number(r.id), runId: r.run_id, role: r.role, content: r.content, model: r.model, createdAt: (r.created_at as Date).toISOString() })),
      };
    },
    async remove(id: string): Promise<boolean> {
      return ((await pool.query('delete from sessions where id = $1', [id])).rowCount ?? 0) > 0;
    },
    close: () => pool.end(),
    dropSchema: (schema: string) => pool.query(`drop schema if exists ${schema} cascade`),
  };
}
