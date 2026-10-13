'use client';

import { useAppStore } from '@/shared/stores/app-store';
import {
    LayoutDashboard,
    Radio,
    Video,
    Film,
    Zap,
} from 'lucide-react';

const navItems = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'channels' as const, label: 'Canales', icon: Radio },
    { id: 'videos' as const, label: 'Vídeos', icon: Video },
    { id: 'clips' as const, label: 'Clips', icon: Film },
];

export function Sidebar() {
    const { currentView, setView, stats, workerStatus } = useAppStore();
    const workerAlive = workerStatus?.workerAlive ?? false;
    const queued = workerStatus?.queued ?? 0;
    const runningTitle = workerStatus?.running?.[0]?.video?.title;

    return (
        <aside className="sidebar">
            {/* Logo */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '8px',
                padding: '0 8px'
            }}>
                <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '12px',
                    background: 'var(--accent-gradient)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    boxShadow: '0 4px 10px -2px rgba(220, 38, 38, 0.4)',
                }}>
                    <Zap size={22} color="white" fill="white" />
                </div>
                <div className="sidebar-label">
                    <h1 style={{ fontSize: '18px', fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.02em' }}>
                        ViralClip
                    </h1>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>
                        AI Clip Generator
                    </p>
                </div>
            </div>

            <div style={{ height: '1px', background: 'var(--border)', margin: '16px 0' }} />

            {/* Navigation */}
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {navItems.map(item => (
                    <button
                        key={item.id}
                        className={`nav-item ${currentView === item.id ? 'active' : ''}`}
                        onClick={() => setView(item.id)}
                    >
                        <item.icon size={19} />
                        <span>{item.label}</span>
                        {item.id === 'clips' && stats.totalClips > 0 && (
                            <span style={{
                                marginLeft: 'auto',
                                fontSize: '11px',
                                fontWeight: 700,
                                background: currentView === 'clips' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                                color: currentView === 'clips' ? '#fff' : 'var(--text-secondary)',
                                padding: '2px 9px',
                                borderRadius: '999px',
                            }}>
                                {stats.totalClips}
                            </span>
                        )}
                        {item.id === 'videos' && stats.processingVideos > 0 && (
                            <span style={{
                                marginLeft: 'auto',
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                background: 'var(--accent-primary)',
                            }} className="animate-pulse-glow" />
                        )}
                    </button>
                ))}
            </nav>

            <div style={{ height: '1px', background: 'var(--border)', margin: '16px 0' }} />

            {/* Quick stats */}
            <div className="sidebar-label" style={{ padding: '0 4px' }}>
                <div style={{
                    padding: '14px 16px',
                    borderRadius: '12px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                }}>
                    <div style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'var(--text-muted)',
                        marginBottom: '10px',
                    }}>
                        Estado
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Canales</span>
                            <span style={{ fontWeight: 700 }}>{stats.totalChannels}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Vídeos</span>
                            <span style={{ fontWeight: 700 }}>{stats.totalVideos}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Clips</span>
                            <span style={{ fontWeight: 700, color: 'var(--success)' }}>{stats.totalClips}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Worker status pinned at the bottom */}
            <div className="sidebar-label" style={{ marginTop: 'auto', paddingTop: '16px' }}>
                <div
                    className={`worker-pill ${workerAlive ? 'alive' : 'dead'}`}
                    title={workerAlive
                        ? (runningTitle ? `Procesando: ${runningTitle}` : 'El worker está escuchando la cola')
                        : 'Arranca el worker con: npm run worker'}
                >
                    <span className="dot" />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {workerAlive
                            ? (queued > 0 || runningTitle ? `Worker activo · ${queued + (runningTitle ? 1 : 0)} en cola` : 'Worker activo')
                            : 'Worker parado'}
                    </span>
                </div>
                {!workerAlive && (
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', lineHeight: 1.5, padding: '0 2px' }}>
                        Ejecuta <code style={{ background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: '4px', fontSize: '10px' }}>npm run worker</code> para procesar la cola
                    </p>
                )}
            </div>
        </aside>
    );
}
