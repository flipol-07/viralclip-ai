/**
 * API: POST /api/process/[videoId]
 * Enqueue a video for the worker. Works for any non-done state (retry/resume friendly).
 */
import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/shared/lib/local-db';

export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ videoId: string }> }
) {
    try {
        const { videoId } = await params;

        const video = db.getVideo(videoId);
        if (!video) {
            return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 });
        }

        if (video.status === 'done') {
            return NextResponse.json({ success: false, error: 'El vídeo ya está procesado' }, { status: 400 });
        }

        const job = db.enqueueProcessVideo(videoId);

        // Reset error state so the pipeline resumes from its checkpoint
        if (video.status === 'error') {
            db.updateVideo(videoId, { status: 'pending', errorMessage: undefined });
        }

        return NextResponse.json({
            success: true,
            data: {
                message: job ? 'Encolado para el worker' : 'Ya estaba en cola',
                videoId,
                jobId: job?.id,
            },
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
