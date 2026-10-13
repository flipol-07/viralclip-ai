/**
 * API: POST /api/videos/import
 * Register a video and enqueue it for processing. Accepts either a local file
 * path or a URL supported by yt-dlp (YouTube, Twitch VODs...).
 * Body: { filePath: string, title?: string, eventPriority?: boolean }
 * eventPriority salta la cola — clips frescos de un evento valen oro.
 */
import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import * as db from '@/shared/lib/local-db';

const ImportSchema = z.object({
    filePath: z.string().min(1),
    title: z.string().optional(),
    eventPriority: z.boolean().optional(),
});

/** Convert Windows paths (C:\Users\...) to WSL paths (/mnt/c/Users/...) */
function normalizePath(p: string): string {
    const winMatch = p.trim().match(/^([A-Za-z]):[\\/](.*)$/);
    if (winMatch) {
        return `/mnt/${winMatch[1].toLowerCase()}/${winMatch[2].replace(/\\/g, '/')}`;
    }
    return p.trim();
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const parsed = ImportSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ success: false, error: 'filePath es obligatorio (ruta local o URL)' }, { status: 400 });
        }
        const priority = parsed.data.eventPriority ? 10 : 0;

        // ============ URL (YouTube / Twitch VOD vía yt-dlp) ============
        const input = parsed.data.filePath.trim();
        if (/^https?:\/\//i.test(input)) {
            let url: URL;
            try {
                url = new URL(input);
            } catch {
                return NextResponse.json({ success: false, error: `URL inválida: ${input}` }, { status: 400 });
            }

            // execFileSync (sin shell): la URL viene del usuario
            let info: { id: string; title?: string; duration?: number; thumbnail?: string; webpage_url?: string };
            try {
                const out = execFileSync('yt-dlp', ['--dump-json', '--no-playlist', url.href], {
                    encoding: 'utf-8',
                    timeout: 120000,
                    maxBuffer: 50 * 1024 * 1024,
                });
                info = JSON.parse(out.trim().split('\n')[0]);
            } catch {
                return NextResponse.json({
                    success: false,
                    error: 'yt-dlp no pudo leer esa URL. ¿Es un vídeo de YouTube o un VOD de Twitch válido?',
                }, { status: 400 });
            }

            const existing = db.getVideoByYoutubeId(info.id);
            if (existing) {
                db.enqueueProcessVideo(existing.id, priority);
                return NextResponse.json({
                    success: true,
                    data: { video: existing, message: 'Ese vídeo ya estaba registrado: re-encolado.' },
                });
            }

            const video = db.addVideo({
                channelId: '',
                youtubeVideoId: info.id,
                title: parsed.data.title || info.title || info.id,
                url: info.webpage_url || url.href,
                source: 'youtube',
                thumbnailUrl: info.thumbnail,
                duration: info.duration ? Math.round(info.duration) : undefined,
                status: 'pending',
            });
            db.enqueueProcessVideo(video.id, priority);

            return NextResponse.json({
                success: true,
                data: { video, message: priority > 0 ? 'Vídeo encolado con PRIORIDAD DE EVENTO.' : 'Vídeo encolado. El worker empezará a procesarlo.' },
            });
        }

        // ============ Ruta local ============
        const filePath = normalizePath(input);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            return NextResponse.json({
                success: false,
                error: `No encuentro el archivo: ${filePath}. Si está en Windows usa la ruta completa (ej: C:\\Users\\tu\\Videos\\velada.mp4)`,
            }, { status: 400 });
        }

        const title = parsed.data.title || path.basename(filePath).replace(/\.[^.]+$/, '');
        const localId = `local_${Date.now().toString(36)}`;

        const video = db.addVideo({
            channelId: '',
            youtubeVideoId: localId,
            title,
            url: `file://${filePath}`,
            source: 'local',
            localPath: filePath,
            status: 'pending',
        });

        db.enqueueProcessVideo(video.id, priority);

        return NextResponse.json({
            success: true,
            data: { video, message: 'Vídeo importado y encolado. El worker empezará a procesarlo.' },
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
