#!/usr/bin/env bash
# Setup del entorno Python para el reencuadre inteligente (detección de caras).
# Uso: bash scripts/setup-python.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Creando venv en .venv-cv ..."
python3 -m venv .venv-cv
.venv-cv/bin/pip install --quiet --upgrade pip
.venv-cv/bin/pip install --quiet mediapipe opencv-python-headless numpy

MODELS_DIR="scripts/models"
mkdir -p "$MODELS_DIR"

if [ ! -f "$MODELS_DIR/face_detection_yunet_2023mar.onnx" ]; then
    echo "→ Descargando modelo YuNet (detección de caras) ..."
    curl -sL -o "$MODELS_DIR/face_detection_yunet_2023mar.onnx" \
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
fi

.venv-cv/bin/python -c "import cv2, numpy; print('✓ OpenCV', cv2.__version__, 'listo')"
echo "✓ Setup completo. El worker usará .venv-cv/bin/python para el reencuadre."
