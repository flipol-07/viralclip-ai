/**
 * Gemini client — single integration point for every reasoning call in the
 * pipeline (analyze, refine, visual, curate). Transcription stays on the
 * `openai` package (Groq Whisper) and never touches this module.
 *
 * The model ID is resolved at runtime against the live model list so the
 * pipeline survives Google renaming previews (gemini-3-flash vs -preview).
 */
import { GoogleGenAI, MediaResolution, type Part } from '@google/genai';
import { z } from 'zod';

let _client: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
    if (!_client) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY is not set. Create one at https://aistudio.google.com/apikey and add it to .env.local');
        }
        _client = new GoogleGenAI({ apiKey });
    }
    return _client;
}

/** Preferred model IDs, best first. GEMINI_MODEL env overrides everything. */
const MODEL_PREFERENCE = [
    'gemini-3-flash',
    'gemini-3-flash-preview',
    'gemini-3-flash-latest',
    'gemini-2.5-flash',
];

let _resolvedModel: string | null = null;

export async function resolveModelId(): Promise<string> {
    if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
    if (_resolvedModel) return _resolvedModel;

    const available = new Set<string>();
    try {
        const pager = await getGemini().models.list();
        for await (const model of pager) {
            // API returns names like "models/gemini-2.5-flash"
            if (model.name) available.add(model.name.replace(/^models\//, ''));
        }
    } catch (err) {
        console.warn('[Gemini] models.list() failed, falling back to default:', err instanceof Error ? err.message : err);
        _resolvedModel = MODEL_PREFERENCE[MODEL_PREFERENCE.length - 1];
        return _resolvedModel;
    }

    _resolvedModel =
        MODEL_PREFERENCE.find(id => available.has(id)) ??
        [...available].find(id => id.startsWith('gemini-3-flash') && !/lite|image|live|tts/.test(id)) ??
        MODEL_PREFERENCE[MODEL_PREFERENCE.length - 1];

    console.log(`[Gemini] Using model: ${_resolvedModel}`);
    return _resolvedModel;
}

const MAX_ATTEMPTS = 4;
const RETRYABLE = /\b(429|500|503)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded/i;

export interface GenerateJsonOptions<T> {
    /** Prompt text, or multimodal parts (text + inlineData/fileData video) */
    input: string | Part[];
    /** Runtime validation of the parsed response */
    schema: z.ZodType<T>;
    /** Gemini structured-output schema (plain JSON schema subset) */
    responseSchema: Record<string, unknown>;
    temperature?: number;
    maxOutputTokens?: number;
    /** Lower video token cost for multimodal calls */
    lowMediaResolution?: boolean;
    /** Tag for logs, e.g. "analyze", "refine" */
    label: string;
}

/**
 * One JSON-mode call with structured output, zod validation and
 * exponential backoff on rate limits / transient server errors.
 */
export async function generateJson<T>(opts: GenerateJsonOptions<T>): Promise<T> {
    const model = await resolveModelId();
    const contents = typeof opts.input === 'string'
        ? [{ role: 'user' as const, parts: [{ text: opts.input }] }]
        : [{ role: 'user' as const, parts: opts.input }];

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const response = await getGemini().models.generateContent({
                model,
                contents,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: opts.responseSchema,
                    temperature: opts.temperature ?? 0.4,
                    maxOutputTokens: opts.maxOutputTokens ?? 16384,
                    ...(opts.lowMediaResolution ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW } : {}),
                },
            });

            const usage = response.usageMetadata;
            if (usage) {
                console.log(`[Gemini] ${opts.label}: ${usage.promptTokenCount ?? '?'} in / ${usage.candidatesTokenCount ?? '?'} out tokens`);
            }

            const text = (response.text ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '');
            if (!text) throw new Error(`empty response (finishReason: ${response.candidates?.[0]?.finishReason ?? 'unknown'})`);

            const validated = opts.schema.safeParse(JSON.parse(text));
            if (!validated.success) {
                throw new Error(`response failed schema validation: ${validated.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
            }
            return validated.data;
        } catch (err) {
            lastError = err;
            const msg = err instanceof Error ? err.message : String(err);
            const retryable = RETRYABLE.test(msg) || err instanceof SyntaxError;
            if (!retryable || attempt === MAX_ATTEMPTS) break;
            const delay = Math.round(1500 * 2 ** (attempt - 1) * (1 + Math.random() * 0.3));
            console.warn(`[Gemini] ${opts.label} attempt ${attempt}/${MAX_ATTEMPTS} failed (${msg.slice(0, 120)}), retrying in ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw new Error(`[Gemini] ${opts.label} failed after ${MAX_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
