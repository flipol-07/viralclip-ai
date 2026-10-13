/**
 * API: POST /api/clips/[id]/upload
 * Publishes a rendered clip to YouTube as a public Short using the clip's
 * AI-generated title and description. Requires client_secret.json + token.json
 * in the project root (one-time setup: npx tsx scripts/youtube-auth.ts).
 */
import { NextResponse } from 'next/server';
import fs from 'fs';
import * as db from '@/shared/lib/local-db';
import { uploadShortToYouTube } from '@/features/processing/services/youtube-service';

export async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const clip = db.getClip(id);
        if (!clip) {
            return NextResponse.json({ success: false, error: 'Clip not found' }, { status: 404 });
        }
        if (clip.youtubeShortId) {
            return NextResponse.json({ success: false, error: 'Este clip ya está subido a YouTube' }, { status: 409 });
        }
        if (clip.status !== 'done' || !clip.filePath || !fs.existsSync(clip.filePath)) {
            return NextResponse.json({ success: false, error: 'El clip no está renderizado en disco' }, { status: 400 });
        }

        const result = await uploadShortToYouTube({
            videoPath: clip.filePath,
            title: clip.title,
            description: clip.description || clip.title,
            tags: clip.keywords,
        });

        if (!result.success || !result.videoId) {
            return NextResponse.json({ success: false, error: result.error || 'Upload failed' }, { status: 502 });
        }

        db.updateClip(id, { youtubeShortId: result.videoId });
        db.addLog({
            videoId: clip.videoId,
            action: 'complete',
            status: 'completed',
            details: { upload: 'youtube', clipId: id, youtubeShortId: result.videoId },
        });

        return NextResponse.json({ success: true, data: db.getClip(id) });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
