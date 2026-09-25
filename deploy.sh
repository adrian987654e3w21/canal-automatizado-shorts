#!/bin/bash
# ============================================================
# deploy.sh - Despliegue automático Canal Automatizado Shorts
# Uso: ./deploy.sh
# ============================================================
set -euo pipefail

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  🚀 DESPLIEGUE CANAL AUTOMATIZADO SHORTS (Docker)         ║"
echo "╚═══════════════════════════════════════════════════════════╝"

# 1. Verificar Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker no instalado. Instálalo: https://docs.docker.com/engine/install/"
    exit 1
fi
if ! command -v docker compose &> /dev/null; then
    echo "❌ Docker Compose no instalado. Instálalo: https://docs.docker.com/compose/install/"
    exit 1
fi
echo "✅ Docker y Docker Compose disponibles"

# 2. Verificar .env
if [ ! -f .env ]; then
    echo "📋 Copiando .env.example → .env"
    cp .env.example .env
    echo "⚠️  EDITA .env AHORA con tus datos (niccho, YouTube OAuth, etc.)"
    echo "   Luego vuelve a ejecutar ./deploy.sh"
    exit 0
fi
echo "✅ .env encontrado"

# 3. Crear directorios de datos en host (para bind mounts si se prefiere)
mkdir -p data/ollama data/voices data/backgrounds data/output

# 4. Descargar modelo Piper si no existe
PIPER_MODEL="data/voices/es_ES-sharvard-medium.onnx"
if [ ! -f "$PIPER_MODEL" ]; then
    echo "📥 Descargando modelo Piper (voz español)..."
    mkdir -p data/voices
    curl -fL "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx" \
         -o "$PIPER_MODEL"
    curl -fL "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx.json" \
         -o "$PIPER_MODEL.json"
    echo "✅ Modelo Piper descargado"
else
    echo "✅ Modelo Piper ya existe"
fi

# 5. Generar fondo de prueba si no existe
BACKGROUND="data/backgrounds/default.mp4"
if [ ! -f "$BACKGROUND" ]; then
    echo "🎨 Generando fondo de prueba..."
    docker run --rm -v "$(pwd)/data/backgrounds:/out" \
           ghcr.io/linuxserver/ffmpeg:latest \
           -y -f lavfi -i "color=c=0x07111F:s=1080x1920:r=30" \
           -vf "noise=alls=6:allf=t+u,format=yuv420p" \
           -t 60 -an -c:v libx264 -preset veryfast -crf 24 -movflags +faststart \
           /out/default.mp4
    echo "✅ Fondo generado"
else
    echo "✅ Fondo ya existe"
fi

# 6. Build y arranque
echo "🔨 Construyendo imagen Docker..."
docker compose build

echo "🚀 Levantando contenedor..."
docker compose up -d

# 7. Esperar healthcheck
echo "⏳ Esperando a que el servicio esté sano (máx 2 min)..."
for i in {1..24}; do
    if docker compose ps | grep -q "healthy"; then
        echo "✅ Servicio sano y corriendo"
        break
    fi
    sleep 5
    if [ $i -eq 24 ]; then
        echo "⚠️  Healthcheck no pasó. Revisa logs: docker compose logs -f"
        exit 1
    fi
done

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  🎉 DESPLIEGUE COMPLETADO                                  ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  Contenedor: faceless-shorts                               ║"
echo "║  Logs:       docker compose logs -f                        ║"
echo "║  Parar:      docker compose down                           ║"
echo "║  Reiniciar:  docker compose restart                        ║"
echo "║                                                            ║"
echo "║  📋 PRÓXIMOS PASOS MANUALES:                               ║"
echo "║  1. Edita .env con tu nicho y credenciales YouTube        ║"
echo "║  2. Ejecuta OAuth: docker compose exec shorts-bot \\       ║"
echo "║       node scripts/get-youtube-token.js                    ║"
echo "║  3. Pega YOUTUBE_REFRESH_TOKEN en .env y reinicia:        ║"
echo "║       docker compose restart                               ║"
echo "║  4. Pon DRY_RUN=false en .env cuando estés listo          ║"
echo "╚═══════════════════════════════════════════════════════════╝"