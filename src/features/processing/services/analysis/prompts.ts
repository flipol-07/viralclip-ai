/**
 * Prompt builders + response schemas for every Gemini call in the pipeline.
 * One prompt per pass: analyze (candidates), refine (exact word boundaries),
 * visual (multimodal verdict), curate (global ranking).
 */
import { z } from 'zod';

export interface AnalyzePromptOptions {
    language: string;
    performanceFeedback?: string;
    /** true = the model sees the FULL video transcript (single-pass) */
    fullVideo: boolean;
    maxCandidates: number;
}

export function buildAnalyzePrompt(timestampedTranscript: string, opts: AnalyzePromptOptions): string {
    const scopeRule = opts.fullVideo
        ? `6. YOU SEE THE WHOLE VIDEO. If two moments cover the same theme, gag or story, propose only the strongest one. Spread picks across the video — don't cluster everything in one section just because it's good.`
        : `6. This is ONE WINDOW of a longer video; other windows are analyzed separately. Judge only what you see.`;

    return `You are an elite short-form video editor (TikTok / Reels / YouTube Shorts). Your ONLY goal: clips that go viral and hold the viewer until the end.

TRANSCRIPT (timestamps in seconds):
${timestampedTranscript}

Find up to ${opts.maxCandidates} moments with real viral potential. For each one, think like this:

1. HOOK FIRST. The clip must OPEN on the strongest possible line — a question, a bold claim, tension, a reaction. If the best hook is mid-conversation, start there. 50-60% of viewers drop in the first 3 seconds; win those 3 seconds.
2. DURATION IS FREE. A punchline can be 12s, a story can be 75s. The clip lasts exactly as long as it holds attention: start at the hook, end the moment the payoff lands. Never pad, never cut mid-sentence or before the reaction/punchline finishes.
3. CUT THE DEAD TIME. If a moment has a great setup and a great payoff separated by filler (e.g. someone preparing a lift, rambling between question and answer), return 2-3 chronological "segments" that skip the filler. Each segment must start/end at sentence boundaries. Use this only when it clearly improves retention — most clips are a single segment.
4. MUST STAND ALONE. A viewer with zero context has to understand and enjoy it. If the moment is great but needs one line of context (who is talking / what happened before), set "needsContext": true and write a "hookTitle": 4-7 punchy words (in ${opts.language}) that will be burned at the top of the video. If it's self-explanatory, "needsContext": false.
5. SCORE HONESTLY 0-100 (hook / flow / payoff breakdown). A clip where someone says "I won 50 euros, great, bye" with no context is a 20, not a 70.
${scopeRule}
7. BOUNDARIES ARE APPROXIMATE. A second pass will refine start/end to the exact word later. Prioritize capturing the COMPLETE moment (full setup, full payoff, the reaction after the punchline) over timestamp precision — but still aim for sentence boundaries.
8. EMOJI: pick at most ONE emoji that amplifies the moment's emotion (😂🔥😱💀🤯❤️…), or omit it. Never decorative.
${opts.performanceFeedback ? `9. PAST PERFORMANCE OF THIS CHANNEL: ${opts.performanceFeedback}` : ''}

Titles, descriptions and hookTitle in the transcript language (${opts.language}). keywords: 2-4 words from the clip worth visual emphasis in captions.`;
}

/** Gemini structured-output schema for the analyze pass */
export const analyzeResponseSchema = {
    type: 'object',
    properties: {
        moments: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    segments: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: { start: { type: 'number' }, end: { type: 'number' } },
                            required: ['start', 'end'],
                        },
                    },
                    title: { type: 'string' },
                    description: { type: 'string' },
                    hookTitle: { type: 'string' },
                    needsContext: { type: 'boolean' },
                    score: { type: 'number' },
                    metrics: {
                        type: 'object',
                        properties: { hook: { type: 'number' }, flow: { type: 'number' }, payoff: { type: 'number' } },
                        required: ['hook', 'flow', 'payoff'],
                    },
                    keywords: { type: 'array', items: { type: 'string' } },
                    type: { type: 'string', enum: ['funny', 'emotional', 'insight', 'tension', 'viral'] },
                    emoji: { type: 'string' },
                    justification: { type: 'string' },
                },
                required: ['segments', 'title', 'description', 'needsContext', 'score', 'type', 'justification'],
            },
        },
    },
    required: ['moments'],
} as const;

/** zod twin of analyzeResponseSchema — lenient where the model may drift */
export const analyzeResponseZod = z.object({
    moments: z.array(z.object({
        segments: z.array(z.object({ start: z.number(), end: z.number() })),
        title: z.string(),
        description: z.string().catch(''),
        hookTitle: z.string().optional(),
        needsContext: z.boolean().catch(false),
        score: z.number(),
        metrics: z.object({ hook: z.number(), flow: z.number(), payoff: z.number() }).optional(),
        keywords: z.array(z.string()).optional(),
        type: z.enum(['funny', 'emotional', 'insight', 'tension', 'viral']).catch('viral'),
        emoji: z.string().optional(),
        justification: z.string().catch(''),
    })),
});

export type AnalyzeResponse = z.infer<typeof analyzeResponseZod>;

// ============ REFINE PASS ============

export interface RefineBoundary {
    kind: 'start' | 'end';
    /** "globalIndex:[start-end] word" lines for ±25s around the boundary */
    wordWindow: string;
}

export function buildRefinePrompt(
    moment: { title: string; justification: string; hookTitle?: string },
    boundaries: RefineBoundary[],
    language: string
): string {
    const blocks = boundaries.map((b, i) => {
        const role = b.kind === 'start'
            ? `Pick the index of the FIRST word heard in this cut. The hook must hit instantly: drop greetings, connectors ("bueno", "entonces", "o sea", "pues nada"), false starts and anything weaker than the strongest opening line. If the real hook starts one sentence earlier or later than the current boundary, move it there.`
            : `Pick the index of the LAST word heard in this cut. Include the complete payoff and the reaction to it (the laugh line, the comeback) — then cut BEFORE the speaker drifts into the next topic. Never leave a sentence half-finished.`;
        return `BOUNDARY ${i} (${b.kind.toUpperCase()}):\n${b.wordWindow}\n→ ${role}`;
    }).join('\n\n');

    return `You are finalizing the EXACT cut points of a short-form clip (language: ${language}).

CLIP: "${moment.title}" — ${moment.justification}${moment.hookTitle ? `\nContext overlay that will be burned on screen: "${moment.hookTitle}"` : ''}

Each boundary below shows the words around the current (approximate) cut as "index:[start-end] word". Choose the exact word for each cut.

${blocks}

Rules: every chosen index MUST appear in its boundary's word list. Think about how the clip SOUNDS: it opens mid-energy on the hook and ends the instant the payoff lands.`;
}

export const refineResponseSchema = {
    type: 'object',
    properties: {
        boundaries: {
            type: 'array',
            items: {
                type: 'object',
                properties: { wordIndex: { type: 'integer' } },
                required: ['wordIndex'],
            },
        },
        reason: { type: 'string' },
    },
    required: ['boundaries'],
} as const;

export const refineResponseZod = z.object({
    boundaries: z.array(z.object({ wordIndex: z.number().int() })),
    reason: z.string().optional(),
});

export type RefineResponse = z.infer<typeof refineResponseZod>;

// ============ VISUAL PASS ============

export function buildVisualPrompt(moment: { title: string; justification: string; score: number }, durationS: number, truncated: boolean): string {
    return `You are an elite short-form editor reviewing a candidate clip BEFORE it gets rendered. The attached video is a low-res proxy of the exact cut (${durationS.toFixed(0)}s${truncated ? ', truncated — judge what you see' : ''}). From the transcript alone it scored ${moment.score}/100: "${moment.title}" — ${moment.justification}

Judge what the transcript could NOT see:
1. worksVisually: do the visuals carry the moment? (visible reactions, laughter, gestures, action, expressive faces) or is it a static wide shot / someone with their back turned / a screen the viewer can't read?
2. visualScore 0-100: how much the VISUALS alone add to retention. A huge laugh on camera is 90+; an unmoving talking head is ~40; back turned / unreadable screen is <25.
3. badOpening: does the FIRST second fail visually (speaker not on screen, back turned, mid-gesture confusion)? Viewers decide in 1 second.
4. suggestedStartShift: if a visibly better opening frame exists within ±3s, the shift in seconds (negative = start earlier). Omit if the opening is fine.
5. musicProminent: is there recognizable MUSIC clearly audible (a song playing in the stream, a musical performance)? Voice-only or faint ambient noise = false. This flags copyright risk, so only true when music is unmistakable.
6. notes: one line, concrete (what's on screen, where the visual peak lands).`;
}

export const visualResponseSchema = {
    type: 'object',
    properties: {
        worksVisually: { type: 'boolean' },
        visualScore: { type: 'number' },
        notes: { type: 'string' },
        badOpening: { type: 'boolean' },
        suggestedStartShift: { type: 'number' },
        musicProminent: { type: 'boolean' },
    },
    required: ['worksVisually', 'visualScore', 'notes'],
} as const;

export const visualResponseZod = z.object({
    worksVisually: z.boolean(),
    visualScore: z.number(),
    notes: z.string(),
    badOpening: z.boolean().optional(),
    suggestedStartShift: z.number().optional(),
    musicProminent: z.boolean().optional(),
});

// ============ CURATE PASS ============

export interface CurateCandidate {
    id: number;
    title: string;
    type: string;
    durationS: number;
    score: number;
    metrics?: { hook: number; flow: number; payoff: number };
    visualScore?: number;
    visualNotes?: string;
    opening: string;
    closing: string;
    keywords?: string[];
    /** Prominent background music heard in the proxy (Content ID risk) */
    musicWarning?: boolean;
}

export function buildCuratePrompt(candidates: CurateCandidate[], topN: number, language: string, sourceName?: string): string {
    const list = candidates.map(c =>
        `#${c.id} [${c.score}/100${c.visualScore !== undefined ? ` · visual ${c.visualScore}/100` : ''}] "${c.title}" (${c.type}, ${c.durationS.toFixed(0)}s)
   opens: "${c.opening}"
   closes: "${c.closing}"${c.visualNotes ? `\n   visual: ${c.visualNotes}` : ''}${c.keywords?.length ? `\n   keywords: ${c.keywords.join(', ')}` : ''}${c.musicWarning ? `\n   ⚠ prominent background music (copyright risk)` : ''}`
    ).join('\n');

    return `You are curating the FINAL clip selection for one long video (language: ${language}). Candidates:

${list}

Compare them ALL against each other:
1. REDUNDANCY: if two candidates tell the same story/gag/insight, keep only the stronger one (keep=false for the rest, say which one beat it).
2. RE-SCORE relative to this batch: finalScore 0-100 where the best of the batch lands 90+ and anything that wouldn't stop a scroll lands below 55. Use visualScore as a tiebreaker and a penalty when the visuals don't carry (talking-head-only is fine if the words are strong). Candidates flagged with prominent background music carry copyright risk: prefer a music-free candidate when quality is close.
3. SELECT: keep at most ${topN}, prioritizing variety of types (funny/insight/tension…) over raw score when close.
4. reason: one line per candidate (why it stays or which candidate replaced it).
5. PUBLISH COPY — only for kept candidates, written in ${language}, ready to paste:
   - ytTitle: YouTube Shorts title, max 90 chars. The hook IS the title — curiosity gap or bold claim, never clickbait that the clip doesn't pay off.
   - ytCaption: 1-2 sentences; the first 100 chars must carry the main keyword.${sourceName ? ` Credit the source naturally (clip de ${sourceName}).` : ''}
   - ttCaption: TikTok caption, short and punchy, can use 1 emoji.${sourceName ? ` Include the credit (📹 ${sourceName}).` : ''}
   - igCaption: Instagram Reels caption, conversational, ends with a question or CTA that invites comments.${sourceName ? ` Include the credit.` : ''}
   - hashtags: 3-5 lowercase niche-relevant hashtags WITHOUT '#' (specific beats generic: "ibai" beats "humor").

Every candidate id must appear exactly once in the ranking.`;
}

export const curateResponseSchema = {
    type: 'object',
    properties: {
        ranked: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                    keep: { type: 'boolean' },
                    finalScore: { type: 'number' },
                    reason: { type: 'string' },
                    publish: {
                        type: 'object',
                        properties: {
                            ytTitle: { type: 'string' },
                            ytCaption: { type: 'string' },
                            ttCaption: { type: 'string' },
                            igCaption: { type: 'string' },
                            hashtags: { type: 'array', items: { type: 'string' } },
                        },
                        required: ['ytTitle', 'ytCaption', 'ttCaption', 'igCaption', 'hashtags'],
                    },
                },
                required: ['id', 'keep', 'finalScore', 'reason'],
            },
        },
    },
    required: ['ranked'],
} as const;

export const curateResponseZod = z.object({
    ranked: z.array(z.object({
        id: z.number().int(),
        keep: z.boolean(),
        finalScore: z.number(),
        reason: z.string().catch(''),
        publish: z.object({
            ytTitle: z.string(),
            ytCaption: z.string().catch(''),
            ttCaption: z.string().catch(''),
            igCaption: z.string().catch(''),
            hashtags: z.array(z.string()).catch([]),
        }).optional(),
    })),
});

export type CurateResponse = z.infer<typeof curateResponseZod>;
