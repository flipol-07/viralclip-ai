/**
 * YouTube/Twitch Service - Channel info, video discovery & download using yt-dlp
 */
import { execSync, execFileSync } from 'child_process';
import path from 'path';

/** Twitch user from a twitch.tv URL, or null if it's not a Twitch URL */
export function twitchUserFromUrl(url: string): string | null {
    const m = url.match(/twitch\.tv\/([A-Za-z0-9_]+)/i);
    return m ? m[1] : null;
}

/** True if the Twitch channel is live right now (yt-dlp resolves twitch.tv/<user> only mid-stream) */
export function isTwitchLive(user: string): boolean {
    try {
        const out = execFileSync('yt-dlp', ['--no-warnings', '--print', 'is_live', `https://www.twitch.tv/${user}`], {
            encoding: 'utf-8',
            timeout: 30000,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return out.trim().toLowerCase().startsWith('true');
    } catch {
        return false;
    }
}

/** VOD listing URL for a channel (Twitch archives or YouTube /videos tab) */
function channelVideosUrl(channelUrl: string): string {
    const url = channelUrl.trim();
    const twitchUser = twitchUserFromUrl(url);
    if (twitchUser) {
        return `https://www.twitch.tv/${twitchUser}/videos?filter=archives&sort=time`;
    }
    let normalized = url.startsWith('http') ? url : `https://www.youtube.com/${url}`;
    if (!normalized.includes('/videos')) {
        normalized = normalized.replace(/\/?$/, '/videos');
    }
    return normalized;
}

interface YtDlpVideoInfo {
    id: string;
    title: string;
    webpage_url: string;
    thumbnail: string;
    duration: number;
    upload_date: string;
    channel_id: string;
    channel: string;
    channel_url: string;
}

/**
 * Extract channel info from a YouTube URL
 */
export function getChannelInfo(channelUrl: string): {
    channelId: string;
    channelName: string;
    thumbnailUrl?: string;
} {
    const twitchUser = twitchUserFromUrl(channelUrl);
    try {
        const url = twitchUser ? channelVideosUrl(channelUrl) : (
            channelUrl.trim().startsWith('http') ? channelUrl.trim() : `https://www.youtube.com/${channelUrl.trim()}`
        );

        const result = execSync(
            `yt-dlp --dump-json --playlist-items 1 --flat-playlist "${url}" 2>/dev/null | head -1`,
            { encoding: 'utf-8', timeout: 30000 }
        );

        const info = JSON.parse(result);
        return {
            channelId: info.channel_id || info.uploader_id || (twitchUser ? `twitch:${twitchUser}` : url),
            channelName: info.channel || info.uploader || twitchUser || 'Unknown Channel',
            thumbnailUrl: info.thumbnail,
        };
    } catch {
        // Fallback: derive from the URL (twitch.tv/user, /channel/ID or @handle)
        if (twitchUser) {
            return { channelId: `twitch:${twitchUser}`, channelName: twitchUser };
        }
        const match = channelUrl.match(/(?:channel\/|@)([\w-]+)/);
        return {
            channelId: match ? match[1] : channelUrl,
            channelName: match ? match[1] : 'Unknown Channel',
        };
    }
}

/**
 * Get latest videos from a YouTube channel
 */
export function getLatestVideos(channelUrl: string, limit: number = 5): YtDlpVideoInfo[] {
    try {
        const url = channelVideosUrl(channelUrl);

        const result = execSync(
            `yt-dlp --dump-json --playlist-items 1-${limit} --flat-playlist --no-warnings "${url}" 2>/dev/null`,
            { encoding: 'utf-8', timeout: 60000 }
        );

        const videos: YtDlpVideoInfo[] = result
            .trim()
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
                const parsed = JSON.parse(line);
                return {
                    id: parsed.id,
                    title: parsed.title || 'Untitled',
                    webpage_url: parsed.webpage_url || parsed.url || `https://www.youtube.com/watch?v=${parsed.id}`,
                    thumbnail: parsed.thumbnail || parsed.thumbnails?.[0]?.url || '',
                    duration: parsed.duration || 0,
                    upload_date: parsed.upload_date || '',
                    channel_id: parsed.channel_id || '',
                    channel: parsed.channel || parsed.uploader || '',
                    channel_url: parsed.channel_url || channelUrl,
                };
            });

        return videos;
    } catch (error) {
        console.error('Error fetching latest videos:', error);
        return [];
    }
}

/**
 * Download a YouTube video
 */
export function downloadVideo(
    videoUrl: string,
    outputDir: string,
    videoId: string
): { filePath: string; duration: number } {
    const outputPath = `${outputDir}/${videoId}.mp4`;

    try {
        // Full video at up to 1080p, h264 preferred (fastest CPU decode for the renders).
        // No [ext=mp4] filter: YouTube only serves >360p via DASH (vp9/av1/avc1 separadas).
        // --continue resumes partial downloads; -N 4 acelera HLS (VODs de Twitch).
        execSync(
            `yt-dlp -f "bestvideo[height<=1080][vcodec^=avc1]+bestaudio/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best" ` +
            `--merge-output-format mp4 ` +
            `-o "${outputPath}" ` +
            `--continue ` +
            `--no-playlist ` +
            `--no-progress ` +
            `--concurrent-fragments 4 ` +
            `"${videoUrl}" 2>&1`,
            { encoding: 'utf-8', timeout: 5400000 } // up to 1.5h for long 1080p downloads
        );

        // Get duration
        const durationStr = execSync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}" 2>/dev/null`,
            { encoding: 'utf-8', timeout: 10000 }
        ).trim();

        return {
            filePath: outputPath,
            duration: Math.round(parseFloat(durationStr) || 0),
        };
    } catch (error) {
        console.error('Error downloading video:', error);
        throw new Error(`Failed to download video: ${videoUrl}`);
    }
}

/**
 * Extract audio from video for transcription
 */
export function extractAudio(videoPath: string, outputPath: string): string {
    const audioPath = outputPath.includes('.')
        ? outputPath.replace(/\.[^.]+$/, '_audio.mp3')
        : `${outputPath}_audio.mp3`;

    try {
        execSync(
            `ffmpeg -y -hide_banner -loglevel error -i "${videoPath}" -vn -acodec libmp3lame -ar 16000 -ac 1 -q:a 4 "${audioPath}"`,
            { encoding: 'utf-8', timeout: 300000 }
        );
        return audioPath;
    } catch (error) {
        console.error('Error extracting audio:', error);
        throw new Error('Failed to extract audio');
    }
}
import { google } from 'googleapis';
import fs from 'fs';

/**
 * Upload a video to YouTube as a Short
 */
export async function uploadShortToYouTube(options: {
    videoPath: string;
    title: string;
    description: string;
    tags?: string[];
}): Promise<{ success: boolean; videoId?: string; error?: string }> {
    const { videoPath, title, description, tags = [] } = options;

    try {
        // 1. Check for credentials
        const secretPath = path.join(process.cwd(), 'client_secret.json');
        const tokenPath = path.join(process.cwd(), 'token.json');

        if (!fs.existsSync(secretPath)) {
            return { success: false, error: 'Missing client_secret.json in root. Please get it from Google Cloud Console.' };
        }

        if (!fs.existsSync(tokenPath)) {
            return { success: false, error: 'Missing token.json. Run the auth flow first.' };
        }

        const credentials = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0] ?? 'http://localhost:8089');
        oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(tokenPath, 'utf8')));
        // Persist refreshed access tokens so token.json never goes stale
        oAuth2Client.on('tokens', (tokens) => {
            try {
                const current = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
                fs.writeFileSync(tokenPath, JSON.stringify({ ...current, ...tokens }, null, 2));
            } catch { /* best-effort */ }
        });

        const youtube = google.youtube({ version: 'v3', auth: oAuth2Client });

        const response = await youtube.videos.insert({
            part: ['snippet', 'status'],
            requestBody: {
                snippet: {
                    title: title.slice(0, 100), // YT limit
                    description: `${description}\n\n#shorts #viral #clip`,
                    tags: [...tags, 'shorts', 'viral'],
                    categoryId: '24', // Entertainment
                },
                status: {
                    privacyStatus: 'public', // Set to public for auto-post
                    selfDeclaredMadeForKids: false,
                },
            },
            media: {
                body: fs.createReadStream(videoPath),
            },
        });

        return { success: true, videoId: response.data.id || undefined };
    } catch (error) {
        console.error('Error uploading to YouTube:', error);
        return { success: false, error: String(error) };
    }
}

/**
 * Fetch statistics for a list of YouTube video IDs
 */
export async function syncVideoAnalytics(videoIds: string[]): Promise<Map<string, { views: number, likes: number, comments: number }>> {
    const statsMap = new Map();
    if (videoIds.length === 0) return statsMap;

    try {
        const secretPath = path.join(process.cwd(), 'client_secret.json');
        const tokenPath = path.join(process.cwd(), 'token.json');

        if (!fs.existsSync(secretPath) || !fs.existsSync(tokenPath)) return statsMap;

        const credentials = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
        oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(tokenPath, 'utf8')));

        const youtube = google.youtube({ version: 'v3', auth: oAuth2Client });

        // Process in chunks of 50 (API limit)
        for (let i = 0; i < videoIds.length; i += 50) {
            const chunk = videoIds.slice(i, i + 50);
            const response = await youtube.videos.list({
                part: ['statistics'],
                id: chunk
            });

            response.data.items?.forEach(item => {
                if (item.id && item.statistics) {
                    statsMap.set(item.id, {
                        views: parseInt(item.statistics.viewCount || '0'),
                        likes: parseInt(item.statistics.likeCount || '0'),
                        comments: parseInt(item.statistics.commentCount || '0')
                    });
                }
            });
        }
    } catch (error) {
        console.error('Error syncing analytics:', error);
    }

    return statsMap;
}
