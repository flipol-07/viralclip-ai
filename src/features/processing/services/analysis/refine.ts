/**
 * Surgical boundary refinement — per candidate, one LLM call picks the exact
 * word where each cut starts/ends (word-level timestamps the analyze pass
 * never saw), then the cut is landed in the nearest real silence valley.
 *
 * Checkpointed per candidate: a killed worker never re-pays refined moments.
 */
import fs from 'fs';
import path from 'path';
import { generateJson } from './gemini-client';
import { buildRefinePrompt, refineResponseSchema, refineResponseZod, type RefineBoundary, type RefineResponse } from './prompts';
import { silenceEndingBefore, silenceStartingAfter } from './silence';
import type { MomentCandidate, SilenceMap, Transcript, TranscriptWord } from '@/shared/types';

const WINDOW_SECONDS = 25;
/** Default paddings when no silence valley is found (current behaviour) */
const START_PAD = 0.15;
const END_PAD = 0.35;

export async function refineMoments(
    moments: MomentCandidate[],
    transcript: Transcript,
    silenceMap: SilenceMap | null,
    checkpointDir: string,
    language: string
): Promise<MomentCandidate[]> {
    if (transcript.words.length === 0) return moments; // nothing to refine against

    fs.mkdirSync(checkpointDir, { recursive: true });
    const refined: MomentCandidate[] = [];

    for (let i = 0; i < moments.length; i++) {
        const checkpointPath = path.join(checkpointDir, `cand_${i}.json`);
        if (fs.existsSync(checkpointPath)) {
            refined.push(JSON.parse(fs.readFileSync(checkpointPath, 'utf-8')));
            continue;
        }

        let result: MomentCandidate;
        try {
            result = await refineMoment(moments[i], transcript, silenceMap, language);
        } catch (err) {
            console.warn(`[Refine] Candidate ${i} ("${moments[i].title}") failed, keeping sentence-snapped bounds:`, err instanceof Error ? err.message : err);
            result = { ...moments[i], refinedBy: 'snap' };
        }
        fs.writeFileSync(checkpointPath, JSON.stringify(result));
        refined.push(result);
        console.log(`[Refine] ${i + 1}/${moments.length}: ${result.startTime.toFixed(2)}-${result.endTime.toFixed(2)}s "${result.title}"`);
    }
    return refined;
}

async function refineMoment(
    moment: MomentCandidate,
    transcript: Transcript,
    silenceMap: SilenceMap | null,
    language: string
): Promise<MomentCandidate> {
    const segs = moment.segments && moment.segments.length > 0
        ? moment.segments
        : [{ start: moment.startTime, end: moment.endTime }];

    // One boundary per segment edge, in chronological order: s0.start, s0.end, s1.start, ...
    const boundaries: { kind: 'start' | 'end'; t: number }[] = [];
    for (const s of segs) {
        boundaries.push({ kind: 'start', t: s.start });
        boundaries.push({ kind: 'end', t: s.end });
    }

    const promptBoundaries: RefineBoundary[] = boundaries.map(b => ({
        kind: b.kind,
        wordWindow: wordWindow(transcript.words, b.t),
    }));
    if (promptBoundaries.some(b => b.wordWindow.length === 0)) {
        return { ...moment, refinedBy: 'snap' }; // empty word window → transcript gap, keep as-is
    }

    const response = await generateJson<RefineResponse>({
        label: 'refine',
        input: buildRefinePrompt(moment, promptBoundaries, language),
        schema: refineResponseZod,
        responseSchema: refineResponseSchema as unknown as Record<string, unknown>,
        temperature: 0.2,
        maxOutputTokens: 4096,
    });
    if (response.boundaries.length !== boundaries.length) {
        throw new Error(`expected ${boundaries.length} boundaries, got ${response.boundaries.length}`);
    }

    // Map chosen words back to cut times, landing each in a silence valley
    const newSegs: { start: number; end: number }[] = [];
    for (let s = 0; s < segs.length; s++) {
        const startWord = wordAt(transcript.words, response.boundaries[s * 2].wordIndex, boundaries[s * 2].t);
        const endWord = wordAt(transcript.words, response.boundaries[s * 2 + 1].wordIndex, boundaries[s * 2 + 1].t);
        if (!startWord || !endWord || endWord.end <= startWord.start + 1.5) {
            newSegs.push(segs[s]); // refusal-proof: keep the original segment
            continue;
        }
        newSegs.push({
            start: snapStart(startWord, silenceMap),
            end: snapEnd(endWord, transcript.words, silenceMap),
        });
    }

    // Re-merge touching segments and rebuild the envelope
    const merged = [newSegs[0]];
    for (const s of newSegs.slice(1)) {
        const last = merged[merged.length - 1];
        if (s.start <= last.end + 0.5) last.end = Math.max(last.end, s.end);
        else merged.push(s);
    }

    return {
        ...moment,
        segments: merged,
        startTime: merged[0].start,
        endTime: merged[merged.length - 1].end,
        refinedBy: 'llm',
    };
}

/** "globalIndex:[start-end] word" lines for words within ±WINDOW_SECONDS of t */
function wordWindow(words: TranscriptWord[], t: number): string {
    const lines: string[] = [];
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w.end < t - WINDOW_SECONDS) continue;
        if (w.start > t + WINDOW_SECONDS) break;
        lines.push(`${i}:[${w.start.toFixed(2)}-${w.end.toFixed(2)}] ${w.word}`);
    }
    return lines.join('\n');
}

/** Chosen word, but only if it stayed inside the window (hallucination guard) */
function wordAt(words: TranscriptWord[], index: number, boundaryT: number): TranscriptWord | null {
    const w = words[index];
    if (!w) return null;
    if (Math.abs(w.start - boundaryT) > WINDOW_SECONDS + 5) return null;
    return w;
}

/** Start cut: in the silence valley right before the first word, else small pad */
function snapStart(word: TranscriptWord, map: SilenceMap | null): number {
    if (map) {
        const valley = silenceEndingBefore(map, word.start);
        if (valley) return Math.max(valley.start, valley.end - 0.2);
    }
    return Math.max(0, word.start - START_PAD);
}

/** End cut: into the silence after the last word, never touching the next word */
function snapEnd(word: TranscriptWord, words: TranscriptWord[], map: SilenceMap | null): number {
    const next = words.find(w => w.start > word.end + 0.01);
    if (map) {
        const valley = silenceStartingAfter(map, word.end);
        if (valley) {
            const cut = valley.start + 0.3;
            return next ? Math.min(cut, next.start - 0.05) : Math.min(cut, valley.end);
        }
    }
    const cut = word.end + END_PAD;
    return next ? Math.min(cut, next.start - 0.05) : cut;
}
