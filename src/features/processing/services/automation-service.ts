/**
 * Automation Service — channel scanning + analytics feedback loop.
 * Discovery only: it enqueues jobs; the standalone worker does the processing.
 */
import * as db from '@/shared/lib/local-db';
import { syncVideoAnalytics } from './youtube-service';
import { scanChannels } from './pipeline';
import OpenAI from 'openai';

/**
 * Check all active channels for new videos and enqueue them for the worker.
 */
export async function checkNewContent(): Promise<{
    channelsChecked: number;
    newVideosFound: number;
}> {
    const channels = db.getAllChannels().filter(c => c.isActive);
    const newVideos = await scanChannels();

    // Best-effort: analytics feedback for future analysis prompts
    try {
        await syncAnalytics();
    } catch (err) {
        console.error('[Automation] Analytics sync failed:', err);
    }

    return {
        channelsChecked: channels.length,
        newVideosFound: newVideos.length,
    };
}

/**
 * Sync YouTube analytics for uploaded clips and refresh per-channel feedback.
 */
export async function syncAnalytics() {
    const allClips = db.getAllClips().filter(c => c.youtubeShortId);
    if (allClips.length === 0) return;

    const shortIds = allClips.map(c => c.youtubeShortId!);
    const stats = await syncVideoAnalytics(shortIds);

    for (const clip of allClips) {
        const clipStats = stats.get(clip.youtubeShortId!);
        if (clipStats) {
            db.updateClip(clip.id, {
                analytics: { ...clipStats, lastUpdated: new Date().toISOString() },
            });
        }
    }

    await updateAllChannelsFeedback();
}

async function updateAllChannelsFeedback() {
    const channels = db.getAllChannels();
    for (const channel of channels) {
        const channelClips = db.getAllClips().filter(c => {
            const video = db.getVideo(c.videoId);
            return video?.channelId === channel.id && c.analytics;
        });

        if (channelClips.length >= 3) {
            const performanceData = channelClips.map(c => ({
                title: c.title,
                views: c.analytics!.views,
                likes: c.analytics!.likes,
                score: c.score,
            }));

            const feedback = await generateFeedbackFromPerformance(channel.channelName, performanceData);
            if (feedback) db.updateChannel(channel.id, { performanceFeedback: feedback });
        }
    }
}

async function generateFeedbackFromPerformance(
    channelName: string,
    data: { title: string; views: number; likes: number; score: number }[]
): Promise<string> {
    try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
                role: 'system',
                content: 'You are a social media growth expert. Analyze the performance data of YouTube Shorts and provide 2-sentence feedback on what topics or styles are working best. Be specific.',
            }, {
                role: 'user',
                content: `Channel: ${channelName}\nData: ${JSON.stringify(data)}`,
            }],
        });
        return response.choices[0]?.message?.content || '';
    } catch (err) {
        console.error('[Automation] Feedback generation error:', err);
        return '';
    }
}
