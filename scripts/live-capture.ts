/**
 * Modo LIVE — clips mientras el streamer sigue emitiendo.
 *   npm run live -- <canal> [--chunk 15]
 *   ej: npm run live -- ibai --chunk 10
 *
 * Twitch crea el VOD en tiempo real y crece durante el directo. Cada ~chunk
 * minutos este script baja SOLO el tramo nuevo del VOD (sin anuncios pre-roll),
 * lo importa como vídeo local con prioridad de evento y el worker hace el resto.
 * Latencia momento → clip listo: ~chunk + procesado (15-25 min con chunk=15).
 *
 * Reanudable: el estado vive en data/live/<canal>.json. Ctrl+C y relanzar sigue
 * donde iba. Requiere el worker corriendo en otra terminal (npm run worker).
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (match && !(match[1] in process.env)) {
            process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
        }
    }
}

const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR || './data');
const POLL_MS = 60_000;
/** Margen sobre el borde del directo: el final del VOD aún se está escribiendo */
const SAFETY_S = 120;
/** Tramo mínimo que merece un chunk propio cuando el stream ya terminó */
const MIN_TAIL_S = 90;

interface LiveState {
    vodId: string;
    lastOffset: number;
    part: number;
}

function arg(flag: string, fallback: string): string {
    const i = process.argv.indexOf(flag);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function hhmm(s: number): string {
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

function loadState(file: string): LiveState | null {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8')) as LiveState;
    } catch {
        return null;
    }
}

/**
 * Baja un tramo [start, end] de un VOD de Twitch AÚN EN EMISIÓN.
 * ffmpeg/yt-dlp se cuelgan haciendo seek en playlists HLS sin ENDLIST
 * (verificado 2026-06-11), así que se hace a mano: parsear el m3u8,
 * bajar solo los segmentos .ts del tramo (curl --parallel) y remuxear a mp4.
 */
function downloadVodSection(vodUrl: string, start: number, end: number, outPath: string): void {
    const m3u8Url = execFileSync('yt-dlp', ['-g', '-f', 'best[height<=1080]', '--no-warnings', vodUrl], {
        encoding: 'utf-8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split('\n')[0];
    const baseUrl = m3u8Url.slice(0, m3u8Url.lastIndexOf('/') + 1);

    const playlist = execFileSync('curl', ['-sf', '--max-time', '30', m3u8Url], {
        encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024,
    });

    // #EXTINF:<dur>, seguido del URI del segmento. Los VODs actuales son fMP4/CMAF:
    // el #EXT-X-MAP (init segment) debe ir antepuesto o el archivo es ilegible.
    const segs: { uri: string; dur: number }[] = [];
    let initUri: string | null = null;
    let dur = 0;
    for (const raw of playlist.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('#EXT-X-MAP:')) {
            const m = line.match(/URI="([^"]+)"/);
            if (m) initUri = m[1].startsWith('http') ? m[1] : baseUrl + m[1];
        } else if (line.startsWith('#EXTINF:')) {
            dur = parseFloat(line.slice(8)) || 0;
        } else if (line && !line.startsWith('#')) {
            segs.push({ uri: line, dur });
        }
    }

    let t = 0;
    const chosen: string[] = [];
    for (const seg of segs) {
        const s0 = t;
        t += seg.dur;
        if (t <= start) continue;
        if (s0 >= end) break;
        chosen.push(seg.uri.startsWith('http') ? seg.uri : baseUrl + seg.uri);
    }
    if (chosen.length === 0) throw new Error(`Tramo ${start}-${end}s fuera del playlist (${Math.round(t)}s disponibles)`);

    const tmpDir = fs.mkdtempSync(path.join(DATA_DIR, 'live', 'seg-'));
    try {
        const cfgPath = path.join(tmpDir, 'curl.cfg');
        const downloads = (initUri ? [initUri] : []).concat(chosen);
        fs.writeFileSync(cfgPath, downloads.map((url, i) =>
            `url = "${url}"\noutput = "${path.join(tmpDir, `seg_${String(i).padStart(5, '0')}.bin`)}"`
        ).join('\n'));
        execFileSync('curl', ['-sf', '--parallel', '--parallel-max', '6', '--retry', '3', '--retry-delay', '2', '-K', cfgPath], {
            timeout: 30 * 60_000,
        });

        // init (si fMP4) + fragmentos en orden = stream válido → remux a mp4
        const sectionPath = path.join(tmpDir, 'section.bin');
        for (let i = 0; i < downloads.length; i++) {
            fs.appendFileSync(sectionPath, fs.readFileSync(path.join(tmpDir, `seg_${String(i).padStart(5, '0')}.bin`)));
        }
        execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', sectionPath,
            '-c', 'copy', '-movflags', '+faststart', outPath], {
            timeout: 10 * 60_000,
        });
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

async function main() {
    const user = process.argv[2]?.replace(/^@/, '').toLowerCase();
    if (!user || user.startsWith('--')) {
        console.error('Uso: npm run live -- <canal_twitch> [--chunk 15]');
        process.exit(1);
    }
    const chunkS = Math.max(5, parseInt(arg('--chunk', '15'), 10)) * 60;

    const db = await import('../src/shared/lib/local-db');
    const { getLatestVideos, isTwitchLive, twitchUserFromUrl } = await import('../src/features/processing/services/youtube-service');

    const channel = db.getAllChannels().find(c => twitchUserFromUrl(c.channelUrl)?.toLowerCase() === user);
    if (!channel) {
        console.warn(`⚠ ${user} no está dado de alta como canal en la app: los clips saldrán sin watermark/config del canal.`);
    }

    const liveDir = path.join(DATA_DIR, 'live');
    const chunksDir = path.join(DATA_DIR, 'videos', 'live');
    fs.mkdirSync(liveDir, { recursive: true });
    fs.mkdirSync(chunksDir, { recursive: true });
    const stateFile = path.join(liveDir, `${user}.json`);

    // Temporales huérfanos de descargas interrumpidas (un kill a mitad de chunk)
    for (const d of fs.readdirSync(liveDir).filter(f => f.startsWith('seg-'))) {
        fs.rmSync(path.join(liveDir, d), { recursive: true, force: true });
    }

    let running = true;
    process.on('SIGINT', () => {
        console.log('\n[Live] Parado. El estado queda guardado — relanza para continuar.');
        running = false;
    });

    console.log(`🔴 Modo LIVE para twitch.tv/${user} — chunks de ${chunkS / 60} min (worker aparte: npm run worker)`);

    let wasLive = false;
    while (running) {
        const live = isTwitchLive(user);
        const vod = getLatestVideos(`https://www.twitch.tv/${user}`, 1)[0];

        if (!vod) {
            console.log(`[Live] Sin VODs visibles para ${user} (¿VODs desactivados en el canal?). Reintento en 1 min...`);
            await sleep(POLL_MS);
            continue;
        }

        let state = loadState(stateFile);
        if (!state || state.vodId !== vod.id) {
            if (live) {
                // Arrancar "desde ahora": si el stream lleva horas, el histórico lo
                // cubrirá el scan del worker al terminar — aquí solo lo fresco
                const startAt = Math.max(0, Math.floor(vod.duration - SAFETY_S) - chunkS);
                console.log(`[Live] Stream detectado → VOD ${vod.id} "${vod.title}" (capturando desde ${hhmm(startAt)})`);
                state = { vodId: vod.id, lastOffset: startAt, part: 0 };
                fs.writeFileSync(stateFile, JSON.stringify(state));
            } else {
                console.log(`[Live] ${user} no está en directo. Esperando... (el VOD nuevo lo cogerá el worker en su scan)`);
                await sleep(POLL_MS);
                continue;
            }
        }

        const safeEnd = Math.floor(vod.duration - SAFETY_S);
        const pending = safeEnd - state.lastOffset;
        const streamJustEnded = wasLive && !live;
        wasLive = live;

        const shouldCut = (live && pending >= chunkS) || (!live && pending >= MIN_TAIL_S);
        if (!shouldCut) {
            if (!live && pending < MIN_TAIL_S) {
                console.log(`[Live] Stream terminado y sin tramo pendiente. ${streamJustEnded ? '✅ Cobertura completa.' : ''} Fin.`);
                break;
            }
            await sleep(POLL_MS);
            continue;
        }

        const part = state.part + 1;
        const start = state.lastOffset;
        // Tope por corte: tras un parón el backlog se cubre en cortes encadenados,
        // no en una descarga gigante
        const end = Math.min(safeEnd, start + 2 * chunkS);
        const chunkPath = path.join(chunksDir, `${user}_${vod.id}_p${part}.mp4`);
        console.log(`[Live] ⬇ Parte ${part}: ${hhmm(start)}–${hhmm(end)} (${Math.round((end - start) / 60)} min)...`);

        try {
            downloadVodSection(vod.webpage_url, start, end, chunkPath);
        } catch (err) {
            console.error('[Live] Descarga del chunk falló (reintento en el próximo ciclo):', err instanceof Error ? err.message.slice(0, 200) : err);
            await sleep(POLL_MS);
            continue;
        }

        const video = db.addVideo({
            channelId: channel?.id ?? '',
            youtubeVideoId: `${vod.id}_p${part}`,
            title: `🔴 ${channel?.channelName ?? user} LIVE parte ${part} (${hhmm(start)}–${hhmm(end)})`,
            url: vod.webpage_url,
            source: 'local',
            localPath: chunkPath,
            duration: end - start,
            status: 'pending',
        });
        db.enqueueProcessVideo(video.id, 10);
        console.log(`[Live] ✚ Parte ${part} encolada con prioridad — clips en ~10-15 min`);

        state = { vodId: vod.id, lastOffset: end, part };
        fs.writeFileSync(stateFile, JSON.stringify(state));
        // Si queda backlog, encadenar el siguiente corte sin esperar
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
    console.error('[Live] Fatal:', err);
    process.exit(1);
});
