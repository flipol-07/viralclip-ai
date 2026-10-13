/**
 * Standalone processing worker — run with: npm run worker
 *
 * Independent from the Next.js server. On boot it:
 *   1. Heals orphaned videos (in-flight status but no active job) → re-enqueues them
 *   2. Claims jobs from the SQLite queue one at a time (heartbeat keeps ownership)
 *   3. Scans active YouTube channels every SCAN_INTERVAL_MIN minutes
 *
 * Kill it anytime: the pipeline checkpoints per stage / per transcription chunk /
 * per clip, so the next run resumes where it stopped.
 */
import fs from 'fs';
import path from 'path';

// Load .env.local before importing anything that reads process.env at module scope
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (match && !(match[1] in process.env)) {
            process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
        }
    }
}

const HEARTBEAT_MS = 20_000;
const IDLE_POLL_MS = 5_000;
const MAX_ATTEMPTS = 3;
const SCAN_INTERVAL_MS = (parseInt(process.env.SCAN_INTERVAL_MIN || '30', 10)) * 60_000;
const CLEANUP_INTERVAL_MS = 12 * 60 * 60_000;
const KEEP_SOURCE_DAYS = parseInt(process.env.KEEP_SOURCE_DAYS || '7', 10);

/**
 * Disk hygiene: downloaded sources of long-finished videos, stale .part
 * downloads, and render temp dirs. Never touches user-imported files
 * (outside data/videos) nor the rendered clips in output/.
 */
function cleanupDisk(db: typeof import('../src/shared/lib/local-db')) {
    const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR || './data');
    const outputDir = path.resolve(process.cwd(), process.env.OUTPUT_DIR || './output');
    const videosDir = path.join(dataDir, 'videos');
    let freed = 0;

    const rmFile = (p: string) => {
        try {
            freed += fs.statSync(p).size;
            fs.unlinkSync(p);
        } catch { /* ignore */ }
    };

    // Stale partial downloads (>2 days)
    if (fs.existsSync(videosDir)) {
        for (const f of fs.readdirSync(videosDir)) {
            if (f.includes('.part') && Date.now() - fs.statSync(path.join(videosDir, f)).mtimeMs > 2 * 86_400_000) {
                rmFile(path.join(videosDir, f));
            }
        }
    }

    // Downloaded sources of videos finished more than KEEP_SOURCE_DAYS ago
    const cutoff = Date.now() - KEEP_SOURCE_DAYS * 86_400_000;
    for (const video of db.getAllVideos()) {
        if (video.status !== 'done' || video.source === 'local') continue;
        if (!video.localPath || !video.localPath.startsWith(videosDir)) continue;
        if (!video.processedAt || new Date(video.processedAt).getTime() > cutoff) continue;
        if (fs.existsSync(video.localPath)) {
            rmFile(video.localPath);
            db.addLog({ videoId: video.id, action: 'cleanup', status: 'completed', details: { freed: video.localPath } });
        }
    }

    // Render temp leftovers
    for (const sub of ['.tmp', '.plans']) {
        fs.rmSync(path.join(outputDir, sub), { recursive: true, force: true });
    }

    // Chunks del modo live ya procesados (fuera del guard source==='local')
    const liveChunksDir = path.join(videosDir, 'live');
    if (fs.existsSync(liveChunksDir)) {
        for (const f of fs.readdirSync(liveChunksDir)) {
            const p = path.join(liveChunksDir, f);
            if (Date.now() - fs.statSync(p).mtimeMs > KEEP_SOURCE_DAYS * 86_400_000) rmFile(p);
        }
    }

    if (freed > 0) console.log(`[Worker] 🧹 Limpieza: ${(freed / 1e9).toFixed(2)} GB liberados`);
}

async function main() {
    const db = await import('../src/shared/lib/local-db');
    const { processVideo, scanChannels } = await import('../src/features/processing/services/pipeline');

    console.log('═'.repeat(60));
    console.log('🎬 ViralClip Worker started', new Date().toISOString());
    console.log(`   Transcription: ${process.env.GROQ_API_KEY ? 'Groq whisper-large-v3-turbo' : 'OpenAI whisper-1'}`);
    console.log('═'.repeat(60));

    // ---- Heal orphaned videos from previous crashes/shutdowns ----
    const inFlight = ['pending', 'downloading', 'transcribing', 'analyzing', 'clipping'];
    let healed = 0;
    for (const video of db.getAllVideos()) {
        if (inFlight.includes(video.status)) {
            if (db.enqueueProcessVideo(video.id)) healed++;
        }
    }
    if (healed > 0) console.log(`[Worker] Re-enqueued ${healed} unfinished video(s) from previous session`);

    let running = true;
    let lastScan = 0;
    let lastCleanup = 0;
    const shutdown = () => {
        console.log('\n[Worker] Shutting down (current progress is checkpointed — safe to exit)');
        running = false;
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR || './data');
    fs.mkdirSync(dataDir, { recursive: true });
    const heartbeatFile = path.join(dataDir, 'worker.heartbeat');
    const touchHeartbeat = () => { try { fs.writeFileSync(heartbeatFile, String(Date.now())); } catch { /* ignore */ } };
    const livenessTimer = setInterval(touchHeartbeat, 10_000);
    touchHeartbeat();

    while (running) {
        // Periodic disk hygiene
        if (Date.now() - lastCleanup > CLEANUP_INTERVAL_MS) {
            lastCleanup = Date.now();
            try { cleanupDisk(db); } catch (err) { console.error('[Worker] Cleanup failed:', err); }
        }

        // Periodic channel scan → discovers new videos and enqueues them
        if (Date.now() - lastScan > SCAN_INTERVAL_MS) {
            lastScan = Date.now();
            try {
                const found = await scanChannels();
                if (found.length > 0) console.log(`[Worker] Channel scan: ${found.length} new video(s) queued`);
            } catch (err) {
                console.error('[Worker] Channel scan failed:', err);
            }
        }

        const job = db.claimNextJob();
        if (!job) {
            await sleep(IDLE_POLL_MS);
            continue;
        }

        if (job.attempts > MAX_ATTEMPTS) {
            console.error(`[Worker] Job ${job.id} exceeded ${MAX_ATTEMPTS} attempts, marking as failed`);
            db.finishJob(job.id, 'error', `Exceeded ${MAX_ATTEMPTS} attempts: ${job.lastError || 'unknown'}`);
            if (job.videoId) db.updateVideo(job.videoId, { status: 'error', errorMessage: 'Demasiados reintentos. Revisa los logs y reintenta manualmente.' });
            continue;
        }

        const video = job.videoId ? db.getVideo(job.videoId) : undefined;
        console.log(`\n[Worker] ▶ Job ${job.id.slice(0, 8)} (attempt ${job.attempts}): ${video?.title || job.videoId}`);

        const heartbeat = setInterval(() => db.heartbeatJob(job.id), HEARTBEAT_MS);
        try {
            await processVideo(job.videoId!);
            db.finishJob(job.id, 'done');
            console.log(`[Worker] ✔ Job ${job.id.slice(0, 8)} done`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // Leave as queued-retryable by marking error; claimNextJob picks up stale running jobs,
            // but explicit error + re-enqueue keeps the queue legible.
            db.finishJob(job.id, 'error', msg.slice(0, 500));
            if (job.attempts < MAX_ATTEMPTS && job.videoId) {
                console.log(`[Worker] Will retry (${job.attempts}/${MAX_ATTEMPTS})`);
                db.enqueueProcessVideo(job.videoId);
            }
        } finally {
            clearInterval(heartbeat);
        }
    }

    clearInterval(livenessTimer);
    process.exit(0);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
    console.error('[Worker] Fatal:', err);
    process.exit(1);
});
