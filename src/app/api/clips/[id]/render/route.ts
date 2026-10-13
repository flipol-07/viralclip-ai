/**
 * API: POST /api/clips/[id]/render
 * Re-render a single clip. Supports manual trim (startTime/endTime),
 * background music and subtitles toggle. Reframe/layout is automatic.
 */
import { NextResponse } from 'next/server';
import * as db from '@/shared/lib/local-db';
import { createClip } from '@/features/processing/services/video-service';
import { writePublishPack } from '@/features/processing/services/export-service';
import path from 'path';
import fs from 'fs';
import type { Transcript } from '@/shared/types';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { bgMusic, withSubtitles, startTime, endTime, captionStyle } = body as {
        bgMusic?: string; withSubtitles?: boolean; startTime?: number; endTime?: number;
        captionStyle?: import('@/shared/types').CaptionStyleId;
    };

    try {
        const clip = db.getClip(id);
        if (!clip) {
            return NextResponse.json({ success: false, error: 'Clip not found' }, { status: 404 });
        }

        const video = db.getVideo(clip.videoId);
        if (!video || !video.localPath || !fs.existsSync(video.localPath)) {
            return NextResponse.json({ success: false, error: 'Source video not found on disk' }, { status: 404 });
        }

        const transcriptPath = video.transcriptPath
            || path.resolve(process.cwd(), process.env.DATA_DIR || './data', 'transcripts', `${video.youtubeVideoId}.json`);
        let words: Transcript['words'] = [];
        if (fs.existsSync(transcriptPath)) {
            words = (JSON.parse(fs.readFileSync(transcriptPath, 'utf-8')) as Transcript).words || [];
        }

        // Manual trim overrides → single segment; otherwise keep stored segments
        const trimmed = typeof startTime === 'number' || typeof endTime === 'number';
        const newStart = typeof startTime === 'number' ? startTime : clip.startTime;
        const newEnd = typeof endTime === 'number' ? endTime : clip.endTime;
        if (newEnd <= newStart) {
            return NextResponse.json({ success: false, error: 'El fin debe ser mayor que el inicio' }, { status: 400 });
        }
        const segments = !trimmed && clip.segments && clip.segments.length > 0
            ? clip.segments
            : [{ start: newStart, end: newEnd }];

        db.updateClip(id, { status: 'processing' });

        const channel = video.channelId ? db.getChannel(video.channelId) : undefined;
        const result = createClip({
            videoPath: video.localPath,
            clipId: clip.id,
            videoId: video.youtubeVideoId,
            segments,
            words,
            keywords: clip.keywords,
            hookTitle: clip.hookTitle,
            withSubtitles: withSubtitles !== false,
            bgMusic,
            captionStyle: captionStyle ?? clip.captionStyle,
            emoji: clip.emoji,
            watermarkText: channel?.watermarkText,
        });

        const totalDuration = segments.reduce((acc, s) => acc + (s.end - s.start), 0);
        db.updateClip(id, {
            status: 'done',
            filePath: result.filePath,
            hasSubtitles: result.hasSubtitles,
            startTime: segments[0].start,
            endTime: segments[segments.length - 1].end,
            duration: totalDuration,
            segments: segments.length > 1 ? segments : undefined,
            predictedLayout: result.layout === 'split' ? 'split_screen' : 'center_crop',
            backgroundMusic: bgMusic,
            captionStyle: captionStyle ?? clip.captionStyle,
        });

        const updated = db.getClip(id);
        if (updated) {
            try { writePublishPack(updated, video.youtubeVideoId); } catch { /* pack is best-effort */ }
        }

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        db.updateClip(id, { status: 'error' });
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
