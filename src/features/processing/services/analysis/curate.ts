/**
 * Global curation — one call compares ALL refined candidates of the video
 * against each other: kills thematic duplicates, re-scores relative to the
 * batch, keeps the top N with type variety. The final quality bar lives here.
 */
import { generateJson } from './gemini-client';
import { buildCuratePrompt, curateResponseSchema, curateResponseZod, type CurateCandidate, type CurateResponse } from './prompts';
import type { MomentCandidate, Transcript } from '@/shared/types';

/** Clips below this final score are not worth rendering */
const FINAL_MIN_SCORE = 55;
export const DEFAULT_MAX_CLIPS = 9;

export async function curateMoments(
    moments: MomentCandidate[],
    transcript: Transcript,
    topN: number,
    language: string,
    sourceName?: string
): Promise<MomentCandidate[]> {
    if (moments.length === 0) return [];

    const candidates: CurateCandidate[] = moments.map((m, i) => ({
        id: i,
        title: m.title,
        type: m.type,
        durationS: (m.segments || [{ start: m.startTime, end: m.endTime }]).reduce((a, s) => a + s.end - s.start, 0),
        score: m.score,
        metrics: m.metrics,
        visualScore: m.visualScore,
        visualNotes: m.visualNotes,
        opening: excerpt(transcript, m.startTime, 12, 'after'),
        closing: excerpt(transcript, m.endTime, 12, 'before'),
        keywords: m.keywords,
        musicWarning: m.musicWarning,
    }));

    let response: CurateResponse;
    try {
        response = await generateJson<CurateResponse>({
            label: 'curate',
            input: buildCuratePrompt(candidates, topN, language, sourceName),
            schema: curateResponseZod,
            responseSchema: curateResponseSchema as unknown as Record<string, unknown>,
            temperature: 0.2,
            maxOutputTokens: 16384,
        });
    } catch (err) {
        // Curation must never kill the pipeline: fall back to score order
        console.warn('[Curate] LLM curation failed, falling back to score order:', err instanceof Error ? err.message : err);
        return moments
            .filter(m => m.score >= FINAL_MIN_SCORE)
            .sort((a, b) => b.score - a.score)
            .slice(0, topN)
            .map((m, i) => ({ ...m, curationRank: i + 1, curationReason: 'fallback: ranked by analysis score' }));
    }

    const kept = response.ranked
        .filter(r => r.keep && r.finalScore >= FINAL_MIN_SCORE && moments[r.id])
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, topN);

    const dropped = response.ranked.filter(r => !r.keep || r.finalScore < FINAL_MIN_SCORE);
    for (const d of dropped.slice(0, 10)) {
        console.log(`[Curate] ✂ #${d.id} "${moments[d.id]?.title ?? '?'}" (${d.finalScore}): ${d.reason}`);
    }

    return kept.map((r, i) => ({
        ...moments[r.id],
        score: Math.round(r.finalScore),
        curationRank: i + 1,
        curationReason: r.reason,
        publishPack: r.publish ? {
            youtube: { title: r.publish.ytTitle.slice(0, 100), caption: r.publish.ytCaption, hashtags: cleanTags(r.publish.hashtags) },
            tiktok: { caption: r.publish.ttCaption, hashtags: cleanTags(r.publish.hashtags) },
            instagram: { caption: r.publish.igCaption, hashtags: cleanTags(r.publish.hashtags) },
        } : undefined,
    }));
}

/** Normalize model hashtags: strip '#', spaces, dedupe, cap at 5 */
function cleanTags(tags: string[]): string[] {
    const seen = new Set<string>();
    for (const t of tags) {
        const clean = t.replace(/^#/, '').replace(/\s+/g, '').toLowerCase();
        if (clean) seen.add(clean);
    }
    return [...seen].slice(0, 5);
}

/** First/last words around a boundary, so the curator "hears" how clips open and close */
function excerpt(transcript: Transcript, t: number, wordCount: number, dir: 'after' | 'before'): string {
    const words = transcript.words;
    if (words.length === 0) return '';
    if (dir === 'after') {
        const startIdx = words.findIndex(w => w.end > t);
        if (startIdx === -1) return '';
        return words.slice(startIdx, startIdx + wordCount).map(w => w.word).join(' ');
    }
    let endIdx = words.length - 1;
    while (endIdx > 0 && words[endIdx].start > t) endIdx--;
    return words.slice(Math.max(0, endIdx - wordCount + 1), endIdx + 1).map(w => w.word).join(' ');
}
