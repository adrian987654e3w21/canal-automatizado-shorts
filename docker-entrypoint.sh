#!/bin/bash
set -euo pipefail

# ============================================================
# Entrypoint para contenedor Canal Automatizado Shorts
# Levanta Ollama en background, espera a que esté listo,
# descarga modelo si no existe, y arranca la app Node.
# ============================================================

echo "[entrypoint] Iniciando contenedor..."

# 1. Arrancar Ollama en background
echo "[entrypoint] Arrancando Ollama en puerto 11434..."
ollama serve > /var/log/ollama.log 2>&1 &
OLLAMA_PID=$!

# Función para limpiar al recibir señal
cleanup() {
    echo "[entrypoint] Deteniendo servicios..."
    kill $OLLAMA_PID 2>/dev/null || true
    wait $OLLAMA_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGTERM SIGINT

# 2. Esperar a que Ollama responda (máx 60s)
echo "[entrypoint] Esperando a que Ollama esté listo..."
for i in {1..30}; do
    if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
        echo "[entrypoint] Ollama listo."
        break
    fi
    sleep 2
    if [ $i -eq 30 ]; then
        echo "[entrypoint] ERROR: Ollama no arrancó a tiempo." >&2
        exit 1
    fi
done

# 3. Descargar modelo LLM si no existe
MODEL="${OLLAMA_MODEL:-llama3.1:8b}"
echo "[entrypoint] Verificando modelo Ollama: $MODEL"
if ! ollama list | grep -q "^$MODEL "; then
    echo "[entrypoint] Descargando modelo $MODEL (puede tardar unos minutos)..."
    ollama pull "$MODEL"
else
    echo "[entrypoint] Modelo $MODEL ya disponible."
fi

# 4. Verificar modelo Piper
PIPER_MODEL="${PIPER_MODEL:-/data/voices/es_ES-sharvard-medium.onnx}"
if [ ! -f "$PIPER_MODEL" ]; then
    echo "[entrypoint] ADVERTENCIA: Modelo Piper no encontrado en $PIPER_MODEL"
    echo "[entrypoint] Descarga manual: https://huggingface.co/rhasspy/piper-voices/tree/main/es/es_ES/sharvard/medium"
fi

# 5. Verificar fondo de video
BACKGROUND_FILE="${BACKGROUND_FILE:-/data/backgrounds/default.mp4}"
if [ ! -f "$BACKGROUND_FILE" ]; then
    echo "[entrypoint] Fondo no encontrado, generando uno de prueba..."
    mkdir -p "$(dirname "$BACKGROUND_FILE")"
    /usr/local/bin/piper --help >/dev/null 2>&1  # solo para verificar que piper existe
    ffmpeg -y -f lavfi -i "color=c=0x07111F:s=1080x1920:r=30" \
           -vf "noise=alls=6:allf=t+u,format=yuv420p" \
           -t 60 -an -c:v libx264 -preset veryfast -crf 24 -movflags +faststart \
           "$BACKGROUND_FILE" 2>/dev/null
    echo "[entrypoint] Fondo de prueba generado en $BACKGROUND_FILE"
fi

# 6. Arrancar aplicación Node (pasa a ser PID 1)
echo "[entrypoint] Arrancando aplicación Node..."
exec node index.js