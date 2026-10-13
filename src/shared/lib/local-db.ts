/**
 * Data access layer backed by SQLite (better-sqlite3, WAL mode).
 * Keeps the same function API the UI/routes already use, plus the jobs queue
 * shared between the Next.js server and the standalone worker.
 */
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './sqlite';
import type { Channel, Video, Clip, ProcessingLog, Job, JobStatus } from '@/shared/types';

const parse = <T>(row: { json: string } | undefined): T | undefined =>
    row ? (JSON.parse(row.json) as T) : undefined;

const parseAll = <T>(rows: { json: string }[]): T[] => rows.map(r => JSON.parse(r.json) as T);

// ============ CHANNELS ============
export function getAllChannels(): Channel[] {
    return parseAll<Channel>(getDb().prepare('SELECT json FROM channels').all() as { json: string }[]);
}

export function getChannel(id: string): Channel | undefined {
    // Accept both internal UUID and YouTube channel id (old data mixed them up)
    const row = getDb().prepare('SELECT json FROM channels WHERE id = ? OR youtube_channel_id = ?').get(id, id) as { json: string } | undefined;
    return parse<Channel>(row);
}

export function addChannel(data: Omit<Channel, 'id' | 'createdAt' | 'updatedAt'>): Channel {
    const channel: Channel = {
        ...data,
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    getDb().prepare('INSERT INTO channels (id, youtube_channel_id, json) VALUES (?, ?, ?)')
        .run(channel.id, channel.youtubeChannelId || null, JSON.stringify(channel));
    return channel;
}

export function updateChannel(id: string, data: Partial<Channel>): Channel | null {
    const existing = getChannel(id);
    if (!existing) return null;
    const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
    getDb().prepare('UPDATE channels SET youtube_channel_id = ?, json = ? WHERE id = ?')
        .run(updated.youtubeChannelId || null, JSON.stringify(updated), existing.id);
    return updated;
}

export function deleteChannel(id: string): boolean {
    const db = getDb();
    const videoIds = (db.prepare('SELECT id FROM videos WHERE channel_id = ?').all(id) as { id: string }[]).map(r => r.id);
    const tx = db.transaction(() => {
        for (const vid of videoIds) {
            db.prepare('DELETE FROM clips WHERE video_id = ?').run(vid);
            db.prepare('DELETE FROM jobs WHERE video_id = ?').run(vid);
        }
        db.prepare('DELETE FROM videos WHERE channel_id = ?').run(id);
        return db.prepare('DELETE FROM channels WHERE id = ?').run(id).changes > 0;
    });
    return tx();
}

// ============ VIDEOS ============
export function getAllVideos(): Video[] {
    return parseAll<Video>(getDb().prepare('SELECT json FROM videos').all() as { json: string }[]);
}

export function getVideo(id: string): Video | undefined {
    const row = getDb().prepare('SELECT json FROM videos WHERE id = ?').get(id) as { json: string } | undefined;
    return parse<Video>(row);
}

export function getVideoByYoutubeId(youtubeVideoId: string): Video | undefined {
    const row = getDb().prepare('SELECT json FROM videos WHERE youtube_video_id = ?').get(youtubeVideoId) as { json: string } | undefined;
    return parse<Video>(row);
}

export function getVideosByChannel(channelId: string): Video[] {
    return parseAll<Video>(getDb().prepare('SELECT json FROM videos WHERE channel_id = ?').all(channelId) as { json: string }[]);
}

export function getVideosByStatus(status: Video['status']): Video[] {
    return parseAll<Video>(getDb().prepare('SELECT json FROM videos WHERE status = ?').all(status) as { json: string }[]);
}

export function addVideo(data: Omit<Video, 'id' | 'createdAt'>): Video {
    const video: Video = {
        ...data,
        id: uuidv4(),
        stage: data.stage || 'ingest',
        createdAt: new Date().toISOString(),
    };
    getDb().prepare('INSERT INTO videos (id, youtube_video_id, channel_id, status, stage, json) VALUES (?, ?, ?, ?, ?, ?)')
        .run(video.id, video.youtubeVideoId || null, video.channelId || null, video.status, video.stage, JSON.stringify(video));
    return video;
}

export function updateVideo(id: string, data: Partial<Video>): Video | null {
    const existing = getVideo(id);
    if (!existing) return null;
    const updated = { ...existing, ...data };
    getDb().prepare('UPDATE videos SET youtube_video_id = ?, channel_id = ?, status = ?, stage = ?, json = ? WHERE id = ?')
        .run(updated.youtubeVideoId || null, updated.channelId || null, updated.status, updated.stage || 'ingest', JSON.stringify(updated), id);
    return updated;
}

export function deleteVideo(id: string): boolean {
    const db = getDb();
    db.prepare('DELETE FROM clips WHERE video_id = ?').run(id);
    db.prepare('DELETE FROM jobs WHERE video_id = ?').run(id);
    return db.prepare('DELETE FROM videos WHERE id = ?').run(id).changes > 0;
}

// ============ CLIPS ============
export function getAllClips(): Clip[] {
    return parseAll<Clip>(getDb().prepare('SELECT json FROM clips').all() as { json: string }[]);
}

export function getClip(id: string): Clip | undefined {
    const row = getDb().prepare('SELECT json FROM clips WHERE id = ?').get(id) as { json: string } | undefined;
    return parse<Clip>(row);
}

export function getClipsByVideo(videoId: string): Clip[] {
    return parseAll<Clip>(getDb().prepare('SELECT json FROM clips WHERE video_id = ?').all(videoId) as { json: string }[]);
}

export function addClip(data: Omit<Clip, 'id' | 'createdAt'>): Clip {
    const clip: Clip = {
        ...data,
        id: uuidv4(),
        createdAt: new Date().toISOString(),
    };
    getDb().prepare('INSERT INTO clips (id, video_id, status, json) VALUES (?, ?, ?, ?)')
        .run(clip.id, clip.videoId, clip.status, JSON.stringify(clip));
    return clip;
}

export function updateClip(id: string, data: Partial<Clip>): Clip | null {
    const existing = getClip(id);
    if (!existing) return null;
    const updated = { ...existing, ...data };
    getDb().prepare('UPDATE clips SET status = ?, json = ? WHERE id = ?')
        .run(updated.status, JSON.stringify(updated), id);
    return updated;
}

export function deleteClip(id: string): boolean {
    const clip = getClip(id);
    if (!clip) return false;
    if (clip.filePath && fs.existsSync(clip.filePath)) {
        try { fs.unlinkSync(clip.filePath); } catch { /* best effort */ }
    }
    return getDb().prepare('DELETE FROM clips WHERE id = ?').run(id).changes > 0;
}

// ============ LOGS ============
export function addLog(data: Omit<ProcessingLog, 'id' | 'createdAt'>): ProcessingLog {
    const log: ProcessingLog = {
        ...data,
        id: uuidv4(),
        createdAt: new Date().toISOString(),
    };
    const db = getDb();
    db.prepare('INSERT INTO logs (id, video_id, created_at, json) VALUES (?, ?, ?, ?)')
        .run(log.id, log.videoId || null, log.createdAt, JSON.stringify(log));
    // Keep table bounded
    db.prepare('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY created_at DESC LIMIT 1000)').run();
    return log;
}

export function getRecentLogs(limit: number = 50): ProcessingLog[] {
    return parseAll<ProcessingLog>(
        getDb().prepare('SELECT json FROM logs ORDER BY created_at DESC LIMIT ?').all(limit) as { json: string }[]
    );
}

// ============ JOBS (worker queue) ============
export function enqueueProcessVideo(videoId: string, priority: number = 0): Job | null {
    const db = getDb();
    // Idempotent: don't duplicate an active job for the same video
    const active = db.prepare("SELECT id FROM jobs WHERE video_id = ? AND status IN ('queued','running')").get(videoId);
    if (active) return null;

    const now = new Date().toISOString();
    const job: Job = {
        id: uuidv4(),
        type: 'process_video',
        videoId,
        status: 'queued',
        attempts: 0,
        priority,
        createdAt: now,
        updatedAt: now,
    };
    db.prepare('INSERT INTO jobs (id, type, video_id, status, attempts, priority, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)')
        .run(job.id, job.type, videoId, job.status, priority, now, now);
    return job;
}

interface JobRow {
    id: string; type: string; video_id: string | null; status: string;
    attempts: number; priority: number; last_error: string | null; heartbeat_at: string | null;
    created_at: string; updated_at: string;
}

function rowToJob(r: JobRow): Job {
    return {
        id: r.id,
        type: r.type as Job['type'],
        videoId: r.video_id || undefined,
        status: r.status as JobStatus,
        attempts: r.attempts,
        priority: r.priority,
        lastError: r.last_error || undefined,
        heartbeatAt: r.heartbeat_at || undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

/** Atomically claim the next runnable job (queued, or running with stale heartbeat). */
export function claimNextJob(staleMs: number = 90_000): Job | null {
    const db = getDb();
    const staleBefore = new Date(Date.now() - staleMs).toISOString();
    const now = new Date().toISOString();

    const tx = db.transaction((): Job | null => {
        const row = db.prepare(
            `SELECT * FROM jobs
             WHERE status = 'queued' OR (status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < ?))
             ORDER BY priority DESC, created_at ASC LIMIT 1`
        ).get(staleBefore) as JobRow | undefined;
        if (!row) return null;
        db.prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1, heartbeat_at = ?, updated_at = ? WHERE id = ?")
            .run(now, now, row.id);
        return rowToJob({ ...row, status: 'running', attempts: row.attempts + 1, heartbeat_at: now });
    });
    return tx();
}

export function heartbeatJob(jobId: string): void {
    const now = new Date().toISOString();
    getDb().prepare('UPDATE jobs SET heartbeat_at = ?, updated_at = ? WHERE id = ?').run(now, now, jobId);
}

export function finishJob(jobId: string, status: 'done' | 'error', error?: string): void {
    const now = new Date().toISOString();
    getDb().prepare('UPDATE jobs SET status = ?, last_error = ?, updated_at = ? WHERE id = ?')
        .run(status, error || null, now, jobId);
}

export function getJobs(limit: number = 50): Job[] {
    const rows = getDb().prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit) as JobRow[];
    return rows.map(rowToJob);
}

export function getActiveJobs(): Job[] {
    const rows = getDb().prepare("SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at ASC").all() as JobRow[];
    return rows.map(rowToJob);
}

// ============ STATS ============
export function getStats() {
    const db = getDb();
    const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
    return {
        totalChannels: getAllChannels().filter(c => c.isActive).length,
        totalVideos: count('SELECT COUNT(*) n FROM videos'),
        processedVideos: count("SELECT COUNT(*) n FROM videos WHERE status = 'done'"),
        pendingVideos: count("SELECT COUNT(*) n FROM videos WHERE status = 'pending'"),
        errorVideos: count("SELECT COUNT(*) n FROM videos WHERE status = 'error'"),
        totalClips: count("SELECT COUNT(*) n FROM clips WHERE status = 'done'"),
        processingVideos: count("SELECT COUNT(*) n FROM videos WHERE status NOT IN ('done','error','pending')"),
        activeJobs: count("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')"),
    };
}
