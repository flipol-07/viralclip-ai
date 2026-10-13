/**
 * Viral moment analysis — Gemini single-pass over the FULL transcript.
 *
 * The 1M-token context window means a 3h podcast (~60-80K tokens) fits in one
 * call, so the model sees the whole video: better curation, no clips lost at
 * window seams. Windowed mode survives only as a fallback for absurdly long
 * inputs, and the legacy gpt-4o-mini path as a last-resort if Gemini is down.
 */
import { generateJson } from './gemini-client';
import { buildAnalyzePrompt, analyzeResponseSchema, analyzeResponseZod, type AnalyzeResponse } from './prompts';
import type { MomentCandidate, Transcript, TranscriptSegment } from '@/shared/types';

export interface AnalysisOptions {
    language: string;
    clipDurationMin: number;
    clipDurationMax: number;
    performanceFeedback?: string;
}

/** Relaxed bar: analyze optimizes recall — the FINAL bar lives in curate.ts */
const MIN_SCORE = 45;

/** Rough chars→tokens; transcripts are mostly natural language */
const CHARS_PER_TOKEN = 3.5;
/** Above this estimated prompt size, fall back to windowed analysis */
const SINGLE_PASS_TOKEN_LIMIT = 700_000;
const FALLBACK_WINDOW_SECONDS = 3600; // 60 min windows (vs 20 min with gpt-4o-mini)
const FALLBACK_OVERLAP = 180;

export async function analyzeTranscript(transcript: Transcript, options: AnalysisOptions): Promise<MomentCandidate[]> {
    const { segments } = transcript;
    if (segments.length === 0) return [];

    let candidates: MomentCandidate[];
    try {
        candidates = await analyzeWithGemini(segments, options);
    } catch (err) {
        console.error('[AI] Gemini analysis failed, trying legacy OpenAI path:', err instanceof Error ? err.message : err);
        const { analyzeTranscriptLegacy } = await import('./legacy-openai');
        candidates = await analyzeTranscriptLegacy(transcript, options);
    }

    const deduped = dedupeOverlapping(candidates);
    const snapped = deduped.map(m => snapToSentences(m, transcript));

    // No fixed clip count: quality decides. Keep everything above the bar,
    // within retention-first sanity bounds (total on-screen time 8-120s).
    return snapped
        .filter(m => {
            const total = (m.segments || [{ start: m.startTime, end: m.endTime }])
                .reduce((acc, s) => acc + (s.end - s.start), 0);
            return total >= 8 && total <= 120 && m.score >= MIN_SCORE;
        })
        .sort((a, b) => b.score - a.score);
}

async function analyzeWithGemini(segments: TranscriptSegment[], options: AnalysisOptions): Promise<MomentCandidate[]> {
    const totalEnd = segments[segments.length - 1].end;
    const fullTimestamped = toTimestamped(segments);
    const estimatedTokens = fullTimestamped.length / CHARS_PER_TOKEN;

    if (estimatedTokens <= SINGLE_PASS_TOKEN_LIMIT) {
        console.log(`[AI] Single-pass analysis (~${Math.round(estimatedTokens / 1000)}K tokens, ${Math.round(totalEnd / 60)} min of video)`);
        const response = await generateJson<AnalyzeResponse>({
            label: 'analyze',
            input: buildAnalyzePrompt(fullTimestamped, {
                language: options.language,
                performanceFeedback: options.performanceFeedback,
                fullVideo: true,
                maxCandidates: 20,
            }),
            schema: analyzeResponseZod,
            responseSchema: analyzeResponseSchema as unknown as Record<string, unknown>,
            maxOutputTokens: 32768,
        });
        return normalizeMoments(response, totalEnd);
    }

    // Window fallback for extreme inputs (>~40h of speech) — same model and prompt
    console.log(`[AI] Transcript too large for single-pass (~${Math.round(estimatedTokens / 1000)}K tokens), windowing`);
    const all: MomentCandidate[] = [];
    for (let start = 0; start < totalEnd; start += FALLBACK_WINDOW_SECONDS - FALLBACK_OVERLAP) {
        const windowSegs = segments.filter(s => s.start >= start && s.start < start + FALLBACK_WINDOW_SECONDS);
        if (windowSegs.length === 0) continue;
        try {
            const response = await generateJson<AnalyzeResponse>({
                label: `analyze-window@${Math.round(start / 60)}min`,
                input: buildAnalyzePrompt(toTimestamped(windowSegs), {
                    language: options.language,
                    performanceFeedback: options.performanceFeedback,
                    fullVideo: false,
                    maxCandidates: 8,
                }),
                schema: analyzeResponseZod,
                responseSchema: analyzeResponseSchema as unknown as Record<string, unknown>,
            });
            all.push(...normalizeMoments(response, totalEnd));
        } catch (err) {
            console.error(`[AI] Window @${Math.round(start / 60)}min failed:`, err instanceof Error ? err.message : err);
        }
        if (start + FALLBACK_WINDOW_SECONDS >= totalEnd) break;
    }
    return all;
}

function toTimestamped(segments: TranscriptSegment[]): string {
    return segments.map(s => `[${s.start.toFixed(1)}s] ${s.text}`).join('\n');
}

/** Validate timestamps, merge touching segments, build the envelope */
export function normalizeMoments(response: AnalyzeResponse, videoDuration: number): MomentCandidate[] {
    const moments: MomentCandidate[] = [];

    for (const m of response.moments) {
        const segs = m.segments
            .filter(s => s.end > s.start + 1.5 && s.start >= 0 && s.start < videoDuration)
            .map(s => ({ start: s.start, end: Math.min(s.end, videoDuration) }))
            .sort((a, b) => a.start - b.start)
            .slice(0, 3);
        if (segs.length === 0 || !(m.score > 0)) continue;

        const mergedSegs = [segs[0]];
        for (const s of segs.slice(1)) {
            const last = mergedSegs[mergedSegs.length - 1];
            if (s.start <= last.end + 1) last.end = Math.max(last.end, s.end);
            else mergedSegs.push(s);
        }

        moments.push({
            title: m.title,
            description: m.description,
            hookTitle: m.hookTitle,
            needsContext: m.needsContext,
            score: m.score,
            metrics: m.metrics,
            keywords: m.keywords,
            type: m.type,
            emoji: m.emoji && m.emoji.trim() ? m.emoji.trim() : undefined,
            justification: m.justification,
            segments: mergedSegs,
            startTime: mergedSegs[0].start,
            endTime: mergedSegs[mergedSegs.length - 1].end,
        });
    }
    return moments;
}

/** Drop candidates that overlap a higher-scored one by more than 40% of the shorter clip */
export function dedupeOverlapping(candidates: MomentCandidate[]): MomentCandidate[] {
    const sorted = [...candidates].sort((a, b) => b.score - a.score);
    const kept: MomentCandidate[] = [];

    for (const c of sorted) {
        const overlaps = kept.some(k => {
            const overlap = Math.min(c.endTime, k.endTime) - Math.max(c.startTime, k.startTime);
            if (overlap <= 0) return false;
            const shorter = Math.min(c.endTime - c.startTime, k.endTime - k.startTime);
            return overlap / shorter > 0.4;
        });
        if (!overlaps) kept.push(c);
    }
    return kept;
}

/** Snap a single boundary pair to real sentence/word boundaries (never cut mid-word) */
function snapRange(start: number, end: number, transcript: Transcript): { start: number; end: number } {
    const { segments, words } = transcript;

    const startSeg = segments
        .filter(s => Math.abs(s.start - start) <= 4)
        .sort((a, b) => Math.abs(a.start - start) - Math.abs(b.start - start))[0];
    if (startSeg) start = startSeg.start;

    const endSeg = segments
        .filter(s => Math.abs(s.end - end) <= 4)
        .sort((a, b) => Math.abs(a.end - end) - Math.abs(b.end - end))[0];
    if (endSeg) end = endSeg.end;

    if (words.length > 0) {
        const wordAtStart = words.find(w => w.start < start && w.end > start);
        if (wordAtStart) start = wordAtStart.start;
        const wordAtEnd = words.find(w => w.start < end && w.end > end);
        if (wordAtEnd) end = wordAtEnd.end;
    }

    // Small lead-in/out padding for natural breathing room
    return { start: Math.max(0, start - 0.15), end: end + 0.35 };
}

/** Snap every segment of a moment and rebuild its envelope */
export function snapToSentences(moment: MomentCandidate, transcript: Transcript): MomentCandidate {
    const rawSegs = moment.segments && moment.segments.length > 0
        ? moment.segments
        : [{ start: moment.startTime, end: moment.endTime }];

    const snapped = rawSegs
        .map(s => snapRange(s.start, s.end, transcript))
        .filter(s => s.end - s.start > 1.5);

    if (snapped.length === 0) return moment;

    // Re-merge if snapping made segments touch
    const merged = [snapped[0]];
    for (const s of snapped.slice(1)) {
        const last = merged[merged.length - 1];
        if (s.start <= last.end + 0.5) last.end = Math.max(last.end, s.end);
        else merged.push(s);
    }

    return {
        ...moment,
        segments: merged,
        startTime: merged[0].start,
        endTime: merged[merged.length - 1].end,
    };
}
