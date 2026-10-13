/**
 * Brand asset generator — PFP + YouTube banner via Gemini image models.
 *   npx tsx scripts/brand-image.ts [--out assets/brand]
 *
 * Tries Gemini image models in order; if none works, falls back to a
 * typographic logo rendered with ffmpeg (always produces output).
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { GoogleGenAI } from '@google/genai';

// Load .env.local (same pattern as scripts/worker.ts)
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (match && !(match[1] in process.env)) {
            process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
        }
    }
}

const IMAGE_MODELS = ['gemini-3-pro-image-preview', 'gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview'];

const PFP_PROMPT = `Square logo avatar for a Spanish streamer-clips brand called "Recortazos".
Design: a bold white play-button triangle whose right edge is cut by stylized scissors blades, flat vector style,
centered on a vibrant red-to-dark-red gradient background (#dc2626 to #7f1d1d). Minimal, high contrast,
no text, no watermark, crisp edges, designed to read clearly at 100x100 pixels.`;

const BANNER_PROMPT = `Wide YouTube channel banner (16:9) for a Spanish streamer-clips brand called "RECORTAZOS".
Big bold condensed white wordmark "RECORTAZOS" centered, with a play-button triangle replacing the letter O,
on a dark charcoal background with subtle diagonal red (#dc2626) energy streaks. Flat vector style, minimal,
high contrast, no other text, safe margins so the center 60% contains the wordmark.`;

function arg(flag: string, fallback: string): string {
    const i = process.argv.indexOf(flag);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function generateImage(ai: GoogleGenAI, prompt: string): Promise<Buffer | null> {
    for (const model of IMAGE_MODELS) {
        try {
            const res = await ai.models.generateContent({
                model,
                contents: prompt,
                config: { responseModalities: ['IMAGE', 'TEXT'] },
            });
            for (const part of res.candidates?.[0]?.content?.parts ?? []) {
                if (part.inlineData?.data) {
                    console.log(`[Brand] Imagen generada con ${model}`);
                    return Buffer.from(part.inlineData.data, 'base64');
                }
            }
        } catch (err) {
            console.warn(`[Brand] ${model} no disponible:`, err instanceof Error ? err.message.slice(0, 120) : err);
        }
    }
    return null;
}

/** Typographic fallback so the brand always ships with usable assets */
function ffmpegFallback(outDir: string): void {
    const font = path.join(process.cwd(), 'assets', 'fonts', 'ArchivoBlack-Regular.ttf');
    execSync(
        `ffmpeg -y -hide_banner -loglevel error -f lavfi -i "color=c=#dc2626:s=800x800" ` +
        `-vf "drawbox=x=0:y=400:w=800:h=400:color=#991b1b@1:t=fill,drawtext=fontfile='${font}':text='R':fontsize=420:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-40" ` +
        `-frames:v 1 "${path.join(outDir, 'pfp.png')}"`
    );
    execSync(
        `ffmpeg -y -hide_banner -loglevel error -f lavfi -i "color=c=#18181b:s=2048x1152" ` +
        `-vf "drawbox=x=0:y=540:w=2048:h=90:color=#dc2626@1:t=fill,drawtext=fontfile='${font}':text='RECORTAZOS':fontsize=190:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-30" ` +
        `-frames:v 1 "${path.join(outDir, 'banner.png')}"`
    );
    console.log('[Brand] Assets tipográficos generados con ffmpeg (fallback)');
}

async function main() {
    const outDir = path.resolve(process.cwd(), arg('--out', 'assets/brand'));
    fs.mkdirSync(outDir, { recursive: true });

    if (!process.env.GEMINI_API_KEY) {
        console.warn('[Brand] Sin GEMINI_API_KEY → fallback tipográfico');
        ffmpegFallback(outDir);
        return;
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const pfp = await generateImage(ai, PFP_PROMPT);
    const banner = await generateImage(ai, BANNER_PROMPT);

    if (!pfp || !banner) {
        ffmpegFallback(outDir);
        if (!pfp && !banner) return;
    }

    if (pfp) {
        const raw = path.join(outDir, 'pfp_raw.png');
        fs.writeFileSync(raw, pfp);
        execSync(`ffmpeg -y -hide_banner -loglevel error -i "${raw}" -vf "scale=800:800:force_original_aspect_ratio=increase,crop=800:800" "${path.join(outDir, 'pfp.png')}"`);
        fs.unlinkSync(raw);
    }
    if (banner) {
        const raw = path.join(outDir, 'banner_raw.png');
        fs.writeFileSync(raw, banner);
        execSync(`ffmpeg -y -hide_banner -loglevel error -i "${raw}" -vf "scale=2048:1152:force_original_aspect_ratio=increase,crop=2048:1152" "${path.join(outDir, 'banner.png')}"`);
        fs.unlinkSync(raw);
    }

    console.log(`[Brand] Listo → ${outDir}/pfp.png (800x800) + ${outDir}/banner.png (2048x1152)`);
}

main().catch(err => {
    console.error('[Brand] Fatal:', err);
    process.exit(1);
});
