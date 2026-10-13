/**
 * API: GET /api/videos
 */
import { NextResponse } from 'next/server';
import * as db from '@/shared/lib/local-db';

export async function GET() {
    try {
        const videos = db.getAllVideos();
        const channels = db.getAllChannels();

        // Enrich videos with channel names
        const enriched = videos.map(v => ({
            ...v,
            channelName: channels.find(c => c.id === v.channelId)?.channelName || 'Unknown',
        }));

        // Sort by created date descending
        enriched.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return NextResponse.json({ success: true, data: enriched });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
