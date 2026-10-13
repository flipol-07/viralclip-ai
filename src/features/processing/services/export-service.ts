/**
 * Publish pack — per-clip folder ready for manual upload (the anti-shadowban
 * workflow: native upload on each platform, copy ready to paste).
 *
 * output/{ytId}/publish/{clipId}/
 *   ├── {titulo-slug}.mp4   (copy of the master, friendly name)
 *   ├── youtube.txt
 *   ├── tiktok.txt
 *   └── instagram.txt
 */
import fs from 'fs';
import path from 'path';
import type { Clip, PlatformCopy, PublishPack } from '@/shared/types';

const OUTPUT_DIR = path.resolve(process.cwd(), process.env.OUTPUT_DIR || './output');

export interface PackTexts {
    youtube: { title: string; body: string };
    tiktok: { body: string };
    instagram: { body: string };
    musicWarning: boolean;
}

/** Paste-ready text per platform; falls back to generic metadata for legacy clips */
export function buildPackTexts(clip: Clip): PackTexts {
    const pack = clip.publishPack ?? fallbackPack(clip);
    return {
        youtube: {
            title: pack.youtube.title || clip.title.slice(0, 100),
            body: joinCopy(pack.youtube, ['shorts']),
        },
        tiktok: { body: joinCopy(pack.tiktok) },
        instagram: { body: joinCopy(pack.instagram) },
        musicWarning: !!clip.musicWarning,
    };
}

/** Write the publish folder next to the rendered mp4. Idempotent; returns the folder path. */
export function writePublishPack(clip: Clip, ytId: string): string | null {
    if (!clip.filePath || !fs.existsSync(clip.filePath)) return null;

    const dir = path.join(OUTPUT_DIR, ytId, 'publish', clip.id);
    fs.mkdirSync(dir, { recursive: true });

    const texts = buildPackTexts(clip);
    const warning = texts.musicWarning
        ? '⚠ MÚSICA DE FONDO DETECTADA — riesgo Content ID. NO subir a YouTube (ver docs/playbook-publicacion.md).\n\n'
        : '';

    fs.writeFileSync(path.join(dir, 'youtube.txt'), `${warning}TÍTULO:\n${texts.youtube.title}\n\nDESCRIPCIÓN:\n${texts.youtube.body}\n`);
    fs.writeFileSync(path.join(dir, 'tiktok.txt'), `${warning}${texts.tiktok.body}\n`);
    fs.writeFileSync(path.join(dir, 'instagram.txt'), `${warning}${texts.instagram.body}\n`);

    const mp4Name = `${slugify(clip.title)}.mp4`;
    const mp4Dest = path.join(dir, mp4Name);
    // Re-copy when the master was re-rendered after the last export
    if (!fs.existsSync(mp4Dest) || fs.statSync(clip.filePath).mtimeMs > fs.statSync(mp4Dest).mtimeMs) {
        for (const old of fs.readdirSync(dir).filter(f => f.endsWith('.mp4') && f !== mp4Name)) {
            fs.unlinkSync(path.join(dir, old));
        }
        fs.copyFileSync(clip.filePath, mp4Dest);
    }
    return dir;
}

function joinCopy(copy: PlatformCopy, extraTags: string[] = []): string {
    const tags = [...new Set([...copy.hashtags, ...extraTags])].map(t => `#${t}`).join(' ');
    return tags ? `${copy.caption}\n\n${tags}` : copy.caption;
}

/** Legacy clips (pre publish-pack) get serviceable copy from what we have */
function fallbackPack(clip: Clip): PublishPack {
    const hashtags = (clip.keywords ?? []).map(k => k.replace(/\s+/g, '').toLowerCase()).slice(0, 4);
    const caption = clip.description || clip.title;
    return {
        youtube: { title: clip.title.slice(0, 100), caption, hashtags },
        tiktok: { caption, hashtags },
        instagram: { caption, hashtags },
    };
}

function slugify(text: string): string {
    return text
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 60) || 'clip';
}
