/**
 * Video Processing Service v3 — ffmpeg rendering
 *
 * - Multi-cut clips: stitches several source ranges (skips dead time)
 * - Scene/speaker-aware layout: each time window renders with its own
 *   crop (track / split / center) and the parts are concatenated
 * - Karaoke word subtitles positioned per layout (split → center seam,
 *   track/center → lower-middle third per short-form best practices)
 * - Optional hook-title overlay (context) during the first ~4 seconds
 */
import { execSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { generateUnitSubtitles } from './captions/generate';
import { getCaptionStyle, FONTS_DIR } from './captions/styles';
import type { TranscriptWord, RenderPlan, RenderUnit, ClipSegment, CaptionStyleId } from '@/shared/types';

const OUTPUT_DIR = path.resolve(process.cwd(), process.env.OUTPUT_DIR || './output');
// Paths construidos en runtime (no literales) para que Turbopack no intente
// trazar el venv como asset del bundle (sus symlinks apuntan fuera del proyecto)
const PYTHON_BIN = process.env.REFRAME_PYTHON
    || path.join(process.cwd(), ...['.venv-cv', 'bin', 'python']);
const REFRAME_SCRIPT = path.join(process.cwd(), ...['scripts', 'reframe.py']);

function ensureOutputDir(subdir?: string): string {
    const dir = subdir ? path.join(OUTPUT_DIR, subdir) : OUTPUT_DIR;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Run the reframe planner on one source range.
 * Null → caller falls back to a single center-crop unit.
 */
export function planReframe(videoPath: string, startTime: number, endTime: number, planId: string): RenderPlan | null {
    if (!fs.existsSync(PYTHON_BIN) || !fs.existsSync(REFRAME_SCRIPT)) {
        console.warn('[Video] Reframe venv/script missing, falling back to center crop');
        return null;
    }
    const planPath = path.join(ensureOutputDir('.plans'), `${planId}.json`);
    try {
        execFileSync(PYTHON_BIN, [
            REFRAME_SCRIPT,
            '--video', videoPath,
            '--start', String(startTime),
            '--end', String(endTime),
            '--out', planPath,
        ], { timeout: 300000, stdio: ['ignore', 'ignore', 'pipe'] });
        return JSON.parse(fs.readFileSync(planPath, 'utf-8')) as RenderPlan;
    } catch (err) {
        console.error('[Video] Reframe planning failed:', err instanceof Error ? err.message : err);
        return null;
    } finally {
        if (fs.existsSync(planPath)) try { fs.unlinkSync(planPath); } catch { /* ignore */ }
    }
}

// ============ RENDERING ============

function getVideoInfo(videoPath: string): { width: number; height: number } {
    try {
        const result = execSync(
            `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${videoPath}" 2>/dev/null`,
            { encoding: 'utf-8', timeout: 10000 }
        ).trim();
        const [width, height] = result.split('x').map(Number);
        return { width: width || 1920, height: height || 1080 };
    } catch {
        return { width: 1920, height: 1080 };
    }
}

function escapeFilterPath(p: string): string {
    return p.replace(/'/g, "'\\''").replace(/:/g, '\\:');
}

const ENCODE = `-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -ar 48000`;

// Punch-in: alternating subtle zoom = visible edit rhythm (originality signal
// for the unoriginal-content filters) without touching the audio.
const PUNCH_ZOOM = 1.045;
/** Static windows longer than this get split so single-scene clips also have cuts */
const PUNCH_MAX_WINDOW_S = 9;
const PUNCH_TARGET_WINDOW_S = 6;

const WATERMARK_FONT = path.join(FONTS_DIR, 'Poppins-SemiBold.ttf');

interface UnitJob {
    srcStart: number;
    srcEnd: number;
    layout: string;
    unit: RenderUnit | null;
    plan: RenderPlan | null;
    isFirst: boolean;
    /** Subtle zoom-in on this window (alternates between windows) */
    punchIn?: boolean;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Watermark text goes inside a shell-quoted ffmpeg filter: allow only safe chars */
function sanitizeWatermark(text?: string): string {
    if (!text) return '';
    return text.replace(/[^\w@.\-áéíóúñüÁÉÍÓÚÑÜ ]/g, '').trim().slice(0, 30);
}

/** Shrink a crop window around its center for the punch-in zoom */
function punch(w: number, h: number, x: number, y: number, zoomed: boolean): { w: number; h: number; x: number; y: number } {
    if (!zoomed) return { w, h, x, y };
    const pw = even(w / PUNCH_ZOOM);
    const ph = even(h / PUNCH_ZOOM);
    return { w: pw, h: ph, x: x + Math.round((w - pw) / 2), y: y + Math.round((h - ph) / 2) };
}

function buildUnitFilter(job: UnitJob, width: number, height: number, tmpDir: string, idx: string): { filter: string; sendcmdPath?: string } {
    const cropH = height;
    const cropW = Math.min(width, Math.round(height * 9 / 16 / 2) * 2);
    const centerX = Math.round((width - cropW) / 2);
    const { unit, plan } = job;
    const zoomed = !!job.punchIn;

    if (unit && plan && unit.layout === 'split' && unit.split) {
        const { topX, bottomX, halfCropW, halfCropH } = unit.split;
        const top = punch(halfCropW, halfCropH, topX, 0, zoomed);
        const bottom = punch(halfCropW, halfCropH, bottomX, 0, zoomed);
        return {
            filter:
                `[0:v]crop=${top.w}:${top.h}:${top.x}:${top.y},scale=1080:960:flags=lanczos,setsar=1[top];` +
                `[0:v]crop=${bottom.w}:${bottom.h}:${bottom.x}:${bottom.y},scale=1080:960:flags=lanczos,setsar=1[bottom];` +
                `[top][bottom]vstack=inputs=2[v]`,
        };
    }

    if (unit && plan && unit.layout === 'track' && unit.track && unit.track.length > 0) {
        // Keyframe times are relative to the segment start → remap to unit-local
        const kf = unit.track
            .map(k => ({ t: k.t - unit.t0, x: k.x }))
            .filter(k => k.t >= -0.01);
        const x0 = kf.length ? kf[0].x : centerX;
        const cw = plan.cropW;
        const ch = plan.cropH;
        const p = punch(cw, ch, 0, 0, zoomed); // x offset applied per keyframe

        if (kf.length <= 1) {
            return { filter: `[0:v]crop=${p.w}:${p.h}:${x0 + p.x}:${p.y},scale=1080:1920:flags=lanczos,setsar=1[v]` };
        }
        const sendcmdPath = path.join(tmpDir, `cmd_${idx}.cmd`);
        const cmdLines = kf
            .filter(k => k.t > 0.01)
            .map(k => `${k.t.toFixed(3)} crop@dyn x ${k.x + p.x};`)
            .join('\n');
        fs.writeFileSync(sendcmdPath, cmdLines + '\n');
        return {
            filter:
                `[0:v]sendcmd=f='${escapeFilterPath(sendcmdPath)}',` +
                `crop@dyn=w=${p.w}:h=${p.h}:x=${x0 + p.x}:y=${p.y},scale=1080:1920:flags=lanczos,setsar=1[v]`,
            sendcmdPath,
        };
    }

    const c = punch(cropW, cropH, centerX, 0, zoomed);
    return { filter: `[0:v]crop=${c.w}:${c.h}:${c.x}:${c.y},scale=1080:1920:flags=lanczos,setsar=1[v]` };
}

/**
 * Render a vertical 1080x1920 clip from one or more source segments,
 * each segment scene/speaker-aware, with karaoke subtitles and hook title.
 */
export function createClip(options: {
    videoPath: string;
    clipId: string;
    videoId: string;
    segments: ClipSegment[];
    words: TranscriptWord[];
    keywords?: string[];
    hookTitle?: string;
    withSubtitles?: boolean;
    bgMusic?: string;
    captionStyle?: CaptionStyleId;
    emoji?: string;
    /** Own brand handle burned subtly top-left (e.g. "@misclips") */
    watermarkText?: string;
}): { filePath: string; layout: string; hasSubtitles: boolean } {
    const {
        videoPath, clipId, videoId, segments, words,
        keywords = [], hookTitle, withSubtitles = true, bgMusic,
        captionStyle, emoji, watermarkText,
    } = options;
    const style = getCaptionStyle(captionStyle);

    if (segments.length === 0) throw new Error('createClip: no segments');

    const clipDir = ensureOutputDir(videoId);
    const tmpDir = ensureOutputDir(path.join('.tmp', clipId));
    const outputPath = path.join(clipDir, `${clipId}.mp4`);
    const { width, height } = getVideoInfo(videoPath);

    // 1. Plan each segment, flatten to unit jobs
    const jobs: UnitJob[] = [];
    for (const seg of segments) {
        const plan = planReframe(videoPath, seg.start, seg.end, `${clipId}_${jobs.length}`);
        if (plan && plan.units.length > 0) {
            for (const unit of plan.units) {
                jobs.push({
                    srcStart: seg.start + unit.t0,
                    srcEnd: seg.start + unit.t1,
                    layout: unit.layout,
                    unit,
                    plan,
                    isFirst: jobs.length === 0,
                });
            }
        } else {
            jobs.push({ srcStart: seg.start, srcEnd: seg.end, layout: 'center', unit: null, plan: null, isFirst: jobs.length === 0 });
        }
    }

    // 1b. Edit rhythm: long static windows split into ~6s sub-windows, and
    // alternating windows get a subtle punch-in. Track windows stay whole
    // (their crop keyframes are window-relative).
    const rhythmJobs: UnitJob[] = [];
    for (const job of jobs) {
        const dur = job.srcEnd - job.srcStart;
        if (job.layout === 'track' || dur <= PUNCH_MAX_WINDOW_S) {
            rhythmJobs.push(job);
            continue;
        }
        const n = Math.ceil(dur / PUNCH_TARGET_WINDOW_S);
        const step = dur / n;
        for (let k = 0; k < n; k++) {
            rhythmJobs.push({
                ...job,
                srcStart: job.srcStart + k * step,
                srcEnd: k === n - 1 ? job.srcEnd : job.srcStart + (k + 1) * step,
                isFirst: job.isFirst && k === 0,
            });
        }
    }
    rhythmJobs.forEach((j, i) => { j.punchIn = i % 2 === 1; });
    jobs.length = 0;
    jobs.push(...rhythmJobs);

    // 2. Render each unit to a temp part with identical encoding params
    let anySubs = false;
    const partPaths: string[] = [];
    try {
        for (let i = 0; i < jobs.length; i++) {
            const job = jobs[i];
            const dur = job.srcEnd - job.srcStart;
            if (dur <= 0.05) continue;
            const partPath = path.join(tmpDir, `part_${String(i).padStart(3, '0')}.mp4`);

            const { filter } = buildUnitFilter(job, width, height, tmpDir, String(i));
            let fullFilter = filter;
            let finalLabel = '[v]';

            if (withSubtitles) {
                const subsPath = path.join(tmpDir, `subs_${i}.ass`);
                const generated = generateUnitSubtitles({
                    words, keywords,
                    srcStart: job.srcStart, srcEnd: job.srcEnd,
                    layout: job.layout,
                    hookTitle: job.isFirst ? hookTitle : undefined,
                    emoji: job.isFirst ? emoji : undefined,
                    style,
                    subsPath,
                });
                if (generated) {
                    anySubs = true;
                    fullFilter += `;[v]ass='${escapeFilterPath(generated)}':fontsdir='${escapeFilterPath(FONTS_DIR)}'[vout]`;
                    finalLabel = '[vout]';
                }
            }

            const wmText = sanitizeWatermark(watermarkText);
            if (wmText) {
                // Top-left, below the hook-title band; clear of TikTok/IG/Shorts UI zones
                fullFilter += `;${finalLabel}drawtext=fontfile='${escapeFilterPath(WATERMARK_FONT)}':text='${wmText}':fontsize=30:fontcolor=white@0.55:borderw=2:bordercolor=black@0.35:x=40:y=300[vwm]`;
                finalLabel = '[vwm]';
            }

            const cmd = `ffmpeg -y -hide_banner -loglevel error -ss ${job.srcStart} -t ${dur} -i "${videoPath}" ` +
                `-filter_complex "${fullFilter}" -map "${finalLabel}" -map 0:a? ${ENCODE} "${partPath}"`;
            try {
                execSync(cmd, { encoding: 'utf-8', timeout: 600000 });
            } catch (err) {
                // Per-unit fallback: center crop without subs keeps the clip alive
                console.error(`[Video] Unit ${i} failed, retrying with center crop:`, err instanceof Error ? err.message.slice(0, 200) : err);
                const cropH2 = height;
                const cropW2 = Math.min(width, Math.round(height * 9 / 16 / 2) * 2);
                const cx = Math.round((width - cropW2) / 2);
                execSync(
                    `ffmpeg -y -hide_banner -loglevel error -ss ${job.srcStart} -t ${dur} -i "${videoPath}" ` +
                    `-filter_complex "[0:v]crop=${cropW2}:${cropH2}:${cx}:0,scale=1080:1920:flags=lanczos,setsar=1[v]" ` +
                    `-map "[v]" -map 0:a? ${ENCODE} "${partPath}"`,
                    { encoding: 'utf-8', timeout: 600000 }
                );
            }
            partPaths.push(partPath);
        }

        if (partPaths.length === 0) throw new Error('No parts rendered');

        // 3. Concat (stream copy: identical codec params) or move single part
        const mergedPath = path.join(tmpDir, 'merged.mp4');
        if (partPaths.length === 1) {
            fs.copyFileSync(partPaths[0], mergedPath);
        } else {
            const listPath = path.join(tmpDir, 'concat.txt');
            fs.writeFileSync(listPath, partPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
            execSync(
                `ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${listPath}" -c copy "${mergedPath}"`,
                { encoding: 'utf-8', timeout: 300000 }
            );
        }

        // 4. Optional background music pass (video stream copied, audio remixed)
        let preNormPath = mergedPath;
        if (bgMusic && fs.existsSync(bgMusic)) {
            const bgmPath = path.join(tmpDir, 'bgm.mp4');
            execSync(
                `ffmpeg -y -hide_banner -loglevel error -i "${mergedPath}" -stream_loop -1 -i "${bgMusic}" ` +
                `-filter_complex "[0:a]volume=1.0[a1];[1:a]volume=0.08[a2];[a1][a2]amix=inputs=2:duration=first:dropout_transition=2[aout]" ` +
                `-map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 160k "${bgmPath}"`,
                { encoding: 'utf-8', timeout: 300000 }
            );
            preNormPath = bgmPath;
        }

        // 5. Final audio pass: -14 LUFS (estándar YT/TikTok/IG), vídeo intacto
        try {
            execSync(
                `ffmpeg -y -hide_banner -loglevel error -i "${preNormPath}" ` +
                `-c:v copy -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:a aac -b:a 160k -ar 48000 -movflags +faststart "${outputPath}"`,
                { encoding: 'utf-8', timeout: 300000 }
            );
        } catch (err) {
            // Sin audio o loudnorm falló: el clip sale igualmente, sin normalizar
            console.warn('[Video] loudnorm failed, keeping un-normalized audio:', err instanceof Error ? err.message.slice(0, 200) : err);
            fs.copyFileSync(preNormPath, outputPath);
        }

        // Dominant layout (most screen time) for the UI badge
        const timeByLayout = new Map<string, number>();
        for (const j of jobs) {
            timeByLayout.set(j.layout, (timeByLayout.get(j.layout) || 0) + (j.srcEnd - j.srcStart));
        }
        const layout = [...timeByLayout.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'center';

        return { filePath: outputPath, layout, hasSubtitles: anySubs };
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

/**
 * Extract a single frame (used for thumbnails)
 */
export function extractKeyframe(videoPath: string, timeSeconds: number, outputId: string): string {
    const tempDir = path.join(path.dirname(videoPath), 'tmp_frames');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const outputPath = path.join(tempDir, `${outputId}.jpg`);
    execSync(`ffmpeg -y -ss ${timeSeconds} -i "${videoPath}" -vframes 1 -q:v 2 "${outputPath}" 2>/dev/null`, { stdio: 'ignore' });
    return outputPath;
}
