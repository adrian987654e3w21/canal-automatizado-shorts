# ============================================================
# Canal Automatizado Shorts - Dockerfile multi-servicio
# Incluye: Node.js app + Ollama + Piper TTS
# ============================================================
FROM node:22-bookworm-slim AS base

# Instalar dependencias del sistema: ffmpeg, piper, curl, gnupg
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    gnupg \
    libespeak-ng1 \
    && rm -rf /var/lib/apt/lists/*

# Instalar Piper TTS (binario oficial)
ARG PIPER_VERSION=1.2.0
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then PIPER_ARCH="x86_64"; else PIPER_ARCH="aarch64"; fi && \
    curl -fsSL "https://github.com/rhasspy/piper/releases/download/v${PIPER_VERSION}/piper_${PIPER_ARCH}.tar.gz" \
    | tar -xz -C /usr/local/bin --strip-components=1 piper/piper piper/libespeak-ng.so.1 && \
    chmod +x /usr/local/bin/piper

# Instalar Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

# Directorio de trabajo
WORKDIR /app

# Copiar package.json e instalar dependencias Node
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar código fuente
COPY . .

# Crear directorios de datos persistentes
RUN mkdir -p /data/ollama /data/voices /data/backgrounds /app/output

# Variables de entorno por defecto (sobrescribibles en docker-compose)
ENV OLLAMA_HOST=0.0.0.0:11434 \
    OLLAMA_MODELS=/data/ollama \
    PIPER_BINARY=/usr/local/bin/piper \
    PIPER_MODEL=/data/voices/es_ES-sharvard-medium.onnx \
    BACKGROUND_FILE=/data/backgrounds/default.mp4 \
    OUTPUT_DIR=/app/output \
    USE_LOCAL_AI=true \
    DRY_RUN=true \
    NODE_ENV=production

# Exponer puertos: 3000 (app), 11434 (Ollama)
EXPOSE 3000 11434

# Script de arranque que levanta Ollama en background y luego la app
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]