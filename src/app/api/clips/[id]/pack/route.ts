/**
 * API: GET /api/clips/[id]/pack
 * Publish pack for manual upload: per-platform copy ready to paste,
 * and the publish/ folder written/refreshed on disk.
 */
import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/shared/lib/local-db';
import { buildPackTexts, writePublishPack } from '@/features/processing/services/export-service';

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const clip = db.getClip(id);
        if (!clip) {
            return NextResponse.json({ success: false, error: 'Clip not found' }, { status: 404 });
        }

        const video = db.getVideo(clip.videoId);
        const folder = video ? writePublishPack(clip, video.youtubeVideoId) : null;

        return NextResponse.json({
            success: true,
            data: { texts: buildPackTexts(clip), folder },
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
