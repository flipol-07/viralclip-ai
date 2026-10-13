'use client';

import { useState } from 'react';
import { useAppStore } from '@/shared/stores/app-store';
import { X, Loader2, Radio } from 'lucide-react';

export function AddChannelModal() {
    const { setShowAddChannel, addChannel, loading } = useAppStore();
    const [url, setUrl] = useState('');
    const [language, setLanguage] = useState('es');
    const [durationMin, setDurationMin] = useState(20);
    const [durationMax, setDurationMax] = useState(45);
    const [captionStyle, setCaptionStyle] = useState('current');
    const [maxClips, setMaxClips] = useState(9);
    const [watermark, setWatermark] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!url.trim()) return;
        await addChannel(url.trim(), language, durationMin, durationMax, {
            captionStyle,
            maxClipsPerVideo: maxClips,
            watermarkText: watermark.trim() || undefined,
        });
    };

    return (
        <div className="modal-overlay" onClick={() => setShowAddChannel(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '24px',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '10px',
                            background: 'var(--accent-gradient)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            <Radio size={20} color="white" />
                        </div>
                        <h2 style={{ fontSize: '20px', fontWeight: 700 }}>Añadir Canal</h2>
                    </div>
                    <button
                        onClick={() => setShowAddChannel(false)}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: '4px',
                        }}
                    >
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    {/* URL */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                            URL del canal (YouTube o Twitch)
                        </label>
                        <input
                            className="input"
                            type="text"
                            placeholder="https://www.youtube.com/@canal o https://www.twitch.tv/canal"
                            value={url}
                            onChange={e => setUrl(e.target.value)}
                            required
                            autoFocus
                        />
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            YouTube: youtube.com/@canal o /channel/ID. Twitch: twitch.tv/canal (escanea los últimos VODs).
                        </p>
                    </div>

                    {/* Language */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                            Idioma del contenido
                        </label>
                        <select
                            className="input"
                            value={language}
                            onChange={e => setLanguage(e.target.value)}
                            style={{ cursor: 'pointer' }}
                        >
                            <option value="es">Español</option>
                            <option value="en">English</option>
                            <option value="pt">Português</option>
                            <option value="fr">Français</option>
                            <option value="de">Deutsch</option>
                        </select>
                    </div>

                    {/* Duration range */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                                Duración mín. (seg)
                            </label>
                            <input
                                className="input"
                                type="number"
                                min={10}
                                max={120}
                                value={durationMin}
                                onChange={e => setDurationMin(Number(e.target.value))}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                                Duración máx. (seg)
                            </label>
                            <input
                                className="input"
                                type="number"
                                min={15}
                                max={180}
                                value={durationMax}
                                onChange={e => setDurationMax(Number(e.target.value))}
                            />
                        </div>
                    </div>

                    {/* Caption style + clips per video */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                                Estilo de subtítulos
                            </label>
                            <select
                                className="input"
                                value={captionStyle}
                                onChange={e => setCaptionStyle(e.target.value)}
                                style={{ cursor: 'pointer' }}
                            >
                                <option value="current">Clásico (amarillo)</option>
                                <option value="hormozi">Hormozi (impacto)</option>
                                <option value="clean">Clean (minimal)</option>
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                                Máx. clips por vídeo
                            </label>
                            <input
                                className="input"
                                type="number"
                                min={1}
                                max={30}
                                value={maxClips}
                                onChange={e => setMaxClips(Number(e.target.value))}
                            />
                        </div>
                    </div>

                    {/* Watermark */}
                    <div style={{ marginBottom: '24px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                            Marca de agua propia (opcional)
                        </label>
                        <input
                            className="input"
                            type="text"
                            maxLength={30}
                            placeholder="@misclips"
                            value={watermark}
                            onChange={e => setWatermark(e.target.value)}
                        />
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            Tu @ quemado sutilmente en cada clip. Marca PROPIA no penaliza (la de otra plataforma sí).
                        </p>
                    </div>

                    {/* Submit */}
                    <button
                        className="btn-primary"
                        type="submit"
                        disabled={loading || !url.trim()}
                        style={{ width: '100%', justifyContent: 'center' }}
                    >
                        {loading ? (
                            <>
                                <Loader2 size={18} className="spinner" />
                                Buscando canal...
                            </>
                        ) : (
                            <>
                                <Radio size={18} />
                                Añadir Canal
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}
