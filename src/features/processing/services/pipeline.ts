/**
 * Processing Pipeline v3 — stage-based, checkpointed, resumable.
 *
 * Stages: ingest → audio → transcribe → analyze → refine → visual → curate → render → done
 * Every stage validates its on-disk artifact before running, so a killed
 * process resumes exactly where it stopped (per transcription chunk, per
 * refined/verified candidate, per clip).
 */
import path from 'path';
import fs from 'fs';
import { downloadVideo, extractAudio } from './youtube-service';
import { transcribeAudio } from './ai-service';
import { analyzeTranscript } from './analysis';
import { generateSilenceMap, loadSilenceMap } from './analysis/silence';
import { refineMoments } from './analysis/refine';
import { runVisualPass, visualPassEnabled } from './analysis/visual';
import { curateMoments, DEFAULT_MAX_CLIPS } from './analysis/curate';
import { createClip } from './video-service';
import { writePublishPack } from './export-service';
import * as db from '@/shared/lib/local-db';
import type { Video, Transcript, MomentCandidate, Channel } from '@/shared/types';

const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR || './data');

const paths = {
    videosDir: () => path.join(DATA_DIR, 'videos'),
    transcriptsDir: () => path.join(DATA_DIR, 'transcripts'),
    audio: (ytId: string) => path.join(DATA_DIR, 'videos', `${ytId}_audio.mp3`),
    transcript: (ytId: string) => path.join(DATA_DIR, 'transcripts', `${ytId}.json`),
    transcriptChunks: (ytId: string) => path.join(DATA_DIR, 'transcripts', `${ytId}.chunks`),
    moments: (ytId: string) => path.join(DATA_DIR, 'transcripts', `${ytId}.moments.json`),
    silence: (ytId: string) => path.join(DATA_DIR, 'transcripts', `${ytId}.silence.json`),
    refined: (ytId: string) => path.join(DATA_DIR, 'transcripts', `${ytId}.refined.json`),
    refineChunks: (ytId: string) => path.join(DATA_DIR, 'transcripts', `${ytId}.refine.chunks`),
    visual: (ytId: string) => path.join(DATA_DIR, 'transcripts', `${ytId}.visual.json`),
    visualChunks: (ytId: string) => path.join(DATA_DIR, 'transcripts', `${ytId}.visual.chunks`),
    curated: (ytId: string) => path.join(DATA_DIR, 'transcripts', `${ytId}.curated.json`),
};

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Process a video through the pipeline, resuming from its last completed stage.
 */
export async function processVideo(videoId: string): Promise<void> {
    let video = db.getVideo(videoId);
    if (!video) throw new Error(`Video not found: ${videoId}`);

    const channel = video.channelId ? db.getChannel(video.channelId) : undefined;
    const analysisOptions = {
        language: channel?.language || 'es',
        // 20-45s default: mejor completion rate en Shorts/TikTok (la métrica reina en 2026)
        clipDurationMin: channel?.clipDurationMin || 20,
        clipDurationMax: channel?.clipDurationMax || 45,
        performanceFeedback: channel?.performanceFeedback,
    };

    ensureDir(paths.videosDir());
    ensureDir(paths.transcriptsDir());

    try {
        // ============ STAGE 1: INGEST ============
        if (!isStageDone(video, 'ingest')) {
            db.updateVideo(videoId, { status: 'downloading', stage: 'ingest' });
            video = await stageIngest(video);
        }

        // ============ STAGE 2: AUDIO ============
        if (!isStageDone(video, 'audio')) {
            video = stageAudio(video);
        }

        // ============ STAGE 3: TRANSCRIBE ============
        if (!isStageDone(video, 'transcribe')) {
            db.updateVideo(videoId, { status: 'transcribing', stage: 'transcribe' });
            video = await stageTranscribe(video);
        }

        // ============ STAGE 4: ANALYZE ============
        if (!isStageDone(video, 'analyze')) {
            db.updateVideo(videoId, { status: 'analyzing', stage: 'analyze' });
            video = await stageAnalyze(video, analysisOptions);
        }

        // ============ STAGE 5: REFINE (exact word boundaries + silence valleys) ============
        if (!isStageDone(video, 'refine')) {
            db.updateVideo(videoId, { status: 'analyzing', stage: 'refine' });
            video = await stageRefine(video, analysisOptions.language);
        }

        // ============ STAGE 6: VISUAL (multimodal verdict, opt-in) ============
        if (!isStageDone(video, 'visual')) {
            db.updateVideo(videoId, { status: 'analyzing', stage: 'visual' });
            video = await stageVisual(video);
        }

        // ============ STAGE 7: CURATE (global ranking → clips in DB) ============
        if (!isStageDone(video, 'curate')) {
            db.updateVideo(videoId, { status: 'analyzing', stage: 'curate' });
            video = await stageCurate(video, channel, analysisOptions.language);
        }

        // ============ STAGE 8: RENDER ============
        db.updateVideo(videoId, { status: 'clipping', stage: 'render' });
        await stageRender(video, channel);

        // ============ DONE ============
        db.updateVideo(videoId, { status: 'done', stage: 'done', processedAt: new Date().toISOString(), errorMessage: undefined });
        db.addLog({ videoId, action: 'complete', status: 'completed' });
        console.log(`[Pipeline] ✅ ${video.title} complete`);
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Pipeline] ❌ Error processing "${video.title}":`, errMsg);
        // stage is preserved → retry resumes from the failed stage, not from zero
        db.updateVideo(videoId, { status: 'error', errorMessage: errMsg.slice(0, 500) });
        db.addLog({ videoId, action: 'error', status: 'error', details: { message: errMsg } });
        throw error;
    }
}

/** A stage is done when its artifact exists on disk (artifact-validated checkpoints) */
function isStageDone(video: Video, stage: 'ingest' | 'audio' | 'transcribe' | 'analyze' | 'refine' | 'visual' | 'curate'): boolean {
    const ytId = video.youtubeVideoId;
    switch (stage) {
        case 'ingest':
            return !!video.localPath && fs.existsSync(video.localPath);
        case 'audio':
            // Audio is deleted after a successful transcription, so a finished
            // transcript also counts as "audio done".
            return fs.existsSync(paths.audio(ytId)) || fs.existsSync(paths.transcript(ytId));
        case 'transcribe':
            return fs.existsSync(paths.transcript(ytId));
        case 'analyze':
            return fs.existsSync(paths.moments(ytId));
        case 'refine':
            return fs.existsSync(paths.refined(ytId)) || isLegacyProcessed(video);
        case 'visual':
            return fs.existsSync(paths.visual(ytId)) || isLegacyProcessed(video);
        case 'curate':
            return (fs.existsSync(paths.curated(ytId)) && db.getClipsByVideo(video.id).length > 0) || isLegacyProcessed(video);
    }
}

/**
 * Videos processed by the v2 pipeline already have clips in the DB but no
 * refined/curated artifacts. Re-running the new stages on them would insert
 * duplicate clips — treat the new stages as done.
 */
function isLegacyProcessed(video: Video): boolean {
    const ytId = video.youtubeVideoId;
    return db.getClipsByVideo(video.id).length > 0
        && !fs.existsSync(paths.refined(ytId))
        && !fs.existsSync(paths.curated(ytId));
}

async function stageIngest(video: Video): Promise<Video> {
    db.addLog({ videoId: video.id, action: 'download', status: 'started' });

    if (video.source === 'local') {
        if (!video.localPath || !fs.existsSync(video.localPath)) {
            throw new Error(`Local file not found: ${video.localPath}`);
        }
        return db.getVideo(video.id)!;
    }

    console.log(`[Pipeline] Downloading: ${video.title}`);
    const { filePath, duration } = downloadVideo(video.url, paths.videosDir(), video.youtubeVideoId);
    db.updateVideo(video.id, { localPath: filePath, duration });
    db.addLog({ videoId: video.id, action: 'download', status: 'completed', details: { duration } });
    return db.getVideo(video.id)!;
}

function stageAudio(video: Video): Video {
    const audioPath = paths.audio(video.youtubeVideoId);
    if (!fs.existsSync(audioPath)) {
        console.log(`[Pipeline] Extracting audio...`);
        extractAudio(video.localPath!, path.join(paths.videosDir(), video.youtubeVideoId));
    }
    ensureSilenceMap(video);
    db.updateVideo(video.id, { audioPath, stage: 'transcribe' });
    return db.getVideo(video.id)!;
}

/**
 * Silence map for surgical cuts. Generated here while the audio is guaranteed
 * on disk; regenerated lazily in REFINE from the source video if missing
 * (legacy videos whose audio was already cleaned up).
 */
function ensureSilenceMap(video: Video): void {
    const ytId = video.youtubeVideoId;
    if (fs.existsSync(paths.silence(ytId))) return;

    const source = fs.existsSync(paths.audio(ytId))
        ? paths.audio(ytId)
        : (video.localPath && fs.existsSync(video.localPath) ? video.localPath : null);
    if (!source) return; // refine degrades to word-timestamp padding

    try {
        console.log(`[Pipeline] Generating silence map...`);
        generateSilenceMap(source, paths.silence(ytId));
    } catch (err) {
        console.warn('[Pipeline] silencedetect failed (refine will degrade to word snapping):', err instanceof Error ? err.message : err);
    }
}

async function stageTranscribe(video: Video): Promise<Video> {
    const ytId = video.youtubeVideoId;
    const transcriptPath = paths.transcript(ytId);
    db.addLog({ videoId: video.id, action: 'transcribe', status: 'started' });

    const transcript = await transcribeAudio(paths.audio(ytId), paths.transcriptChunks(ytId));
    fs.writeFileSync(transcriptPath, JSON.stringify(transcript));

    // Cleanup: chunk checkpoints and audio are no longer needed
    fs.rmSync(paths.transcriptChunks(ytId), { recursive: true, force: true });
    if (fs.existsSync(paths.audio(ytId))) fs.unlinkSync(paths.audio(ytId));

    db.updateVideo(video.id, {
        transcript: transcript.fullText.slice(0, 20000),
        transcriptPath,
        stage: 'analyze',
    });
    db.addLog({ videoId: video.id, action: 'transcribe', status: 'completed', details: { segments: transcript.segments.length, words: transcript.words.length } });
    console.log(`[Pipeline] Transcribed: ${transcript.segments.length} segments, ${transcript.words.length} words`);
    return db.getVideo(video.id)!;
}

function loadTranscript(video: Video): Transcript {
    const p = paths.transcript(video.youtubeVideoId);
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Transcript;
}

async function stageAnalyze(
    video: Video,
    options: { language: string; clipDurationMin: number; clipDurationMax: number; performanceFeedback?: string }
): Promise<Video> {
    db.addLog({ videoId: video.id, action: 'analyze', status: 'started' });
    const transcript = loadTranscript(video);

    const moments = await analyzeTranscript(transcript, options);
    fs.writeFileSync(paths.moments(video.youtubeVideoId), JSON.stringify(moments, null, 2));
    console.log(`[Pipeline] Found ${moments.length} candidate moments`);

    db.updateVideo(video.id, { stage: 'refine' });
    db.addLog({ videoId: video.id, action: 'analyze', status: 'completed', details: { momentCount: moments.length } });
    return db.getVideo(video.id)!;
}

function loadMoments(file: string): MomentCandidate[] {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as MomentCandidate[];
}

async function stageRefine(video: Video, language: string): Promise<Video> {
    const ytId = video.youtubeVideoId;
    const transcript = loadTranscript(video);
    const moments = loadMoments(paths.moments(ytId));

    ensureSilenceMap(video);
    const silenceMap = loadSilenceMap(paths.silence(ytId));
    if (!silenceMap) console.log('[Pipeline] No silence map available — refining on word timestamps only');

    const refined = await refineMoments(moments, transcript, silenceMap, paths.refineChunks(ytId), language);
    fs.writeFileSync(paths.refined(ytId), JSON.stringify(refined, null, 2));
    fs.rmSync(paths.refineChunks(ytId), { recursive: true, force: true });

    db.updateVideo(video.id, { stage: 'visual' });
    return db.getVideo(video.id)!;
}

async function stageVisual(video: Video): Promise<Video> {
    const ytId = video.youtubeVideoId;
    const refined = loadMoments(paths.refined(ytId));
    const sourceAvailable = !!video.localPath && fs.existsSync(video.localPath);

    if (!visualPassEnabled() || !sourceAvailable || refined.length === 0) {
        fs.writeFileSync(paths.visual(ytId), JSON.stringify({ skipped: true }));
        if (visualPassEnabled() && !sourceAvailable) console.log('[Pipeline] Visual pass skipped: source video not on disk');
    } else {
        console.log(`[Pipeline] Visual pass over top candidates...`);
        const transcript = loadTranscript(video);
        const silenceMap = loadSilenceMap(paths.silence(ytId));
        const verified = await runVisualPass(refined, video.localPath!, transcript, silenceMap, paths.visualChunks(ytId));
        fs.writeFileSync(paths.visual(ytId), JSON.stringify({ skipped: false, moments: verified }, null, 2));
        fs.rmSync(paths.visualChunks(ytId), { recursive: true, force: true });
    }

    db.updateVideo(video.id, { stage: 'curate' });
    return db.getVideo(video.id)!;
}

async function stageCurate(video: Video, channel: Channel | undefined, language: string): Promise<Video> {
    const ytId = video.youtubeVideoId;
    const visualData = JSON.parse(fs.readFileSync(paths.visual(ytId), 'utf-8')) as { skipped: boolean; moments?: MomentCandidate[] };
    const moments = visualData.skipped || !visualData.moments ? loadMoments(paths.refined(ytId)) : visualData.moments;
    const transcript = loadTranscript(video);
    const topN = channel?.maxClipsPerVideo ?? DEFAULT_MAX_CLIPS;

    const curated = await curateMoments(moments, transcript, topN, language, channel?.channelName);
    fs.writeFileSync(paths.curated(ytId), JSON.stringify(curated, null, 2));
    console.log(`[Pipeline] Curated: ${curated.length}/${moments.length} clips survive`);

    // Idempotent: only create clips that don't overlap an existing one
    const existing = db.getClipsByVideo(video.id);
    for (const moment of curated) {
        const overlapsExisting = existing.some(c => {
            const overlap = Math.min(moment.endTime, c.endTime) - Math.max(moment.startTime, c.startTime);
            if (overlap <= 0) return false;
            const shorter = Math.min(moment.endTime - moment.startTime, c.endTime - c.startTime);
            return overlap / shorter > 0.5;
        });
        if (overlapsExisting) continue;

        const totalDuration = (moment.segments || [{ start: moment.startTime, end: moment.endTime }])
            .reduce((acc, s) => acc + (s.end - s.start), 0);

        db.addClip({
            videoId: video.id,
            title: moment.title,
            description: moment.description,
            startTime: moment.startTime,
            endTime: moment.endTime,
            duration: totalDuration,
            segments: moment.segments,
            hookTitle: moment.needsContext ? moment.hookTitle : undefined,
            score: moment.score,
            justification: moment.justification,
            status: 'pending',
            hasSubtitles: false,
            metrics: moment.metrics,
            keywords: moment.keywords,
            emoji: moment.emoji,
            visualScore: moment.visualScore,
            visualNotes: moment.visualNotes,
            curationRank: moment.curationRank,
            curationReason: moment.curationReason,
            musicWarning: moment.musicWarning,
            publishPack: moment.publishPack,
            captionStyle: channel?.captionStyle,
        });
    }

    db.updateVideo(video.id, { stage: 'render' });
    db.addLog({ videoId: video.id, action: 'analyze', status: 'completed', details: { curated: curated.length, candidates: moments.length } });
    return db.getVideo(video.id)!;
}

async function stageRender(video: Video, channel?: Channel): Promise<void> {
    const transcript = loadTranscript(video);
    const pendingClips = db.getClipsByVideo(video.id).filter(c => c.status !== 'done');
    if (pendingClips.length === 0) return;

    db.addLog({ videoId: video.id, action: 'clipping', status: 'started', details: { count: pendingClips.length } });
    let success = 0;

    for (const clip of pendingClips) {
        try {
            db.updateClip(clip.id, { status: 'processing' });
            const segments = clip.segments && clip.segments.length > 0
                ? clip.segments
                : [{ start: clip.startTime, end: clip.endTime }];
            console.log(`[Pipeline] Rendering clip: ${clip.title} (${segments.length} segmento(s), ${clip.duration.toFixed(0)}s)`);

            const result = createClip({
                videoPath: video.localPath!,
                clipId: clip.id,
                videoId: video.youtubeVideoId,
                segments,
                words: transcript.words,
                keywords: clip.keywords,
                hookTitle: clip.hookTitle,
                withSubtitles: true,
                bgMusic: clip.backgroundMusic,
                captionStyle: clip.captionStyle,
                emoji: clip.emoji,
                watermarkText: channel?.watermarkText,
            });

            console.log(`[Pipeline] Layout dominante: ${result.layout}`);
            const updated = db.updateClip(clip.id, {
                status: 'done',
                filePath: result.filePath,
                hasSubtitles: result.hasSubtitles,
                predictedLayout: result.layout === 'split' ? 'split_screen' : 'center_crop',
            });
            if (updated) {
                try {
                    writePublishPack(updated, video.youtubeVideoId);
                } catch (err) {
                    console.warn('[Pipeline] Publish pack failed (clip OK):', err instanceof Error ? err.message : err);
                }
            }
            success++;
        } catch (error) {
            console.error(`[Pipeline] Clip render failed (${clip.id}):`, error instanceof Error ? error.message : error);
            db.updateClip(clip.id, { status: 'error' });
        }
    }

    db.addLog({ videoId: video.id, action: 'clipping', status: 'completed', details: { success, total: pendingClips.length } });
}

/**
 * Scan active channels for new videos and enqueue them for processing.
 */
export async function scanChannels(): Promise<Video[]> {
    const { getLatestVideos, twitchUserFromUrl, isTwitchLive } = await import('./youtube-service');
    const channels = db.getAllChannels().filter(c => c.isActive);
    const newVideos: Video[] = [];

    for (const channel of channels) {
        console.log(`[Scanner] Checking channel: ${channel.channelName}`);
        try {
            let latestVideos = getLatestVideos(channel.channelUrl, 5);

            // Twitch: el VOD más reciente de un canal EN DIRECTO aún está creciendo —
            // se salta hasta que el stream termine (o lo capture el modo live)
            const twitchUser = twitchUserFromUrl(channel.channelUrl);
            if (twitchUser && latestVideos.length > 0 && isTwitchLive(twitchUser)) {
                console.log(`[Scanner] ${channel.channelName} está EN DIRECTO — VOD en curso pospuesto`);
                latestVideos = latestVideos.slice(1);
            }

            for (const ytVideo of latestVideos) {
                if (db.getVideoByYoutubeId(ytVideo.id)) continue;
                // Skip shorts and very short videos
                if (ytVideo.duration > 0 && ytVideo.duration < 120) continue;
                // Solo contenido publicado DESDE el día de alta del canal: dar de alta
                // un canal con historial no debe encolar horas de VODs antiguos
                // (upload_date solo tiene día → se compara contra el día del alta)
                if (ytVideo.upload_date && formatYtDate(ytVideo.upload_date) < channel.createdAt.slice(0, 10)) continue;

                const video = db.addVideo({
                    channelId: channel.id,
                    youtubeVideoId: ytVideo.id,
                    title: ytVideo.title,
                    url: ytVideo.webpage_url,
                    source: 'youtube',
                    thumbnailUrl: ytVideo.thumbnail,
                    duration: ytVideo.duration,
                    status: 'pending',
                    publishedAt: ytVideo.upload_date ? formatYtDate(ytVideo.upload_date) : undefined,
                });

                db.enqueueProcessVideo(video.id);
                newVideos.push(video);
                console.log(`[Scanner] New video queued: ${ytVideo.title}`);
            }
        } catch (error) {
            console.error(`[Scanner] Error scanning ${channel.channelName}:`, error);
            db.addLog({ action: 'scan', status: 'error', details: { channel: channel.channelName, error: String(error) } });
        }
    }

    return newVideos;
}

function formatYtDate(dateStr: string): string {
    if (dateStr.length === 8) {
        return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T00:00:00Z`;
    }
    return dateStr;
}
