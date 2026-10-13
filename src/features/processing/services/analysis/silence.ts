/**
 * Silence map — one ffmpeg silencedetect pass per video, stored next to the
 * transcript. Refine uses it to land cuts in real audio valleys instead of
 * word timestamps alone (Whisper word edges often clip breaths/reactions).
 */
import fs from 'fs';
import { execSync } from 'child_process';
import type { SilenceMap } from '@/shared/types';

const NOISE_DB = -30;
const MIN_SILENCE_DUR = 0.25;

/** Runs silencedetect over an audio or video file and writes the JSON map */
export function generateSilenceMap(sourcePath: string, outPath: string): SilenceMap {
    // silencedetect logs to stderr; -f null discards output media
    const stderr = execSync(
        `ffmpeg -hide_banner -nostats -i "${sourcePath}" -vn -af silencedetect=noise=${NOISE_DB}dB:d=${MIN_SILENCE_DUR} -f null - 2>&1 || true`,
        { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60_000 }
    );

    const silences: { start: number; end: number }[] = [];
    let pendingStart: number | null = null;
    for (const line of stderr.split('\n')) {
        const startMatch = line.match(/silence_start:\s*([\d.]+)/);
        if (startMatch) pendingStart = parseFloat(startMatch[1]);
        const endMatch = line.match(/silence_end:\s*([\d.]+)/);
        if (endMatch && pendingStart !== null) {
            silences.push({ start: pendingStart, end: parseFloat(endMatch[1]) });
            pendingStart = null;
        }
    }

    const map: SilenceMap = { noiseDb: NOISE_DB, minDur: MIN_SILENCE_DUR, silences };
    fs.writeFileSync(outPath, JSON.stringify(map));
    console.log(`[Silence] ${silences.length} silences mapped → ${outPath}`);
    return map;
}

export function loadSilenceMap(mapPath: string): SilenceMap | null {
    if (!fs.existsSync(mapPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(mapPath, 'utf-8')) as SilenceMap;
    } catch {
        return null;
    }
}

/** Silence interval that ends shortly before `t` (lead-in valley for a start cut) */
export function silenceEndingBefore(map: SilenceMap, t: number, maxGap = 1.5): { start: number; end: number } | null {
    let best: { start: number; end: number } | null = null;
    for (const s of map.silences) {
        if (s.end <= t + 0.05 && t - s.end <= maxGap && (!best || s.end > best.end)) best = s;
        if (s.start > t) break;
    }
    return best;
}

/** Silence interval that starts shortly after `t` (tail valley for an end cut) */
export function silenceStartingAfter(map: SilenceMap, t: number, maxGap = 1.0): { start: number; end: number } | null {
    for (const s of map.silences) {
        if (s.start >= t - 0.1 && s.start - t <= maxGap) return s;
        if (s.start > t + maxGap) break;
    }
    return null;
}
