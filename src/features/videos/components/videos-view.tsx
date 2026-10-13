'use client';

import { useState } from 'react';
import { useAppStore } from '@/shared/stores/app-store';
import { Play, Video, Loader2, AlertCircle, CheckCircle2, Clock, Search, FolderInput } from 'lucide-react';

const statusLabels: Record<string, string> = {
    pending: 'Pendiente',
    downloading: 'Descargando',
    transcribing: 'Transcribiendo',
    analyzing: 'Analizando',
    clipping: 'Creando clips',
    done: 'Completado',
    error: 'Error',
};

const statusIcons: Record<string, React.ReactNode> = {
    pending: <Clock size={14} />,
    downloading: <Loader2 size={14} className="spinner" />,
    transcribing: <Loader2 size={14} className="spinner" />,
    analyzing: <Loader2 size={14} className="spinner" />,
    clipping: <Loader2 size={14} className="spinner" />,
    done: <CheckCircle2 size={14} />,
    error: <AlertCircle size={14} />,
};

export function VideosView() {
    const { videos, processVideo, scanChannels, loading, workerStatus, importLocalVideo } = useAppStore();
    const [showImport, setShowImport] = useState(false);
    const [importPath, setImportPath] = useState('');
    const [importTitle, setImportTitle] = useState('');
    const [eventPriority, setEventPriority] = useState(false);

    const handleImport = async () => {
        if (!importPath.trim()) return;
        const ok = await importLocalVideo(importPath.trim(), importTitle.trim() || undefined, eventPriority);
        if (ok) {
            setShowImport(false);
            setImportPath('');
            setImportTitle('');
            setEventPriority(false);
        }
    };

    const workerAlive = workerStatus?.workerAlive ?? false;

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
                        <span className="gradient-text">Vídeos</span>
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '4px', fontSize: '14px' }}>
                        Vídeos de tus canales o importados desde tu disco
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <button className="btn-secondary" onClick={scanChannels} disabled={loading}>
                        {loading ? <Loader2 size={18} className="spinner" /> : <Search size={18} />}
                        Buscar Nuevos
                    </button>
                    <button className="btn-primary" onClick={() => setShowImport(true)}>
                        <FolderInput size={18} />
                        Importar Vídeo
                    </button>
                </div>
            </div>

            {/* Import local video modal */}
            {showImport && (
                <div className="modal-overlay" onClick={() => setShowImport(false)}>
                    <div className="glass-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px', width: '100%', padding: '24px' }}>
                        <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>📥 Importar vídeo</h3>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            Vale una URL de YouTube o de un VOD de Twitch
                            (<code>twitch.tv/videos/...</code>), o la ruta de un archivo local
                            (<code>C:\Users\tu\Videos\velada.mp4</code> o <code>/home/...</code>).
                        </p>
                        <input
                            className="input"
                            type="text"
                            placeholder="URL (YouTube/Twitch) o ruta del archivo"
                            value={importPath}
                            onChange={e => setImportPath(e.target.value)}
                            autoFocus
                            style={{ marginBottom: '12px' }}
                        />
                        <input
                            className="input"
                            type="text"
                            placeholder="Título (opcional)"
                            value={importTitle}
                            onChange={e => setImportTitle(e.target.value)}
                            style={{ marginBottom: '12px' }}
                        />
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={eventPriority}
                                onChange={e => setEventPriority(e.target.checked)}
                            />
                            <span style={{ fontSize: '13px' }}>
                                ⚡ Prioridad de evento (salta la cola — para VODs recién terminados, ej. la Velada)
                            </span>
                        </label>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setShowImport(false)}>Cancelar</button>
                            <button className="btn-primary" style={{ flex: 1 }} onClick={handleImport} disabled={loading || !importPath.trim()}>
                                {loading ? <Loader2 size={16} className="spinner" /> : <FolderInput size={16} />}
                                Importar y procesar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Videos list */}
            {videos.length === 0 ? (
                <div className="glass-card">
                    <div className="empty-state">
                        <div className="empty-state-icon">
                            <Video size={36} style={{ color: 'var(--accent-primary)' }} />
                        </div>
                        <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>
                            No hay vídeos detectados
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '400px', marginBottom: '20px' }}>
                            Configura un canal y usa &quot;Escanear Canales&quot; para detectar vídeos nuevos automáticamente.
                        </p>
                        <button className="btn-primary" onClick={scanChannels} disabled={loading}>
                            <Search size={18} />
                            Escanear Ahora
                        </button>
                    </div>
                </div>
            ) : (
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Vídeo</th>
                                <th>Canal</th>
                                <th>Duración</th>
                                <th>Estado</th>
                                <th>Acción</th>
                            </tr>
                        </thead>
                        <tbody>
                            {videos.map(video => (
                                <tr key={video.id}>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', maxWidth: '400px' }}>
                                            {video.thumbnailUrl ? (
                                                <img
                                                    src={video.thumbnailUrl}
                                                    alt=""
                                                    style={{
                                                        width: '80px',
                                                        height: '45px',
                                                        borderRadius: '8px',
                                                        objectFit: 'cover',
                                                        flexShrink: 0,
                                                    }}
                                                />
                                            ) : (
                                                <div style={{
                                                    width: '80px',
                                                    height: '45px',
                                                    borderRadius: '8px',
                                                    background: 'var(--bg-card)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    flexShrink: 0,
                                                }}>
                                                    <Video size={20} style={{ color: 'var(--text-muted)' }} />
                                                </div>
                                            )}
                                            <div>
                                                <p style={{
                                                    fontWeight: 600,
                                                    fontSize: '14px',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    maxWidth: '300px',
                                                }}>
                                                    {video.title}
                                                </p>
                                                {video.errorMessage && (
                                                    <p style={{ fontSize: '12px', color: 'var(--error)', marginTop: '2px' }}>
                                                        {video.errorMessage}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                            {video.channelName}
                                        </span>
                                    </td>
                                    <td>
                                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                            {video.duration ? formatDuration(video.duration) : '--'}
                                        </span>
                                    </td>
                                    <td>
                                        <span className={`status-badge status-${video.status}`}>
                                            {statusIcons[video.status]}
                                            {statusLabels[video.status]}
                                        </span>
                                    </td>
                                    <td>
                                        {['pending', 'error'].includes(video.status) ? (
                                            <button
                                                className="btn-primary"
                                                onClick={() => processVideo(video.id)}
                                                style={{ padding: '8px 16px', fontSize: '13px' }}
                                            >
                                                <Play size={14} />
                                                {video.status === 'error' ? 'Reintentar' : 'Procesar'}
                                            </button>
                                        ) : video.status === 'done' ? (
                                            <span style={{ fontSize: '13px', color: 'var(--success)', fontWeight: 600 }}>
                                                ✅ Listo
                                            </span>
                                        ) : workerAlive ? (
                                            <span style={{ fontSize: '13px', color: 'var(--info)' }}>
                                                <Loader2 size={14} className="spinner" style={{ display: 'inline' }} /> Procesando...
                                            </span>
                                        ) : (
                                            <button
                                                className="btn-secondary"
                                                onClick={() => processVideo(video.id)}
                                                style={{ padding: '8px 16px', fontSize: '13px' }}
                                                title="El worker está parado; al arrancarlo continuará desde el último checkpoint"
                                            >
                                                <Play size={14} />
                                                Reanudar
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function formatDuration(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}
