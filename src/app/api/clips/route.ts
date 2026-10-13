/**
 * API: GET /api/clips
 * Returns all clips with video info
 */
import { NextResponse } from 'next/server';
import * as db from '@/shared/lib/local-db';

export async function GET() {
    try {
        const clips = db.getAllClips();
        const videos = db.getAllVideos();

        // Enrich clips with video titles
        const enriched = clips.map(c => ({
            ...c,
            videoTitle: videos.find(v => v.id === c.videoId)?.title || 'Unknown Video',
            videoYoutubeId: videos.find(v => v.id === c.videoId)?.youtubeVideoId || '',
        }));

        // Sort by score descending
        enriched.sort((a, b) => b.score - a.score);

        return NextResponse.json({ success: true, data: enriched });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
