import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const bgmDir = path.resolve(process.cwd(), './data/bgm');
        if (!fs.existsSync(bgmDir)) {
            fs.mkdirSync(bgmDir, { recursive: true });
        }

        const files = fs.readdirSync(bgmDir);
        const musicFiles = files.filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));

        return NextResponse.json({
            success: true,
            data: musicFiles.map(f => ({
                id: f,
                name: f.replace(/\.[^.]+$/, ''),
                path: path.join(bgmDir, f)
            }))
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
