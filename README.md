# 🎬 ViralClip AI

Clipper automático estilo Opus Clip, 100% local: convierte vídeos largos (YouTube o archivos de tu disco) en clips verticales 9:16 listos para TikTok / Reels / Shorts, con detección de momentos virales por IA, reencuadre inteligente con tracking de caras y subtítulos karaoke palabra a palabra.

## Cómo se usa

```bash
# Terminal 1 — la interfaz web
npm run dev

# Terminal 2 — el worker (el que procesa los vídeos)
npm run worker
```

1. Abre la web (puerto 3000-3006).
2. **Importar Vídeo** → pega la ruta de un archivo local (vale ruta de Windows `C:\...` o WSL `/home/...`), o añade un canal de YouTube para monitorizarlo.
3. El worker procesa solo: descarga → transcribe (Groq Whisper) → detecta momentos virales (GPT-4o-mini) → reencuadra con tracking de caras → renderiza con subtítulos karaoke.
4. Los clips quedan en `output/<videoId>/*.mp4` listos para subir a mano.

**Puedes cerrar el ordenador cuando quieras**: cada paso guarda checkpoint (por etapa, por chunk de transcripción y por clip). Al relanzar `npm run worker` continúa exactamente donde se quedó sin re-pagar ninguna llamada a la API.

> Para que el worker arranque al encender el PC: copia un acceso directo de `start-worker.bat` a la carpeta de Inicio de Windows (`Win+R` → `shell:startup`).

## Variables de entorno (`.env.local`)

| Variable | Para qué |
|---|---|
| `GROQ_API_KEY` | Transcripción (whisper-large-v3-turbo, ~$0.04/h de audio). Gratis en console.groq.com |
| `OPENAI_API_KEY` | Análisis de momentos virales + fallback de transcripción |
| `SCAN_INTERVAL_MIN` | Cada cuántos minutos escanea los canales activos (default 30) |

## Arquitectura

```
Next.js (UI + API) ──► SQLite WAL (data/app.db) ◄── Worker standalone (scripts/worker.ts)
                            cola de jobs                │
                                                        ├── yt-dlp (descarga 1080p, reanudable)
                                                        ├── Groq/OpenAI Whisper (palabras + timestamps)
                                                        ├── GPT-4o-mini (momentos virales, map-reduce)
                                                        ├── scripts/reframe.py (YuNet + OpenCV, CPU)
                                                        └── ffmpeg (crop dinámico + subtítulos ASS karaoke)
```

### Reencuadre inteligente (`scripts/reframe.py`)

Analiza las caras del clip a ~4fps y decide el layout automáticamente:

- **track** — 1 persona: la cámara virtual sigue la cara con suavizado tipo operador humano (deadzone + velocidad limitada + saltos en cortes de escena)
- **split** — 2 personas estables (podcast): pantalla dividida arriba/abajo, cada mitad encuadrada en SU cara
- **center** — sin caras fiables (planos generales): crop central

Setup del entorno Python (solo la primera vez): `bash scripts/setup-python.sh`

### Requisitos del sistema

- `ffmpeg` y `yt-dlp` en el PATH
- Python 3.10+ (para el reencuadre; si falta, cae a crop central)
- Sin GPU: todo el stack está elegido para correr en CPU

## Estructura

```
src/features/processing/services/
├── pipeline.ts        # Orquestador por etapas con checkpoints
├── ai-service.ts      # Transcripción (Groq) + análisis viral (map-reduce)
├── video-service.ts   # Render ffmpeg: crop dinámico + subtítulos karaoke
├── youtube-service.ts # yt-dlp + YouTube Data API
└── automation-service.ts # Escaneo de canales + feedback de analytics

scripts/
├── worker.ts          # Worker standalone con cola, heartbeat y auto-resume
├── reframe.py         # Planificador de crop con detección de caras
└── setup-python.sh    # Setup del venv de visión por computador
```
