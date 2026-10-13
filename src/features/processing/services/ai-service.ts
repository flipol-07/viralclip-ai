/**
 * AI Service — Transcription only (Groq whisper-large-v3-turbo, fallback
 * OpenAI whisper-1). Viral moment analysis lives in ./analysis (Gemini).
 *
 * Transcription is chunked (10 min) with a per-chunk checkpoint on disk, so an
 * interrupted run never re-pays already-transcribed chunks.
 */
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { Transcript, TranscriptSegment, TranscriptWord } from '@/shared/types';

function getTranscriber(): { client: OpenAI; model: string; provider: string } {
    if (process.env.GROQ_API_KEY) {
        return {
            client: new OpenAI({
                apiKey: process.env.GROQ_API_KEY,
                baseURL: 'https://api.groq.com/openai/v1',
            }),
            model: 'whisper-large-v3-turbo',
            provider: 'groq',
        };
    }
    return { client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), model: 'whisper-1', provider: 'openai' };
}

const CHUNK_SECONDS = 600; // 10 min ≈ 5MB mp3 mono 16kHz — under the 25MB API limit

interface ChunkResult {
    text: string;
    segments: TranscriptSegment[];
    words: TranscriptWord[];
}

/**
 * Transcribe an audio file with word-level timestamps.
 * `checkpointDir` persists each chunk so a killed process resumes without re-paying.
 */
export async function transcribeAudio(audioPath: string, checkpointDir: string): Promise<Transcript> {
    const { client, model, provider } = getTranscriber();
    console.log(`[AI] Transcribing with ${provider}/${model}`);

    fs.mkdirSync(checkpointDir, { recursive: true });

    const durationStr = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
        { encoding: 'utf-8' }
    ).trim();
    const totalDuration = parseFloat(durationStr) || 0;
    const numChunks = Math.max(1, Math.ceil(totalDuration / CHUNK_SECONDS));

    const allSegments: TranscriptSegment[] = [];
    const allWords: TranscriptWord[] = [];
    let fullText = '';

    for (let i = 0; i < numChunks; i++) {
        const checkpointPath = path.join(checkpointDir, `chunk_${i}.json`);
        let chunk: ChunkResult;

        if (fs.existsSync(checkpointPath)) {
            chunk = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
            console.log(`[AI] Chunk ${i + 1}/${numChunks} restored from checkpoint`);
        } else {
            chunk = await transcribeChunk(client, model, audioPath, i, numChunks, checkpointDir);
            fs.writeFileSync(checkpointPath, JSON.stringify(chunk));
            console.log(`[AI] Chunk ${i + 1}/${numChunks} transcribed (${chunk.segments.length} segments)`);
        }

        fullText += (fullText ? ' ' : '') + chunk.text;
        allSegments.push(...chunk.segments);
        allWords.push(...chunk.words);
    }

    return { fullText, segments: allSegments, words: allWords };
}

async function transcribeChunk(
    client: OpenAI,
    model: string,
    audioPath: string,
    index: number,
    numChunks: number,
    workDir: string
): Promise<ChunkResult> {
    const offset = index * CHUNK_SECONDS;
    let chunkPath = audioPath;
    const isChunked = numChunks > 1;

    if (isChunked) {
        chunkPath = path.join(workDir, `audio_chunk_${index}.mp3`);
        execSync(
            `ffmpeg -y -hide_banner -loglevel error -ss ${offset} -t ${CHUNK_SECONDS} -i "${audioPath}" -acodec libmp3lame -ar 16000 -ac 1 -q:a 4 "${chunkPath}"`,
            { timeout: 120000 }
        );
    }

    try {
        const response = await client.audio.transcriptions.create({
            file: fs.createReadStream(chunkPath),
            model,
            response_format: 'verbose_json',
            timestamp_granularities: ['word', 'segment'],
        });

        const raw = response as unknown as {
            text: string;
            segments?: { start: number; end: number; text: string }[];
            words?: { start: number; end: number; word: string }[];
        };

        return {
            text: raw.text,
            segments: (raw.segments || []).map(s => ({
                start: s.start + offset,
                end: s.end + offset,
                text: s.text.trim(),
            })),
            words: (raw.words || []).map(w => ({
                start: w.start + offset,
                end: w.end + offset,
                word: w.word.trim(),
            })),
        };
    } finally {
        if (isChunked && fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
    }
}
