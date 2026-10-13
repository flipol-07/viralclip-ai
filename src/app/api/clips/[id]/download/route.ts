/**
 * API: GET /api/clips/[id]/download
 * Serve clip file for download/preview
 */
import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/shared/lib/local-db';
import fs from 'fs';

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const clips = db.getAllClips();
        const clip = clips.find(c => c.id === id);

        if (!clip || !clip.filePath) {
            return NextResponse.json({ success: false, error: 'Clip not found' }, { status: 404 });
        }

        if (!fs.existsSync(clip.filePath)) {
            return NextResponse.json({ success: false, error: 'Clip file not found on disk' }, { status: 404 });
        }

        const fileBuffer = fs.readFileSync(clip.filePath);
        const stat = fs.statSync(clip.filePath);

        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Length': String(stat.size),
                'Content-Disposition': `inline; filename="${clip.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp4"`,
                'Cache-Control': 'public, max-age=3600',
            },
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
