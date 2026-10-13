'use client';

import { useAppStore } from '@/shared/stores/app-store';
import { Plus, Trash2, Radio, Globe, Clock } from 'lucide-react';

export function ChannelsView() {
    const { channels, setShowAddChannel, deleteChannel } = useAppStore();

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
                        <span className="gradient-text">Canales</span>
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '4px', fontSize: '14px' }}>
                        Canales de YouTube monitorizados
                    </p>
                </div>
                <button className="btn-primary" onClick={() => setShowAddChannel(true)}>
                    <Plus size={18} />
                    Añadir Canal
                </button>
            </div>

            {/* Channel List */}
            {channels.length === 0 ? (
                <div className="glass-card">
                    <div className="empty-state">
                        <div className="empty-state-icon">
                            <Radio size={36} style={{ color: 'var(--accent-primary)' }} />
                        </div>
                        <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>
                            No hay canales configurados
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '400px', marginBottom: '20px' }}>
                            Añade tu primer canal de YouTube para empezar a generar clips virales automáticamente.
                        </p>
                        <button className="btn-primary" onClick={() => setShowAddChannel(true)}>
                            <Plus size={18} />
                            Añadir Primer Canal
                        </button>
                    </div>
                </div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
                    gap: '16px',
                }}>
                    {channels.map(channel => (
                        <div key={channel.id} className="glass-card" style={{ padding: '24px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                                    <div style={{
                                        width: '48px',
                                        height: '48px',
                                        borderRadius: '12px',
                                        background: 'var(--accent-gradient)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                    }}>
                                        <Radio size={24} color="white" />
                                    </div>
                                    <div>
                                        <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>
                                            {channel.channelName}
                                        </h3>
                                        <p style={{
                                            fontSize: '12px',
                                            color: 'var(--text-muted)',
                                            maxWidth: '200px',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}>
                                            {channel.channelUrl}
                                        </p>
                                    </div>
                                </div>
                                <button className="btn-danger" onClick={() => deleteChannel(channel.id)}>
                                    <Trash2 size={14} />
                                </button>
                            </div>

                            <div style={{
                                display: 'flex',
                                gap: '16px',
                                marginTop: '20px',
                                paddingTop: '16px',
                                borderTop: '1px solid var(--border)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                    <Globe size={14} />
                                    {channel.language.toUpperCase()}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                    <Clock size={14} />
                                    {channel.clipDurationMin}-{channel.clipDurationMax}s
                                </div>
                                <div style={{ marginLeft: 'auto' }}>
                                    <span className={`status-badge ${channel.isActive ? 'status-done' : 'status-error'}`}>
                                        {channel.isActive ? 'Activo' : 'Inactivo'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
