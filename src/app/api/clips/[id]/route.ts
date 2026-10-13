/**
 * API: DELETE /api/clips/[id]
 * Delete a specific clip
 */
import { NextResponse } from 'next/server';
import * as db from '@/shared/lib/local-db';

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const success = db.deleteClip(id);

        if (!success) {
            return NextResponse.json({ success: false, error: 'Clip not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
