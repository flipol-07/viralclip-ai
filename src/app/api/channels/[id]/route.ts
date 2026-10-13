/**
 * API: PATCH/DELETE /api/channels/[id]
 */
import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/shared/lib/local-db';
import type { Channel } from '@/shared/types';

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        if (!db.getChannel(id)) {
            return NextResponse.json({ success: false, error: 'Channel not found' }, { status: 404 });
        }

        const body = await request.json();
        const updates: Partial<Channel> = {};
        if (typeof body.language === 'string') updates.language = body.language;
        if (typeof body.clipDurationMin === 'number') updates.clipDurationMin = body.clipDurationMin;
        if (typeof body.clipDurationMax === 'number') updates.clipDurationMax = body.clipDurationMax;
        if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;
        if (['current', 'hormozi', 'clean'].includes(body.captionStyle)) updates.captionStyle = body.captionStyle;
        if (typeof body.maxClipsPerVideo === 'number' && body.maxClipsPerVideo >= 1) {
            updates.maxClipsPerVideo = Math.min(30, Math.round(body.maxClipsPerVideo));
        }
        if (typeof body.watermarkText === 'string') {
            updates.watermarkText = body.watermarkText.trim().slice(0, 30) || undefined;
        }

        db.updateChannel(id, updates);
        return NextResponse.json({ success: true, data: db.getChannel(id) });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const deleted = db.deleteChannel(id);
        if (!deleted) {
            return NextResponse.json({ success: false, error: 'Channel not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
