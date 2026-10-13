'use client';

import { useAppStore } from '@/shared/stores/app-store';

export function Toast() {
    const { toast } = useAppStore();
    if (!toast.visible) return null;

    return (
        <div className={`toast ${toast.type === 'success' ? 'toast-success' : 'toast-error'}`}>
            {toast.message}
        </div>
    );
}
