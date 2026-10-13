/**
 * Legacy analysis path — gpt-4o-mini over 20-min windows. Kept ONLY as a
 * last-resort fallback when Gemini is unreachable and OPENAI_API_KEY exists.
 * Quality is noticeably below the Gemini single-pass; do not extend this.
 */
import OpenAI from 'openai';
import { buildAnalyzePrompt, analyzeResponseZod } from './prompts';
import { normalizeMoments } from './analyze';
import type { MomentCandidate, Transcript, TranscriptSegment } from '@/shared/types';
import type { AnalysisOptions } from './analyze';

const WINDOW_SECONDS = 1200;
const WINDOW_OVERLAP = 120;

export async function analyzeTranscriptLegacy(transcript: Transcript, options: AnalysisOptions): Promise<MomentCandidate[]> {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('Gemini failed and no OPENAI_API_KEY for the legacy fallback');
    }
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const { segments } = transcript;
    const totalEnd = segments[segments.length - 1].end;
    const all: MomentCandidate[] = [];

    for (let start = 0; start < totalEnd; start += WINDOW_SECONDS - WINDOW_OVERLAP) {
        const windowSegs = segments.filter(s => s.start >= start && s.start < start + WINDOW_SECONDS);
        if (windowSegs.length > 0) {
            try {
                all.push(...await analyzeWindow(openai, windowSegs, totalEnd, options));
            } catch (err) {
                console.error(`[AI-legacy] Window @${Math.round(start / 60)}min failed:`, err instanceof Error ? err.message : err);
            }
        }
        if (start + WINDOW_SECONDS >= totalEnd) break;
    }
    return all;
}

async function analyzeWindow(
    openai: OpenAI,
    segments: TranscriptSegment[],
    videoDuration: number,
    options: AnalysisOptions
): Promise<MomentCandidate[]> {
    const timestamped = segments.map(s => `[${s.start.toFixed(1)}s] ${s.text}`).join('\n');
    const prompt = buildAnalyzePrompt(timestamped, {
        language: options.language,
        performanceFeedback: options.performanceFeedback,
        fullVideo: false,
        maxCandidates: 6,
    }) + `\n\nRespond with JSON: {"moments": [{"segments": [{"start": <s>, "end": <s>}], "title": "...", "description": "...", "hookTitle": "...", "needsContext": true|false, "score": <0-100>, "metrics": {"hook": <0-100>, "flow": <0-100>, "payoff": <0-100>}, "keywords": ["..."], "type": "funny|emotional|insight|tension|viral", "emoji": "...", "justification": "..."}]}`;

    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: 'You output only valid JSON. Timestamps must be precise seconds taken from the transcript.' },
            { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 4000,
    });

    const parsed = analyzeResponseZod.safeParse(JSON.parse(response.choices[0]?.message?.content || '{}'));
    if (!parsed.success) return [];
    return normalizeMoments(parsed.data, videoDuration);
}
