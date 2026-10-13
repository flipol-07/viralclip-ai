/**
 * App Store - Global state management with Zustand
 */
import { create } from 'zustand';
import type { Channel, Video, Clip, ProcessingLog } from '@/shared/types';

interface Stats {
    totalChannels: number;
    totalVideos: number;
    processedVideos: number;
    pendingVideos: number;
    errorVideos: number;
    totalClips: number;
    processingVideos: number;
    activeJobs?: number;
}

interface WorkerStatus {
    workerAlive: boolean;
    lastSeen: string | null;
    queued: number;
    running: { videoId?: string; video?: Video | null; attempts: number }[];
}

type ViewType = 'dashboard' | 'channels' | 'videos' | 'clips';

interface ToastState {
    message: string;
    type: 'success' | 'error';
    visible: boolean;
}

interface AppState {
    // Navigation
    currentView: ViewType;
    setView: (view: ViewType) => void;

    // Data
    channels: Channel[];
    videos: (Video & { channelName?: string })[];
    clips: (Clip & { videoTitle?: string })[];
    stats: Stats;
    recentLogs: ProcessingLog[];
    workerStatus: WorkerStatus | null;

    // UI state
    loading: boolean;
    toast: ToastState;
    showAddChannel: boolean;

    // Actions
    setLoading: (loading: boolean) => void;
    showToast: (message: string, type: 'success' | 'error') => void;
    hideToast: () => void;
    setShowAddChannel: (show: boolean) => void;

    // Data fetching
    fetchChannels: () => Promise<void>;
    fetchVideos: () => Promise<void>;
    fetchClips: () => Promise<void>;
    fetchStats: () => Promise<void>;
    fetchWorkerStatus: () => Promise<void>;
    fetchAll: () => Promise<void>;
    importLocalVideo: (filePath: string, title?: string, eventPriority?: boolean) => Promise<boolean>;

    // Actions
    addChannel: (channelUrl: string, language: string, durationMin: number, durationMax: number, options?: { captionStyle?: string; maxClipsPerVideo?: number; watermarkText?: string }) => Promise<void>;
    deleteChannel: (id: string) => Promise<void>;
    scanChannels: () => Promise<void>;
    processVideo: (videoId: string) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
    // Navigation
    currentView: 'dashboard',
    setView: (view) => set({ currentView: view }),

    // Data
    channels: [],
    videos: [],
    clips: [],
    stats: {
        totalChannels: 0,
        totalVideos: 0,
        processedVideos: 0,
        pendingVideos: 0,
        errorVideos: 0,
        totalClips: 0,
        processingVideos: 0,
    },
    recentLogs: [],
    workerStatus: null,

    // UI state
    loading: false,
    toast: { message: '', type: 'success', visible: false },
    showAddChannel: false,

    // UI Actions
    setLoading: (loading) => set({ loading }),
    showToast: (message, type) => {
        set({ toast: { message, type, visible: true } });
        setTimeout(() => get().hideToast(), 4000);
    },
    hideToast: () => set({ toast: { message: '', type: 'success', visible: false } }),
    setShowAddChannel: (show) => set({ showAddChannel: show }),

    // Data fetching
    fetchChannels: async () => {
        try {
            const res = await fetch('/api/channels');
            const json = await res.json();
            if (json.success) set({ channels: json.data });
        } catch (e) { console.error('fetchChannels error:', e); }
    },

    fetchVideos: async () => {
        try {
            const res = await fetch('/api/videos');
            const json = await res.json();
            if (json.success) set({ videos: json.data });
        } catch (e) { console.error('fetchVideos error:', e); }
    },

    fetchClips: async () => {
        try {
            const res = await fetch('/api/clips');
            const json = await res.json();
            if (json.success) set({ clips: json.data });
        } catch (e) { console.error('fetchClips error:', e); }
    },

    fetchStats: async () => {
        try {
            const res = await fetch('/api/stats');
            const json = await res.json();
            if (json.success) {
                set({ stats: json.data.stats, recentLogs: json.data.recentLogs });
            }
        } catch (e) { console.error('fetchStats error:', e); }
    },

    fetchWorkerStatus: async () => {
        try {
            const res = await fetch('/api/worker/status');
            const json = await res.json();
            if (json.success) set({ workerStatus: json.data });
        } catch (e) { console.error('fetchWorkerStatus error:', e); }
    },

    fetchAll: async () => {
        await Promise.all([
            get().fetchChannels(),
            get().fetchVideos(),
            get().fetchClips(),
            get().fetchStats(),
            get().fetchWorkerStatus(),
        ]);
    },

    importLocalVideo: async (filePath, title, eventPriority) => {
        set({ loading: true });
        try {
            const res = await fetch('/api/videos/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath, title, eventPriority }),
            });
            const json = await res.json();
            if (json.success) {
                get().showToast('📥 Vídeo importado y encolado', 'success');
                await get().fetchAll();
                return true;
            }
            get().showToast(`❌ ${json.error}`, 'error');
            return false;
        } catch {
            get().showToast('❌ Error al importar el vídeo', 'error');
            return false;
        } finally {
            set({ loading: false });
        }
    },

    // Channel actions
    addChannel: async (channelUrl, language, durationMin, durationMax, options) => {
        set({ loading: true });
        try {
            const res = await fetch('/api/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    channelUrl,
                    language,
                    clipDurationMin: durationMin,
                    clipDurationMax: durationMax,
                    captionStyle: options?.captionStyle,
                    maxClipsPerVideo: options?.maxClipsPerVideo,
                    watermarkText: options?.watermarkText,
                }),
            });
            const json = await res.json();
            if (json.success) {
                get().showToast(`✅ Canal añadido: ${json.data.channelName}`, 'success');
                await get().fetchChannels();
                set({ showAddChannel: false });
            } else {
                get().showToast(`❌ ${json.error}`, 'error');
            }
        } catch {
            get().showToast('❌ Error al añadir canal', 'error');
        } finally {
            set({ loading: false });
        }
    },

    deleteChannel: async (id) => {
        try {
            const res = await fetch(`/api/channels/${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (json.success) {
                get().showToast('🗑️ Canal eliminado', 'success');
                await get().fetchAll();
            }
        } catch {
            get().showToast('❌ Error al eliminar canal', 'error');
        }
    },

    scanChannels: async () => {
        set({ loading: true });
        try {
            const res = await fetch('/api/scan', { method: 'POST' });
            const json = await res.json();
            if (json.success) {
                const count = json.data.newVideosFound;
                get().showToast(
                    count > 0 ? `🔍 ${count} vídeos nuevos encontrados` : '🔍 No hay vídeos nuevos',
                    'success'
                );
                await get().fetchAll();
            }
        } catch {
            get().showToast('❌ Error escaneando canales', 'error');
        } finally {
            set({ loading: false });
        }
    },

    processVideo: async (videoId) => {
        try {
            const res = await fetch(`/api/process/${videoId}`, { method: 'POST' });
            const json = await res.json();
            if (json.success) {
                get().showToast('🚀 Procesamiento iniciado', 'success');
                await get().fetchVideos();
                // Poll for updates
                const poll = setInterval(async () => {
                    await get().fetchAll();
                    const video = get().videos.find(v => v.id === videoId);
                    if (video && ['done', 'error'].includes(video.status)) {
                        clearInterval(poll);
                        if (video.status === 'done') {
                            get().showToast('✅ ¡Clips generados!', 'success');
                        } else {
                            get().showToast(`❌ Error: ${video.errorMessage}`, 'error');
                        }
                    }
                }, 5000);
            } else {
                get().showToast(`❌ ${json.error}`, 'error');
            }
        } catch {
            get().showToast('❌ Error al procesar vídeo', 'error');
        }
    },
}));
