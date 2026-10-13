// ViralClip AI - Core Types

export interface Channel {
    id: string;
    youtubeChannelId: string;
    channelName: string;
    channelUrl: string;
    thumbnailUrl?: string;
    language: string;
    clipDurationMin: number;
    clipDurationMax: number;
    isActive: boolean;
    autoUpload?: boolean;
    niche?: string;
    performanceFeedback?: string; // Cumulative feedback for AI
    successPatterns?: string[]; // Successful topics/styles
    captionStyle?: CaptionStyleId;
    /** Curation cap: max clips kept per video (default 9) */
    maxClipsPerVideo?: number;
    /** Own brand handle burned subtly on every clip (e.g. "@misclips"). Empty = off */
    watermarkText?: string;
    createdAt: string;
    updatedAt: string;
}

export type VideoStatus = 'pending' | 'downloading' | 'transcribing' | 'analyzing' | 'clipping' | 'done' | 'error';

/** Pipeline checkpoint stages — a video resumes from its last completed stage */
export type PipelineStage = 'ingest' | 'audio' | 'transcribe' | 'analyze' | 'refine' | 'visual' | 'curate' | 'render' | 'done';

/** Burned-in caption template */
export type CaptionStyleId = 'current' | 'hormozi' | 'clean';

export interface Video {
    id: string;
    channelId: string;
    youtubeVideoId: string;
    title: string;
    url: string;
    source?: 'youtube' | 'local';
    thumbnailUrl?: string;
    duration?: number; // seconds
    status: VideoStatus;
    stage?: PipelineStage;
    errorMessage?: string;
    transcript?: string;
    localPath?: string;
    audioPath?: string;
    transcriptPath?: string;
    publishedAt?: string;
    createdAt: string;
    processedAt?: string;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export interface Job {
    id: string;
    type: 'process_video';
    videoId?: string;
    status: JobStatus;
    attempts: number;
    /** Higher = processed first ("modo evento": clips frescos valen oro) */
    priority?: number;
    lastError?: string;
    heartbeatAt?: string;
    createdAt: string;
    updatedAt: string;
}

export type ClipStatus = 'pending' | 'processing' | 'done' | 'error';

/** A contiguous source-time range. Clips can stitch several (skipping dead time). */
export interface ClipSegment {
    start: number;
    end: number;
}

/** Ready-to-paste publish copy for one platform */
export interface PlatformCopy {
    /** YouTube: video title (≤100 chars). TikTok/IG: unused */
    title?: string;
    /** Caption/description body, hook first (first 125 chars carry the keyword) */
    caption: string;
    /** 3-5 hashtags without '#' */
    hashtags: string[];
}

/** Per-platform metadata generated at CURATE so manual upload takes ~2 min */
export interface PublishPack {
    youtube: PlatformCopy;
    tiktok: PlatformCopy;
    instagram: PlatformCopy;
}

export interface Clip {
    id: string;
    videoId: string;
    title: string;
    description?: string;
    startTime: number;
    endTime: number;
    duration: number;
    /** Multi-cut clips: 2+ ranges stitched together. Absent/1 = simple clip. */
    segments?: ClipSegment[];
    /** 4-7 word context title burned at the top when the clip needs context */
    hookTitle?: string;
    score: number;
    justification?: string;
    filePath?: string;
    status: ClipStatus;
    hasSubtitles: boolean;
    predictedLayout?: 'split_screen' | 'center_crop';
    focusPosition?: 'left' | 'center' | 'right';
    backgroundMusic?: string;
    metrics?: {
        hook: number;
        flow: number;
        payoff: number;
    };
    keywords?: string[];
    captionStyle?: CaptionStyleId;
    /** 0-100 from the multimodal visual pass (laughter, gestures, action) */
    visualScore?: number;
    visualNotes?: string;
    /** 0-1 emoji that amplifies the moment, rendered in captions when enabled */
    emoji?: string;
    /** Position after global curation (1 = best of the video) */
    curationRank?: number;
    curationReason?: string;
    /** Prominent background music detected (Content ID risk — don't upload to YT) */
    musicWarning?: boolean;
    /** Per-platform copy ready to paste when uploading manually */
    publishPack?: PublishPack;
    youtubeShortId?: string;
    analytics?: {
        views: number;
        likes: number;
        comments: number;
        lastUpdated: string;
    };
    createdAt: string;
}

export interface ProcessingLog {
    id: string;
    videoId?: string;
    action: string;
    status: 'started' | 'completed' | 'error';
    details?: Record<string, unknown>;
    createdAt: string;
}

export interface Database {
    channels: Channel[];
    videos: Video[];
    clips: Clip[];
    logs: ProcessingLog[];
}

// AI Analysis types
export interface MomentCandidate {
    startTime: number;
    endTime: number;
    /** Optional multi-cut: 1-3 chronological ranges stitched together to skip dead time */
    segments?: ClipSegment[];
    title: string;
    description: string;
    /** 4-7 word context overlay, burned only when needsContext */
    hookTitle?: string;
    needsContext?: boolean;
    score: number;
    justification: string;
    type: 'emotional' | 'funny' | 'insight' | 'tension' | 'viral';
    predictedLayout?: 'split_screen' | 'center_crop';
    focusPosition?: 'left' | 'center' | 'right';
    metrics?: {
        hook: number;
        flow: number;
        payoff: number;
    };
    keywords?: string[];
    /** 0-1 emoji that amplifies the moment, or undefined */
    emoji?: string;
    /** Filled by the visual pass */
    visualScore?: number;
    visualNotes?: string;
    /** How the boundaries were last adjusted */
    refinedBy?: 'llm' | 'snap';
    curationRank?: number;
    curationReason?: string;
    /** Prominent background music detected by the visual pass (Content ID risk) */
    musicWarning?: boolean;
    /** Per-platform copy generated at CURATE */
    publishPack?: PublishPack;
}

/** ffmpeg silencedetect output for a video, generated once in the AUDIO stage */
export interface SilenceMap {
    noiseDb: number;
    minDur: number;
    silences: { start: number; end: number }[];
}

/** Multimodal verdict on a candidate clip from the visual pass */
export interface VisualVerdict {
    worksVisually: boolean;
    visualScore: number;
    notes: string;
    /** First second doesn't grab visually (e.g. back turned, static wide shot) */
    badOpening?: boolean;
    /** Suggested start adjustment in seconds (±3 max), applied then re-snapped */
    suggestedStartShift?: number;
    /** Prominent background music heard in the proxy (Content ID risk) */
    musicProminent?: boolean;
}

export interface TranscriptSegment {
    start: number;
    end: number;
    text: string;
}

export interface TranscriptWord {
    start: number;
    end: number;
    word: string;
}

export interface Transcript {
    fullText: string;
    segments: TranscriptSegment[];
    words: TranscriptWord[];
}

/** One time window of a clip with its own layout (scene/speaker aware) */
export interface RenderUnit {
    /** Window bounds in seconds, relative to the analyzed range start */
    t0: number;
    t1: number;
    layout: 'track' | 'split' | 'center';
    /** layout=track: crop-x keyframes within the window (times relative to range start) */
    track?: { t: number; x: number }[];
    /** layout=split: static crop x for each speaker half */
    split?: { topX: number; bottomX: number; halfCropW: number; halfCropH: number };
}

/** Render plan produced by scripts/reframe.py for smart 9:16 reframing */
export interface RenderPlan {
    width: number;
    height: number;
    cropW: number;
    cropH: number;
    units: RenderUnit[];
}

export interface ChannelFormData {
    channelUrl: string;
    language: string;
    clipDurationMin: number;
    clipDurationMax: number;
    captionStyle?: CaptionStyleId;
    maxClipsPerVideo?: number;
    watermarkText?: string;
}

// API Response types
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
}

export interface ProcessingProgress {
    videoId: string;
    status: VideoStatus;
    step: string;
    progress: number; // 0-100
    message: string;
}
