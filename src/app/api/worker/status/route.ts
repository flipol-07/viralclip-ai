/**
 * API: GET /api/worker/status
 * Worker liveness (heartbeat file) + queue state.
 */
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import * as db from '@/shared/lib/local-db';

const HEARTBEAT_FILE = path.resolve(process.cwd(), process.env.DATA_DIR || './data', 'worker.heartbeat');

export async function GET() {
    try {
        let workerAlive = false;
        let lastSeen: string | null = null;
        if (fs.existsSync(HEARTBEAT_FILE)) {
            const mtime = fs.statSync(HEARTBEAT_FILE).mtimeMs;
            workerAlive = Date.now() - mtime < 30_000;
            lastSeen = new Date(mtime).toISOString();
        }

        const jobs = db.getJobs(20);
        const active = jobs.filter(j => j.status === 'running' || j.status === 'queued');

        return NextResponse.json({
            success: true,
            data: {
                workerAlive,
                lastSeen,
                queued: active.filter(j => j.status === 'queued').length,
                running: active.filter(j => j.status === 'running').map(j => ({
                    jobId: j.id,
                    videoId: j.videoId,
                    video: j.videoId ? db.getVideo(j.videoId) : null,
                    attempts: j.attempts,
                })),
                recentJobs: jobs.slice(0, 10),
            },
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
