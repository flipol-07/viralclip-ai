/**
 * API: POST /api/scan
 * Scan all active channels for new videos
 */
import { NextResponse } from 'next/server';
import { scanChannels } from '@/features/processing/services/pipeline';

export async function POST() {
    try {
        const newVideos = await scanChannels();
        return NextResponse.json({
            success: true,
            data: {
                newVideosFound: newVideos.length,
                videos: newVideos,
            }
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
