/**
 * API: GET /api/stats
 * Dashboard statistics
 */
import { NextResponse } from 'next/server';
import * as db from '@/shared/lib/local-db';

export async function GET() {
    try {
        const stats = db.getStats();
        const recentLogs = db.getRecentLogs(20);
        return NextResponse.json({ success: true, data: { stats, recentLogs } });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
