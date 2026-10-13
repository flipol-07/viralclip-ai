/**
 * API: GET /api/automation/check
 * Trigger manual check for new content
 */
import { NextResponse } from 'next/server';
import { checkNewContent } from '@/features/processing/services/automation-service';

export async function GET() {
    try {
        const result = await checkNewContent();
        return NextResponse.json({
            success: true,
            message: `Revisados ${result.channelsChecked} canales. ${result.newVideosFound} vídeos nuevos encolados.`,
            data: result
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
