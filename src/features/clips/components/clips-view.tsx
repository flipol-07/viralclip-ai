'use client';

import { useState } from 'react';
import { useAppStore } from '@/shared/stores/app-store';
import { Film, Download, Play, Star, X, Youtube, Settings2, Trash, Package, Copy, Check } from 'lucide-react';

interface PackData {
    texts: {
        youtube: { title: string; body: string };
        tiktok: { body: string };
        instagram: { body: string };
        musicWarning: boolean;
    };
    folder: string | null;
}

export function ClipsView() {
    const { clips } = useAppStore();
    const [previewClip, setPreviewClip] = useState<string | null>(null);
    const [packClip, setPackClip] = useState<string | null>(null);
    const [packData, setPackData] = useState<PackData | null>(null);
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [editingClip, setEditingClip] = useState<string | null>(null);
    const [editSettings, setEditSettings] = useState({
        bgMusic: '',
        withSubtitles: true,
        startTime: 0,
        endTime: 0,
        origStart: 0,
        origEnd: 0,
        captionStyle: 'current',
    });
    const [bgmList, setBgmList] = useState<{ id: string, name: string }[]>([]);
    const [sortBy, setSortBy] = useState<'recent' | 'score'>('recent');
    const [uploadingClip, setUploadingClip] = useState<string | null>(null);

    const fetchBgm = async () => {
        const res = await fetch('/api/bgm');
        const data = await res.json();
        if (data.success) setBgmList(data.data);
    };

    const handleEdit = (clipId: string) => {
        const clip = clips.find(c => c.id === clipId);
        if (clip) {
            setEditSettings({
                bgMusic: clip.backgroundMusic || '',
                withSubtitles: clip.hasSubtitles ?? true,
                startTime: Math.round(clip.startTime * 10) / 10,
                endTime: Math.round(clip.endTime * 10) / 10,
                origStart: Math.round(clip.startTime * 10) / 10,
                origEnd: Math.round(clip.endTime * 10) / 10,
                captionStyle: clip.captionStyle || 'current',
            });
            setEditingClip(clipId);
            fetchBgm();
        }
    };

    const handleDelete = async (clipId: string) => {
        if (confirm('¿Estás seguro de que quieres eliminar este clip?')) {
            const res = await fetch(`/api/clips/${clipId}`, { method: 'DELETE' });
            if (res.ok) {
                // Refresh local store (in a real app we'd use a server action or mutation)
                window.location.reload();
            }
        }
    };

    const saveChanges = async () => {
        if (!editingClip) return;
        const payload: Record<string, unknown> = {
            bgMusic: editSettings.bgMusic,
            withSubtitles: editSettings.withSubtitles,
            captionStyle: editSettings.captionStyle,
        };
        // Only send trim overrides when the user actually moved the boundaries
        if (editSettings.startTime !== editSettings.origStart) payload.startTime = editSettings.startTime;
        if (editSettings.endTime !== editSettings.origEnd) payload.endTime = editSettings.endTime;

        const res = await fetch(`/api/clips/${editingClip}/render`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            setEditingClip(null);
            window.location.reload(); // Quick refresh to see processing state
        }
    };

    const openPack = async (clipId: string) => {
        setPackClip(clipId);
        setPackData(null);
        try {
            const res = await fetch(`/api/clips/${clipId}/pack`);
            const json = await res.json();
            if (json.success) {
                setPackData(json.data);
            } else {
                alert(`❌ ${json.error}`);
                setPackClip(null);
            }
        } catch (err) {
            alert(`❌ Error cargando el pack: ${err}`);
            setPackClip(null);
        }
    };

    const copyText = async (key: string, text: string) => {
        await navigator.clipboard.writeText(text);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 1500);
    };

    const handleUpload = async (clipId: string) => {
        const clip = clips.find(c => c.id === clipId);
        if (!clip) return;
        if (clip.musicWarning && !confirm('⚠️ Este clip tiene MÚSICA DE FONDO detectada (riesgo de claim/strike por Content ID).\n\n¿Seguro que quieres subirlo a YouTube?')) return;
        if (!confirm(`¿Subir a YouTube como Short público?\n\nTítulo: ${clip.title}\n\nDescripción: ${clip.description || '(sin descripción)'}`)) return;

        setUploadingClip(clipId);
        try {
            const res = await fetch(`/api/clips/${clipId}/upload`, { method: 'POST' });
            const json = await res.json();
            if (json.success) {
                alert(`✅ Subido: https://youtube.com/shorts/${json.data.youtubeShortId}`);
                window.location.reload();
            } else {
                alert(`❌ ${json.error}`);
            }
        } catch (err) {
            alert(`❌ Error subiendo: ${err}`);
        } finally {
            setUploadingClip(null);
        }
    };

    const doneClips = [...clips.filter(c => c.status === 'done')].sort((a, b) =>
        sortBy === 'recent'
            ? b.createdAt.localeCompare(a.createdAt)
            : b.score - a.score
    );

    return (
        <div className="animate-fade-in">
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <div>
                    <h1 style={{ fontSize: '28px', fontWeight: 800 }}>
                        <span className="gradient-text">Clips Generados</span>
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '4px', fontSize: '14px' }}>
                        Tus clips virales listos para publicar en TikTok/Reels
                    </p>
                </div>
                <select
                    className="input"
                    style={{ width: 'auto', minWidth: '190px' }}
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as 'recent' | 'score')}
                >
                    <option value="recent">🕐 Más recientes primero</option>
                    <option value="score">⚡ Mejor score primero</option>
                </select>
            </div>

            {/* Clips grid */}
            {doneClips.length === 0 ? (
                <div className="glass-card">
                    <div className="empty-state">
                        <div className="empty-state-icon">
                            <Film size={36} style={{ color: 'var(--accent-primary)' }} />
                        </div>
                        <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>
                            No hay clips generados aún
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '400px' }}>
                            Procesa un vídeo para generar clips virales automáticamente.
                        </p>
                    </div>
                </div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                    gap: '20px',
                }}>
                    {doneClips.map(clip => (
                        <div key={clip.id} className="clip-card">
                            {/* Preview area: real video thumbnail (first frame via preload=metadata) */}
                            <div className="clip-preview" onClick={() => setPreviewClip(clip.id)}>
                                <video
                                    src={`/api/clips/${clip.id}/download#t=0.5`}
                                    preload="metadata"
                                    muted
                                    playsInline
                                />
                                <div className="clip-play-overlay">
                                    <div className="clip-play-button">
                                        <Play size={26} fill="currentColor" />
                                    </div>
                                </div>
                                {clip.youtubeShortId && (
                                    <div style={{
                                        position: 'absolute',
                                        top: '12px',
                                        left: '12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        padding: '4px 10px',
                                        borderRadius: '999px',
                                        background: '#ff0000',
                                        color: 'white',
                                        fontSize: '10px',
                                        fontWeight: 900,
                                        textTransform: 'uppercase',
                                    }}>
                                        <Youtube size={12} /> Live
                                    </div>
                                )}
                                {/* Viral Potential Badge */}
                                <div style={{
                                    position: 'absolute',
                                    top: '12px',
                                    right: '12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '6px 12px',
                                    borderRadius: '999px',
                                    background: 'rgba(255,255,255,0.94)',
                                    backdropFilter: 'blur(10px)',
                                    fontSize: '11px',
                                    fontWeight: 800,
                                    color: getScoreColor(clip.score),
                                    boxShadow: 'var(--shadow-md)',
                                }}>
                                    ⚡ VIRAL {normScore(clip.score)}/100
                                </div>
                            </div>

                            {/* Info */}
                            <div style={{ padding: '16px' }}>
                                <h3 style={{
                                    fontSize: '15px',
                                    fontWeight: 700,
                                    marginBottom: '6px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}>
                                    {clip.title}
                                </h3>
                                {clip.justification && (
                                    <p style={{
                                        fontSize: '12px',
                                        color: 'var(--text-secondary)',
                                        marginBottom: '12px',
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden',
                                    }}>
                                        {clip.justification}
                                    </p>
                                )}

                                {clip.metrics && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '16px', background: 'var(--bg-primary)', padding: '10px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                                        <div style={{ textAlign: 'center' }}>
                                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>Hook</div>
                                            <div style={{ fontSize: '15px', fontWeight: 800, color: normScore(clip.metrics.hook) >= 80 ? 'var(--success)' : 'var(--warning)' }}>{normScore(clip.metrics.hook)}</div>
                                        </div>
                                        <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
                                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>Flow</div>
                                            <div style={{ fontSize: '15px', fontWeight: 800, color: normScore(clip.metrics.flow) >= 80 ? 'var(--success)' : 'var(--warning)' }}>{normScore(clip.metrics.flow)}</div>
                                        </div>
                                        <div style={{ textAlign: 'center' }}>
                                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>Payoff</div>
                                            <div style={{ fontSize: '15px', fontWeight: 800, color: normScore(clip.metrics.payoff) >= 80 ? 'var(--success)' : 'var(--warning)' }}>{normScore(clip.metrics.payoff)}</div>
                                        </div>
                                    </div>
                                )}

                                {clip.keywords && clip.keywords.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '16px' }}>
                                        {clip.keywords.map(kw => (
                                            <span key={kw} className="keyword-chip">#{kw}</span>
                                        ))}
                                    </div>
                                )}

                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                        {Math.round(clip.duration)}s • {clip.hasSubtitles ? '🔤 Subs' : 'Sin subs'} • {clip.predictedLayout === 'split_screen' ? '👯 Split' : '👤 Auto'}
                                        {clip.segments && clip.segments.length > 1 ? ` • ✂️ ${clip.segments.length} cortes` : ''}
                                        {clip.hookTitle ? ' • 🏷️ Título' : ''}
                                        {typeof clip.visualScore === 'number' ? ` • 👁 ${Math.round(clip.visualScore)}` : ''}
                                        {clip.musicWarning ? <span style={{ color: '#b45309', fontWeight: 700 }} title="Música de fondo detectada: riesgo Content ID, no subir a YouTube"> • ⚠️ música</span> : null}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button
                                        className="btn-primary"
                                        style={{ flex: 1, padding: '6px 0', fontSize: '13px', justifyContent: 'center' }}
                                        onClick={() => setPreviewClip(clip.id)}
                                    >
                                        <Play size={14} />
                                        Ver
                                    </button>
                                    <button
                                        className="btn-secondary"
                                        style={{ flex: 1, padding: '6px 0', fontSize: '13px', justifyContent: 'center' }}
                                        onClick={() => handleEdit(clip.id)}
                                    >
                                        <Settings2 size={14} />
                                        Editar
                                    </button>
                                    <button
                                        className="btn-danger"
                                        style={{ flex: 1, padding: '6px 0', fontSize: '13px', justifyContent: 'center' }}
                                        onClick={() => handleDelete(clip.id)}
                                    >
                                        <Trash size={14} />
                                        Eliminar
                                    </button>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                    <a
                                        href={`/api/clips/${clip.id}/download`}
                                        download
                                        className="btn-secondary"
                                        style={{ flex: 1, padding: '6px 0', fontSize: '13px', justifyContent: 'center' }}
                                    >
                                        <Download size={14} />
                                        Descargar
                                    </a>
                                    {clip.youtubeShortId ? (
                                        <a
                                            href={`https://youtube.com/shorts/${clip.youtubeShortId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="btn-secondary"
                                            style={{ flex: 1, padding: '6px 0', fontSize: '13px', justifyContent: 'center', color: '#dc2626' }}
                                        >
                                            <Youtube size={14} />
                                            Ver en YT
                                        </a>
                                    ) : (
                                        <button
                                            className="btn-secondary"
                                            style={{ flex: 1, padding: '6px 0', fontSize: '13px', justifyContent: 'center', color: '#dc2626' }}
                                            disabled={uploadingClip === clip.id}
                                            onClick={() => handleUpload(clip.id)}
                                        >
                                            <Youtube size={14} />
                                            {uploadingClip === clip.id ? 'Subiendo…' : 'Subir a YT'}
                                        </button>
                                    )}
                                </div>
                                <button
                                    className="btn-secondary"
                                    style={{ width: '100%', marginTop: '8px', padding: '6px 0', fontSize: '13px', justifyContent: 'center' }}
                                    onClick={() => openPack(clip.id)}
                                >
                                    <Package size={14} />
                                    Pack de publicación (YT · TikTok · IG)
                                </button>

                                {/* Score bar */}
                                <div className="score-bar" style={{ marginTop: '12px' }}>
                                    <div
                                        className="score-bar-fill"
                                        style={{
                                            width: `${normScore(clip.score)}%`,
                                            background: getScoreGradient(clip.score),
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Edit Modal */}
            {editingClip && (
                <div className="modal-overlay" onClick={() => setEditingClip(null)}>
                    <div className="glass-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '100%', padding: '24px' }}>
                        <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '8px' }}>Refinar Clip</h2>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px' }}>
                            🎯 El encuadre es automático: la IA detecta caras y quién habla, y combina
                            seguimiento, split-screen o centro escena a escena.
                        </p>

                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                                Recortar (segundos del vídeo original)
                            </label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div>
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Inicio</span>
                                    <input
                                        className="input"
                                        type="number"
                                        step={0.5}
                                        min={0}
                                        value={editSettings.startTime}
                                        onChange={e => setEditSettings({ ...editSettings, startTime: Number(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Fin</span>
                                    <input
                                        className="input"
                                        type="number"
                                        step={0.5}
                                        min={0}
                                        value={editSettings.endTime}
                                        onChange={e => setEditSettings({ ...editSettings, endTime: Number(e.target.value) })}
                                    />
                                </div>
                            </div>
                            <p style={{ fontSize: '11px', marginTop: '6px', color: 'var(--text-muted)' }}>
                                Duración: {Math.max(0, editSettings.endTime - editSettings.startTime).toFixed(1)}s
                                {(editSettings.startTime !== editSettings.origStart || editSettings.endTime !== editSettings.origEnd) &&
                                    ' · se re-renderizará con los nuevos límites'}
                            </p>
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>Estilo de subtítulos</label>
                            <select
                                className="input"
                                value={editSettings.captionStyle}
                                onChange={e => setEditSettings({ ...editSettings, captionStyle: e.target.value })}
                            >
                                <option value="current">Clásico (amarillo)</option>
                                <option value="hormozi">Hormozi (impacto)</option>
                                <option value="clean">Clean (minimal)</option>
                            </select>
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>Música de fondo</label>
                            <select
                                className="input"
                                value={editSettings.bgMusic}
                                onChange={e => setEditSettings({ ...editSettings, bgMusic: e.target.value })}
                            >
                                <option value="">Sin música</option>
                                {bgmList.map(bgm => (
                                    <option key={bgm.id} value={bgm.id}>{bgm.name}</option>
                                ))}
                            </select>
                            <p style={{ fontSize: '11px', marginTop: '4px', color: 'var(--text-muted)' }}>Sube tus mp3 a <code>data/bgm/</code></p>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
                            <input
                                type="checkbox"
                                checked={editSettings.withSubtitles}
                                onChange={e => setEditSettings({ ...editSettings, withSubtitles: e.target.checked })}
                            />
                            <label style={{ fontSize: '14px' }}>Incluir subtítulos quemados</label>
                        </div>

                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setEditingClip(null)}>Cancelar</button>
                            <button className="btn-primary" style={{ flex: 1 }} onClick={saveChanges}>Renderizar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Publish Pack Modal */}
            {packClip && (
                <div className="modal-overlay" onClick={() => setPackClip(null)}>
                    <div className="glass-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px', width: '100%', padding: '24px', maxHeight: '85vh', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <h2 style={{ fontSize: '20px', fontWeight: 800 }}>📦 Pack de publicación</h2>
                            <button onClick={() => setPackClip(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                                <X size={20} />
                            </button>
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                            Sube el mp4 <strong>manualmente y en nativo</strong> en cada app (nunca el vídeo descargado de otra plataforma) y pega su texto. Checklist completo: <code>docs/playbook-publicacion.md</code>
                        </p>

                        {!packData ? (
                            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Cargando…</p>
                        ) : (
                            <>
                                {packData.texts.musicWarning && (
                                    <div style={{ padding: '10px 14px', borderRadius: '10px', background: '#fef3c7', border: '1px solid #f59e0b', color: '#92400e', fontSize: '13px', fontWeight: 600, marginBottom: '16px' }}>
                                        ⚠️ Música de fondo detectada — riesgo de Content ID. NO subir a YouTube.
                                    </div>
                                )}

                                {([
                                    { key: 'yt-title', label: '▶️ YouTube — Título', text: packData.texts.youtube.title },
                                    { key: 'yt-body', label: '▶️ YouTube — Descripción', text: packData.texts.youtube.body },
                                    { key: 'tt-body', label: '🎵 TikTok — Caption', text: packData.texts.tiktok.body },
                                    { key: 'ig-body', label: '📸 Instagram — Caption', text: packData.texts.instagram.body },
                                ]).map(section => (
                                    <div key={section.key} style={{ marginBottom: '14px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>{section.label}</span>
                                            <button
                                                className="btn-secondary"
                                                style={{ padding: '4px 10px', fontSize: '12px' }}
                                                onClick={() => copyText(section.key, section.text)}
                                            >
                                                {copiedKey === section.key ? <Check size={12} /> : <Copy size={12} />}
                                                {copiedKey === section.key ? 'Copiado' : 'Copiar'}
                                            </button>
                                        </div>
                                        <pre style={{
                                            margin: 0,
                                            padding: '10px 12px',
                                            borderRadius: '10px',
                                            background: 'var(--bg-primary)',
                                            border: '1px solid var(--border)',
                                            fontSize: '12px',
                                            whiteSpace: 'pre-wrap',
                                            wordBreak: 'break-word',
                                            fontFamily: 'inherit',
                                        }}>{section.text}</pre>
                                    </div>
                                ))}

                                {packData.folder && (
                                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px' }}>
                                        Carpeta con el mp4 + textos: <code>{packData.folder}</code>
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Preview Modal */}
            {previewClip && (
                <div className="modal-overlay" onClick={() => setPreviewClip(null)}>
                    <div onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
                            <button
                                onClick={() => setPreviewClip(null)}
                                style={{
                                    background: 'rgba(255,255,255,0.92)',
                                    border: 'none',
                                    color: 'var(--text-primary)',
                                    cursor: 'pointer',
                                    padding: '8px',
                                    borderRadius: '50%',
                                    boxShadow: 'var(--shadow-md)',
                                    display: 'flex',
                                }}
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="video-preview">
                            <video
                                src={`/api/clips/${previewClip}/download`}
                                controls
                                autoPlay
                                style={{ width: '100%', height: '100%' }}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/** Normalize legacy 0-10 scores and new 0-100 scores to a 0-100 scale */
function normScore(score: number): number {
    return Math.round(score > 10 ? score : score * 10);
}

function getScoreColor(score: number): string {
    const s = normScore(score);
    if (s >= 80) return '#16a34a';
    if (s >= 60) return '#b45309';
    if (s >= 40) return '#2563eb';
    return '#6b7280';
}

function getScoreGradient(score: number): string {
    const s = normScore(score);
    if (s >= 80) return 'linear-gradient(90deg, #22c55e, #10b981)';
    if (s >= 60) return 'linear-gradient(90deg, #f59e0b, #eab308)';
    if (s >= 40) return 'linear-gradient(90deg, #3b82f6, #6366f1)';
    return 'linear-gradient(90deg, #6b7280, #9ca3af)';
}
