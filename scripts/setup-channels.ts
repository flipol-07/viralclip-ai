/**
 * Alta/actualización de los canales fuente del roster (idempotente).
 *   npx tsx scripts/setup-channels.ts
 *
 * Además de crear el canal, registra sus VODs actuales como "ya vistos"
 * (status done, sin procesar): los listados planos de Twitch no traen fecha,
 * así que sin este baseline el primer scan encolaría horas de VODs históricos.
 */
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (match && !(match[1] in process.env)) {
            process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
        }
    }
}

const WATERMARK = '@recortazos';

/** Roster del canal Recortazos — ver vault Obsidian → Fuentes.md */
const ROSTER: { user: string; active: boolean }[] = [
    { user: 'ibai', active: true },
    { user: 'illojuan', active: true },
    // Desactivados de inicio para no saturar la máquina (4 cores); activar en la UI
    { user: 'elxokas', active: false },
    { user: 'thegrefg', active: false },
];

async function main() {
    const db = await import('../src/shared/lib/local-db');
    const { getChannelInfo, getLatestVideos } = await import('../src/features/processing/services/youtube-service');

    for (const entry of ROSTER) {
        const url = `https://www.twitch.tv/${entry.user}`;
        const info = getChannelInfo(url);

        let channel = db.getAllChannels().find(c => c.youtubeChannelId === info.channelId || c.channelUrl === url);
        if (channel) {
            channel = db.updateChannel(channel.id, {
                isActive: entry.active,
                watermarkText: WATERMARK,
                clipDurationMin: 20,
                clipDurationMax: 45,
                language: 'es',
            })!;
            console.log(`↻ ${info.channelName} actualizado (active=${entry.active})`);
        } else {
            channel = db.addChannel({
                youtubeChannelId: info.channelId,
                channelName: info.channelName,
                channelUrl: url,
                thumbnailUrl: info.thumbnailUrl,
                language: 'es',
                clipDurationMin: 20,
                clipDurationMax: 45,
                isActive: entry.active,
                watermarkText: WATERMARK,
                maxClipsPerVideo: 9,
            });
            console.log(`✚ ${info.channelName} dado de alta (active=${entry.active})`);
        }

        // Baseline: VODs existentes quedan registrados como ya vistos (no se procesan)
        let baselined = 0;
        for (const vod of getLatestVideos(url, 5)) {
            if (db.getVideoByYoutubeId(vod.id)) continue;
            db.addVideo({
                channelId: channel.id,
                youtubeVideoId: vod.id,
                title: vod.title,
                url: vod.webpage_url,
                source: 'youtube',
                thumbnailUrl: vod.thumbnail,
                duration: vod.duration,
                status: 'done',
                stage: 'done',
                processedAt: new Date().toISOString(),
            });
            baselined++;
        }
        if (baselined > 0) console.log(`   baseline: ${baselined} VOD(s) histórico(s) marcados como vistos`);
    }

    console.log('\nListo. El worker procesará solo VODs publicados a partir de ahora.');
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
