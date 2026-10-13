'use client';

import { useAppStore } from '@/shared/stores/app-store';
import {
    Radio,
    Video,
    Film,
    AlertCircle,
    Clock,
    CheckCircle2,
    TrendingUp,
    Loader2,
    Search,
} from 'lucide-react';

export function DashboardView() {
    const { stats, recentLogs, scanChannels, loading, setView } = useAppStore();

    return (
        <div className="animate-fade-in">
            {/* Header */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '32px',
            }}>
                <div>
                    <h1 style={{ fontSize: '28px', fontWeight: 800 }}>
                        <span className="gradient-text">Dashboard</span>
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '4px', fontSize: '14px' }}>
                        Vista general de tu fábrica de clips virales
                    </p>
                </div>
                <button
                    className="btn-primary"
                    onClick={scanChannels}
                    disabled={loading}
                >
                    {loading ? <Loader2 size={18} className="spinner" /> : <Search size={18} />}
                    Escanear Canales
                </button>
            </div>

            {/* Stats Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                marginBottom: '32px',
            }}>
                <StatCard
                    icon={<Radio size={22} />}
                    value={stats.totalChannels}
                    label="Canales Activos"
                    color="#6366f1"
                    onClick={() => setView('channels')}
                />
                <StatCard
                    icon={<Video size={22} />}
                    value={stats.totalVideos}
                    label="Vídeos Detectados"
                    color="#8b5cf6"
                    onClick={() => setView('videos')}
                />
                <StatCard
                    icon={<Film size={22} />}
                    value={stats.totalClips}
                    label="Clips Generados"
                    color="#22c55e"
                    onClick={() => setView('clips')}
                />
                <StatCard
                    icon={<Clock size={22} />}
                    value={stats.pendingVideos}
                    label="Pendientes"
                    color="#f59e0b"
                    onClick={() => setView('videos')}
                />
                <StatCard
                    icon={<TrendingUp size={22} />}
                    value={stats.processingVideos}
                    label="En Proceso"
                    color="#3b82f6"
                    onClick={() => setView('videos')}
                />
                <StatCard
                    icon={<AlertCircle size={22} />}
                    value={stats.errorVideos}
                    label="Errores"
                    color="#ef4444"
                    onClick={() => setView('videos')}
                />
            </div>

            {/* Recent Activity */}
            <div className="glass-card" style={{ padding: '24px' }}>
                <h2 style={{
                    fontSize: '18px',
                    fontWeight: 700,
                    marginBottom: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                }}>
                    <Clock size={20} style={{ color: 'var(--accent-primary)' }} />
                    Actividad Reciente
                </h2>

                {recentLogs.length === 0 ? (
                    <div className="empty-state" style={{ padding: '30px' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
                            No hay actividad reciente. Añade un canal y escanea para empezar.
                        </p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {recentLogs.slice(0, 15).map(log => (
                            <div
                                key={log.id}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    padding: '10px 14px',
                                    borderRadius: '10px',
                                    background: 'var(--bg-primary)',
                                    fontSize: '13px',
                                }}
                            >
                                {log.status === 'completed' && <CheckCircle2 size={16} style={{ color: 'var(--success)', flexShrink: 0 }} />}
                                {log.status === 'error' && <AlertCircle size={16} style={{ color: 'var(--error)', flexShrink: 0 }} />}
                                {log.status === 'started' && <Loader2 size={16} className="spinner" style={{ color: 'var(--info)', flexShrink: 0 }} />}
                                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{log.action}</span>
                                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                                    {new Date(log.createdAt).toLocaleTimeString('es-ES')}
                                </span>
                                {log.details && (
                                    <span style={{
                                        color: 'var(--text-secondary)',
                                        marginLeft: 'auto',
                                        fontSize: '12px',
                                        maxWidth: '300px',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}>
                                        {typeof log.details === 'object'
                                            ? Object.entries(log.details).map(([k, v]) => `${k}: ${v}`).join(' | ')
                                            : String(log.details)
                                        }
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function StatCard({
    icon, value, label, color, onClick
}: {
    icon: React.ReactNode;
    value: number;
    label: string;
    color: string;
    onClick?: () => void;
}) {
    return (
        <div
            className="stat-card"
            onClick={onClick}
            style={{ cursor: onClick ? 'pointer' : 'default' }}
        >
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px'
            }}>
                <div style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '12px',
                    background: `${color}15`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: color,
                }}>
                    {icon}
                </div>
            </div>
            <div className="stat-value" style={{ color }}>{value}</div>
            <div className="stat-label">{label}</div>
        </div>
    );
}
