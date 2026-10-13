/**
 * Visual pass (ClipAnything-style) — Gemini WATCHES a low-res proxy of each
 * top candidate and judges what the transcript can't see: on-camera laughter,
 * gestures, action, a bad opening frame. Opt-in via VISUAL_PASS=1.
 *
 * Proxies <15MB go inline (no upload latency); bigger ones use the Files API.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { createPartFromUri, type Part } from '@google/genai';
import { generateJson, getGemini } from './gemini-client';
import { buildVisualPrompt, visualResponseSchema, visualResponseZod } from './prompts';
import type { MomentCandidate, SilenceMap, Transcript, VisualVerdict } from '@/shared/types';

const INLINE_LIMIT_BYTES = 15 * 1024 * 1024;
const PROXY_CAP_SECONDS = 90;
const MAX_START_SHIFT = 3;

export function visualPassEnabled(): boolean {
    return process.env.VISUAL_PASS === '1';
}

export function maxVisualCandidates(): number {
    return parseInt(process.env.VISUAL_MAX_CANDIDATES || '12', 10);
}

export async function runVisualPass(
    moments: MomentCandidate[],
    videoPath: string,
    transcript: Transcript,
    silenceMap: SilenceMap | null,
    checkpointDir: string
): Promise<MomentCandidate[]> {
    fs.mkdirSync(checkpointDir, { recursive: true });
    const proxyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-proxies-'));

    // Only the strongest candidates earn video tokens
    const eligible = [...moments.keys()]
        .sort((a, b) => moments[b].score - moments[a].score)
        .slice(0, maxVisualCandidates());
    const eligibleSet = new Set(eligible);

    const out: MomentCandidate[] = [];
    try {
        for (let i = 0; i < moments.length; i++) {
            if (!eligibleSet.has(i)) {
                out.push(moments[i]);
                continue;
            }
            const checkpointPath = path.join(checkpointDir, `cand_${i}.json`);
            if (fs.existsSync(checkpointPath)) {
                out.push(JSON.parse(fs.readFileSync(checkpointPath, 'utf-8')));
                continue;
            }

            let result: MomentCandidate;
            try {
                const verdict = await verifyVisually(moments[i], videoPath, proxyDir, i);
                result = applyVerdict(moments[i], verdict, transcript, silenceMap);
                console.log(`[Visual] ${i + 1}/${moments.length}: visual ${verdict.visualScore}/100${verdict.badOpening ? ' (bad opening, shifted)' : ''} — ${verdict.notes}`);
            } catch (err) {
                console.warn(`[Visual] Candidate ${i} ("${moments[i].title}") failed, keeping as-is:`, err instanceof Error ? err.message : err);
                result = moments[i];
            }
            fs.writeFileSync(checkpointPath, JSON.stringify(result));
            out.push(result);
        }
    } finally {
        fs.rmSync(proxyDir, { recursive: true, force: true });
    }
    return out;
}

async function verifyVisually(moment: MomentCandidate, videoPath: string, proxyDir: string, index: number): Promise<VisualVerdict> {
    const segs = moment.segments && moment.segments.length > 0
        ? moment.segments
        : [{ start: moment.startTime, end: moment.endTime }];
    const totalDur = segs.reduce((a, s) => a + s.end - s.start, 0);
    const truncated = totalDur > PROXY_CAP_SECONDS;

    const proxyPath = extractProxy(videoPath, segs, proxyDir, index);
    const videoPart = await toVideoPart(proxyPath);

    return generateJson<VisualVerdict>({
        label: `visual#${index}`,
        input: [videoPart, { text: buildVisualPrompt(moment, Math.min(totalDur, PROXY_CAP_SECONDS), truncated) }],
        schema: visualResponseZod,
        responseSchema: visualResponseSchema as unknown as Record<string, unknown>,
        temperature: 0.2,
        maxOutputTokens: 2048,
        lowMediaResolution: true,
    });
}

/** 360p/CRF30/mono proxy of the exact cut; multi-segment cuts are concatenated */
function extractProxy(videoPath: string, segs: { start: number; end: number }[], proxyDir: string, index: number): string {
    const outPath = path.join(proxyDir, `proxy_${index}.mp4`);
    let budget = PROXY_CAP_SECONDS;

    const partPaths: string[] = [];
    for (let i = 0; i < segs.length && budget > 0.5; i++) {
        const dur = Math.min(segs[i].end - segs[i].start, budget);
        budget -= dur;
        const partPath = segs.length === 1 ? outPath : path.join(proxyDir, `proxy_${index}_part${i}.mp4`);
        execSync(
            `ffmpeg -y -hide_banner -loglevel error -ss ${segs[i].start.toFixed(3)} -t ${dur.toFixed(3)} -i "${videoPath}" ` +
            `-vf "scale=-2:360" -c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p -c:a aac -b:a 64k -ac 1 "${partPath}"`,
            { timeout: 10 * 60_000 }
        );
        partPaths.push(partPath);
    }

    if (partPaths.length > 1) {
        const listPath = path.join(proxyDir, `concat_${index}.txt`);
        fs.writeFileSync(listPath, partPaths.map(p => `file '${p}'`).join('\n'));
        execSync(`ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${listPath}" -c copy "${outPath}"`, { timeout: 60_000 });
    }
    return outPath;
}

async function toVideoPart(proxyPath: string): Promise<Part> {
    const size = fs.statSync(proxyPath).size;
    if (size < INLINE_LIMIT_BYTES) {
        return { inlineData: { mimeType: 'video/mp4', data: fs.readFileSync(proxyPath).toString('base64') } };
    }

    // Files API fallback for long clips
    const ai = getGemini();
    const uploaded = await ai.files.upload({ file: proxyPath, config: { mimeType: 'video/mp4' } });
    const name = uploaded.name!;
    const deadline = Date.now() + 120_000;
    let file = uploaded;
    while (file.state !== 'ACTIVE') {
        if (file.state === 'FAILED') throw new Error('Files API processing failed');
        if (Date.now() > deadline) throw new Error('Files API processing timed out (120s)');
        await new Promise(r => setTimeout(r, 3000));
        file = await ai.files.get({ name });
    }
    return createPartFromUri(file.uri!, 'video/mp4');
}

/** Fold the verdict into the candidate; shift+re-snap the start on a bad opening */
function applyVerdict(
    moment: MomentCandidate,
    verdict: VisualVerdict,
    transcript: Transcript,
    silenceMap: SilenceMap | null
): MomentCandidate {
    const result: MomentCandidate = {
        ...moment,
        visualScore: verdict.visualScore,
        visualNotes: verdict.notes,
        musicWarning: verdict.musicProminent || undefined,
    };

    const shift = verdict.suggestedStartShift ?? 0;
    if (verdict.badOpening && shift !== 0 && Math.abs(shift) <= MAX_START_SHIFT) {
        const segs = (result.segments && result.segments.length > 0
            ? result.segments
            : [{ start: result.startTime, end: result.endTime }]).map(s => ({ ...s }));

        const proposed = Math.max(0, segs[0].start + shift);
        // Re-snap: never start mid-word, prefer the silence valley before the word
        const word = transcript.words.find(w => w.end > proposed);
        let newStart = proposed;
        if (word) {
            newStart = Math.max(0, word.start - 0.15);
            if (silenceMap) {
                const valley = silenceMap.silences.find(s => s.end <= word.start + 0.05 && word.start - s.end <= 1.5);
                if (valley) newStart = Math.max(valley.start, valley.end - 0.2);
            }
        }
        if (newStart < segs[0].end - 1.5) {
            segs[0].start = newStart;
            result.segments = segs;
            result.startTime = segs[0].start;
        }
    }
    return result;
}
