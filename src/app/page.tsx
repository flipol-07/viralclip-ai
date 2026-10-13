'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/shared/stores/app-store';
import { Sidebar } from '@/features/dashboard/components/sidebar';
import { DashboardView } from '@/features/dashboard/components/dashboard-view';
import { ChannelsView } from '@/features/channels/components/channels-view';
import { VideosView } from '@/features/videos/components/videos-view';
import { ClipsView } from '@/features/clips/components/clips-view';
import { AddChannelModal } from '@/features/channels/components/add-channel-modal';
import { Toast } from '@/features/dashboard/components/toast';

export default function Home() {
  const { currentView, fetchAll, toast, showAddChannel } = useAppStore();

  useEffect(() => {
    fetchAll();
    // Poll every 10 seconds when processing
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main className="main-content">
        {currentView === 'dashboard' && <DashboardView />}
        {currentView === 'channels' && <ChannelsView />}
        {currentView === 'videos' && <VideosView />}
        {currentView === 'clips' && <ClipsView />}
      </main>
      {showAddChannel && <AddChannelModal />}
      {toast.visible && <Toast />}
    </div>
  );
}
