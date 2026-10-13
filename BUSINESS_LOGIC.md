# 📋 BUSINESS_LOGIC.md - ViralClip AI

> Generado por SaaS Factory | Fecha: 2026-03-06

## 1. Problema de Negocio
**Dolor:** Los creadores de contenido (YouTubers, podcasters, speakers) tienen horas de vídeo con momentos brillantes enterrados. Identificar, recortar, reformatear a vertical y editar para TikTok/Reels es 100% manual: ver el vídeo entero, anotar timestamps, cortar, reencuadrar a 9:16, añadir subtítulos. Un vídeo de 1h puede costar 3-5h de edición para 3-5 clips.

**Costo actual:** Un editor freelance cobra 20-50€/hora. 5 clips de 1 podcast = 60-200€ y 3-5h. Para creadores que publican 2-3x/semana = 500-1500€/mes solo en clips. Los que no pueden pagarlo pierden alcance masivo en redes cortas.

## 2. Solución
**Propuesta de valor:** Una herramienta local automatizada que analiza vídeos largos de YouTube, detecta momentos de alto engagement con IA, y genera clips verticales 9:16 listos para TikTok/Reels con subtítulos y reencuadre automático.

**Flujo principal (Happy Path):**
1. El usuario configura uno o más canales de YouTube en la app
2. La app monitoriza los canales periódicamente desde local
3. Cuando detecta un vídeo nuevo (no analizado), lo descarga con yt-dlp
4. La IA transcribe el audio y detecta momentos de alto engagement (picos emocionales, frases impactantes, humor, insights)
5. El sistema genera 5-10 clips candidatos en 9:16 con reencuadre inteligente y subtítulos estilo TikTok
6. Marca el vídeo como "analizado" en Supabase
7. El usuario revisa los clips generados y descarga los que quiera

## 3. Usuario Objetivo
**Rol:** Creador de contenido independiente con audiencia en YouTube/podcast que no aprovecha TikTok/Reels por falta de tiempo. Social media manager de agencia que gestiona varios creadores.
**Contexto:** App 100% local (su propio ordenador), sin cloud para processing. La app usa IA (OpenAI) para el análisis y ffmpeg para el procesamiento de video.

## 4. Arquitectura de Datos
**Input:**
- Lista de canales de YouTube (URL)
- Preferencias por canal: idioma, duración de clips (15-60s), tono
- Vídeos nuevos detectados automáticamente (RSS/API)

**Output:**
- Clips MP4 en 9:16 listos para publicar (carpeta local)
- Subtítulos quemados estilo TikTok
- Puntuación y justificación de cada clip
- Transcript completo del vídeo original

**Storage (Supabase tables):**
- `channels`: Canales YouTube monitorizados (id, youtube_channel_id, channel_name, channel_url, language, clip_duration_min, clip_duration_max, status, created_at)
- `videos`: Vídeos detectados/procesados (id, channel_id, youtube_video_id, title, url, duration, status [pending/downloading/transcribing/analyzing/clipping/done/error], error_message, transcript, created_at, processed_at)
- `clips`: Clips generados (id, video_id, title, description, start_time, end_time, duration, score, justification, file_path, subtitles_path, status, created_at)
- `processing_logs`: Historial de ejecuciones (id, video_id, action, status, details, created_at)

## 5. KPI de Éxito
**Métrica principal:** De un vídeo de 60 minutos, generar 5 clips publicables en menos de 10 minutos de forma completamente automática desde que se detecta el vídeo nuevo. El usuario solo configura canales una vez y la app hace el resto.

## 6. Especificación Técnica

### Features a Implementar (Feature-First)
```
src/features/
├── channels/        # CRUD de canales YouTube a monitorizar
├── videos/          # Estado y gestión de vídeos detectados
├── clips/           # Galería de clips generados, preview, descarga
├── processing/      # Motor de procesamiento (download, transcribe, analyze, clip)
└── dashboard/       # Vista general con estadísticas
```

### Stack Confirmado
- **Frontend:** Next.js 16 + React 19 + TypeScript + Tailwind 3.4
- **Backend:** Supabase (Database) + Node.js API Routes (procesamiento local)
- **Video:** ffmpeg (corte/reencuadre) + yt-dlp (descarga)
- **IA:** OpenAI GPT-4 (análisis de momentos) + Whisper API (transcripción)
- **Validación:** Zod
- **State:** Zustand

### Próximos Pasos
1. [x] Setup proyecto base
2. [ ] Configurar Supabase (tablas)
3. [ ] Feature: channels (CRUD)
4. [ ] Feature: processing (download + transcribe + analyze + clip)
5. [ ] Feature: clips (galería + preview + descarga)
6. [ ] Feature: dashboard (estadísticas)
7. [ ] Test E2E con canal IShowSpeed
```
