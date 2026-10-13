/**
 * Dev tool: run analysis passes against an existing transcript WITHOUT
 * touching the DB or rendering. Output goes to *.cli.json artifacts so the
 * real pipeline files are never clobbered.
 *
 *   npx tsx scripts/analyze-cli.ts <ytid> [--stage analyze|refine|curate] [--lang es]
 */
import fs from 'fs';
import path from 'path';

// Load .env.local before importing anything that reads process.env at module scope
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (match && !(match[1] in process.env)) {
            process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
        }
    }
}

const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR || './data');

function arg(flag: string, fallback: string): string {
    const i = process.argv.indexOf(flag);
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
    const ytId = process.argv[2];
    if (!ytId || ytId.startsWith('--')) {
        console.error('Usage: npx tsx scripts/analyze-cli.ts <ytid> [--stage analyze|refine|curate] [--lang es]');
        process.exit(1);
    }
    const stage = arg('--stage', 'analyze');
    const language = arg('--lang', 'es');

    const transcriptPath = path.join(DATA_DIR, 'transcripts', `${ytId}.json`);
    if (!fs.existsSync(transcriptPath)) {
        console.error(`Transcript not found: ${transcriptPath}`);
        process.exit(1);
    }
    const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
    console.log(`Transcript: ${transcript.segments.length} segments, ${transcript.words.length} words, ${(transcript.segments.at(-1)?.end / 60).toFixed(0)} min`);

    const options = { language, clipDurationMin: 25, clipDurationMax: 75 };

    if (stage === 'analyze') {
        const { analyzeTranscript } = await import('../src/features/processing/services/analysis');
        const t0 = Date.now();
        const moments = await analyzeTranscript(transcript, options);
        const outPath = path.join(DATA_DIR, 'transcripts', `${ytId}.moments.cli.json`);
        fs.writeFileSync(outPath, JSON.stringify(moments, null, 2));

        console.log(`\n${moments.length} moments in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${outPath}\n`);
        for (const m of moments) {
            const segs = m.segments?.length ?? 1;
            const dur = (m.segments || [{ start: m.startTime, end: m.endTime }]).reduce((a, s) => a + s.end - s.start, 0);
            console.log(`  [${String(m.score).padStart(3)}] ${fmt(m.startTime)}-${fmt(m.endTime)} ${dur.toFixed(0)}s ${segs > 1 ? `(${segs} cortes) ` : ''}${m.emoji ?? ''} ${m.title}`);
            console.log(`        ${m.justification}`);
        }
        return;
    }

    if (stage === 'refine') {
        const { refineMoments } = await import('../src/features/processing/services/analysis/refine');
        const { generateSilenceMap, loadSilenceMap } = await import('../src/features/processing/services/analysis/silence');

        const moments = loadStageInput(ytId, ['moments.cli.json', 'moments.json']);
        const silencePath = path.join(DATA_DIR, 'transcripts', `${ytId}.silence.json`);
        let silenceMap = loadSilenceMap(silencePath);
        if (!silenceMap) {
            const source = [`${ytId}_audio.mp3`, `${ytId}.mp4`, `${ytId}.webm`, `${ytId}.mkv`]
                .map(f => path.join(DATA_DIR, 'videos', f)).find(fs.existsSync);
            if (source) {
                console.log(`Generating silence map from ${path.basename(source)}...`);
                silenceMap = generateSilenceMap(source, silencePath);
            } else {
                console.log('No audio/video source on disk — refining on word timestamps only');
            }
        }

        const chunksDir = path.join(DATA_DIR, 'transcripts', `${ytId}.refine.cli.chunks`);
        const refined = await refineMoments(moments, transcript, silenceMap, chunksDir, language);
        fs.rmSync(chunksDir, { recursive: true, force: true });
        const outPath = path.join(DATA_DIR, 'transcripts', `${ytId}.refined.cli.json`);
        fs.writeFileSync(outPath, JSON.stringify(refined, null, 2));

        console.log(`\n${refined.length} refined → ${outPath}\n`);
        let snapped = 0;
        for (let i = 0; i < refined.length; i++) {
            const before = moments[i];
            const after = refined[i];
            const dStart = after.startTime - before.startTime;
            const dEnd = after.endTime - before.endTime;
            // Assert: each refined cut lands in a silence valley or at a word edge (±0.05s)
            const okStart = boundaryOk(after.startTime, 'start', transcript, silenceMap);
            const okEnd = boundaryOk(after.endTime, 'end', transcript, silenceMap);
            if (okStart && okEnd) snapped++;
            console.log(`  [${after.refinedBy ?? '—'}] Δstart ${dStart >= 0 ? '+' : ''}${dStart.toFixed(2)}s Δend ${dEnd >= 0 ? '+' : ''}${dEnd.toFixed(2)}s ${okStart && okEnd ? '✓' : '⚠ off-boundary'} ${after.title}`);
        }
        console.log(`\n${snapped}/${refined.length} clips with both cuts on silence/word boundaries`);
        return;
    }

    if (stage === 'curate') {
        const { curateMoments } = await import('../src/features/processing/services/analysis/curate');
        const moments = loadStageInput(ytId, ['refined.cli.json', 'refined.json', 'moments.cli.json', 'moments.json']);
        const curated = await curateMoments(moments, transcript, parseInt(arg('--top', '9'), 10), language);
        const outPath = path.join(DATA_DIR, 'transcripts', `${ytId}.curated.cli.json`);
        fs.writeFileSync(outPath, JSON.stringify(curated, null, 2));

        console.log(`\n${curated.length}/${moments.length} survive curation → ${outPath}\n`);
        for (const m of curated) {
            console.log(`  #${m.curationRank} [${String(m.score).padStart(3)}] ${m.emoji ?? ''} ${m.title}`);
            console.log(`        ${m.curationReason}`);
        }
        return;
    }

    console.error(`Unknown stage "${stage}" (use analyze|refine|curate)`);
    process.exit(1);
}

function loadStageInput(ytId: string, preference: string[]): import('../src/shared/types').MomentCandidate[] {
    for (const suffix of preference) {
        const p = path.join(DATA_DIR, 'transcripts', `${ytId}.${suffix}`);
        if (fs.existsSync(p)) {
            console.log(`Input: ${p}`);
            return JSON.parse(fs.readFileSync(p, 'utf-8'));
        }
    }
    console.error(`No input artifact found for ${ytId} (tried: ${preference.join(', ')}). Run --stage analyze first.`);
    process.exit(1);
}

function boundaryOk(
    t: number,
    kind: 'start' | 'end',
    transcript: { words: { start: number; end: number }[] },
    silenceMap: import('../src/shared/types').SilenceMap | null
): boolean {
    if (silenceMap?.silences.some(s => t >= s.start - 0.05 && t <= s.end + 0.05)) return true;
    const tol = 0.45; // word edge + lead-in/out padding
    return transcript.words.some(w => kind === 'start' ? Math.abs(w.start - t) <= tol : Math.abs(w.end - t) <= tol);
}

function fmt(s: number): string {
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

main().catch(err => {
    console.error('❌', err instanceof Error ? err.message : err);
    process.exit(1);
});
