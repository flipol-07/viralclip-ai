/**
 * SQLite connection + schema + one-time migration from legacy data/db.json
 * WAL mode allows the Next.js server and the standalone worker to share the DB safely.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR || './data');
const DB_FILE = path.join(DATA_DIR, 'app.db');
const LEGACY_JSON = path.join(DATA_DIR, 'db.json');

let db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    youtube_channel_id TEXT,
    json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    youtube_video_id TEXT,
    channel_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    stage TEXT NOT NULL DEFAULT 'ingest',
    json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_ytid ON videos(youtube_video_id);
CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clips_video ON clips(video_id);
CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    video_id TEXT,
    created_at TEXT NOT NULL,
    json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    video_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    heartbeat_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
`;

/** Additive migrations for DBs created before a column existed */
function migrateSchema(database: Database.Database): void {
    const jobCols = (database.pragma('table_info(jobs)') as { name: string }[]).map(c => c.name);
    if (!jobCols.includes('priority')) {
        database.exec('ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0');
    }
}

export function getDb(): Database.Database {
    if (db) return db;

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    const isNew = !fs.existsSync(DB_FILE);
    db = new Database(DB_FILE);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.exec(SCHEMA);
    migrateSchema(db);

    if (isNew && fs.existsSync(LEGACY_JSON)) {
        migrateFromJson(db);
    }

    return db;
}

function migrateFromJson(database: Database.Database): void {
    try {
        const legacy = JSON.parse(fs.readFileSync(LEGACY_JSON, 'utf-8'));

        const insertChannel = database.prepare(
            'INSERT OR IGNORE INTO channels (id, youtube_channel_id, json) VALUES (?, ?, ?)'
        );
        const insertVideo = database.prepare(
            'INSERT OR IGNORE INTO videos (id, youtube_video_id, channel_id, status, stage, json) VALUES (?, ?, ?, ?, ?, ?)'
        );
        const insertClip = database.prepare(
            'INSERT OR IGNORE INTO clips (id, video_id, status, json) VALUES (?, ?, ?, ?)'
        );

        const tx = database.transaction(() => {
            for (const c of legacy.channels || []) {
                insertChannel.run(c.id, c.youtubeChannelId || null, JSON.stringify(c));
            }
            for (const v of legacy.videos || []) {
                // Orphaned in-flight states from the old system go back to pending
                const stuck = ['downloading', 'transcribing', 'analyzing', 'clipping'];
                const status = stuck.includes(v.status) ? 'pending' : v.status;
                const video = { ...v, status };
                insertVideo.run(v.id, v.youtubeVideoId || null, v.channelId || null, status, 'ingest', JSON.stringify(video));
            }
            for (const c of legacy.clips || []) {
                insertClip.run(c.id, c.videoId, c.status || 'pending', JSON.stringify(c));
            }
        });
        tx();

        fs.renameSync(LEGACY_JSON, LEGACY_JSON + '.migrated');
        console.log('[DB] Migrated legacy db.json → app.db');
    } catch (err) {
        console.error('[DB] Legacy migration failed (continuing with empty DB):', err);
    }
}
