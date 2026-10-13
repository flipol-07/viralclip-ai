/**
 * API: GET/POST /api/channels
 */
import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/shared/lib/local-db';
import { getChannelInfo } from '@/features/processing/services/youtube-service';

export async function GET() {
    try {
        const channels = db.getAllChannels();
        return NextResponse.json({ success: true, data: channels });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { channelUrl, language = 'es', clipDurationMin = 20, clipDurationMax = 45, captionStyle, maxClipsPerVideo, watermarkText } = body;

        if (!channelUrl) {
            return NextResponse.json({ success: false, error: 'channelUrl is required' }, { status: 400 });
        }

        // Get channel info from YouTube
        const info = getChannelInfo(channelUrl);

        // Check if already exists
        const existing = db.getAllChannels().find(c => c.youtubeChannelId === info.channelId);
        if (existing) {
            return NextResponse.json({ success: false, error: 'Channel already exists' }, { status: 409 });
        }

        const channel = db.addChannel({
            youtubeChannelId: info.channelId,
            channelName: info.channelName,
            channelUrl: channelUrl,
            thumbnailUrl: info.thumbnailUrl,
            language,
            clipDurationMin,
            clipDurationMax,
            isActive: true,
            captionStyle: ['current', 'hormozi', 'clean'].includes(captionStyle) ? captionStyle : undefined,
            maxClipsPerVideo: typeof maxClipsPerVideo === 'number' && maxClipsPerVideo >= 1
                ? Math.min(30, Math.round(maxClipsPerVideo))
                : undefined,
            watermarkText: typeof watermarkText === 'string' && watermarkText.trim()
                ? watermarkText.trim().slice(0, 30)
                : undefined,
        });

        return NextResponse.json({ success: true, data: channel });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
