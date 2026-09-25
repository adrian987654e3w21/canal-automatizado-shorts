<# 
============================================================
deploy.ps1 - Despliegue automático Canal Automatizado Shorts (Windows)
Uso: .\deploy.ps1
============================================================
#>

Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  🚀 DESPLIEGUE CANAL AUTOMATIZADO SHORTS (Docker)         ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

# 1. Verificar Docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Docker no instalado. Instálalo: https://docs.docker.com/desktop/install/windows-install/" -ForegroundColor Red
    exit 1
}
if (-not (Get-Command "docker compose" -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Docker Compose no disponible. Actualiza Docker Desktop." -ForegroundColor Red
    exit 1
}
Write-Host "✅ Docker y Docker Compose disponibles" -ForegroundColor Green

# 2. Verificar .env
if (-not (Test-Path ".env")) {
    Write-Host "📋 Copiando .env.example → .env" -ForegroundColor Yellow
    Copy-Item .env.example .env
    Write-Host "⚠️  EDITA .env AHORA con tus datos (nichos, YouTube OAuth, etc.)" -ForegroundColor Yellow
    Write-Host "   Luego vuelve a ejecutar .\deploy.ps1" -ForegroundColor Yellow
    exit 0
}
Write-Host "✅ .env encontrado" -ForegroundColor Green

# 3. Crear directorios de datos
$dirs = @("data/ollama", "data/voices", "data/backgrounds", "data/output")
foreach ($d in $dirs) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
}

# 4. Descargar modelo Piper si no existe
$piperModel = "data/voices/es_ES-sharvard-medium.onnx"
if (-not (Test-Path $piperModel)) {
    Write-Host "📥 Descargando modelo Piper (voz español)..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path "data/voices" | Out-Null
    Invoke-WebRequest -Uri "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx" -OutFile $piperModel
    Invoke-WebRequest -Uri "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx.json" -OutFile "$piperModel.json"
    Write-Host "✅ Modelo Piper descargado" -ForegroundColor Green
} else {
    Write-Host "✅ Modelo Piper ya existe" -ForegroundColor Green
}

# 5. Generar fondo de prueba si no existe
$background = "data/backgrounds/default.mp4"
if (-not (Test-Path $background)) {
    Write-Host "🎨 Generando fondo de prueba..." -ForegroundColor Yellow
    docker run --rm -v "${PWD}/data/backgrounds:/out" `
           ghcr.io/linuxserver/ffmpeg:latest `
           -y -f lavfi -i "color=c=0x07111F:s=1080x1920:r=30" `
           -vf "noise=alls=6:allf=t+u,format=yuv420p" `
           -t 60 -an -c:v libx264 -preset veryfast -crf 24 -movflags +faststart `
           /out/default.mp4
    Write-Host "✅ Fondo generado" -ForegroundColor Green
} else {
    Write-Host "✅ Fondo ya existe" -ForegroundColor Green
}

# 6. Build y arranque
Write-Host "🔨 Construyendo imagen Docker..." -ForegroundColor Cyan
docker compose build

Write-Host "🚀 Levantando contenedor..." -ForegroundColor Cyan
docker compose up -d

# 7. Esperar healthcheck
Write-Host "⏳ Esperando a que el servicio esté sano (máx 2 min)..." -ForegroundColor Yellow
for ($i = 1; $i -le 24; $i++) {
    $status = docker compose ps --format "table {{.Status}}"
    if ($status -match "healthy") {
        Write-Host "✅ Servicio sano y corriendo" -ForegroundColor Green
        break
    }
    Start-Sleep 5
    if ($i -eq 24) {
        Write-Host "⚠️  Healthcheck no pasó. Revisa logs: docker compose logs -f" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  🎉 DESPLIEGUE COMPLETADO                                  ║" -ForegroundColor Cyan
Write-Host "╠═══════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
Write-Host "║  Contenedor: faceless-shorts                               ║" -ForegroundColor White
Write-Host "║  Logs:       docker compose logs -f                        ║" -ForegroundColor White
Write-Host "║  Parar:      docker compose down                           ║" -ForegroundColor White
Write-Host "║  Reiniciar:  docker compose restart                        ║" -ForegroundColor White
Write-Host "║                                                            ║" -ForegroundColor White
Write-Host "║  📋 PRÓXIMOS PASOS MANUALES:                               ║" -ForegroundColor Yellow
Write-Host "║  1. Edita .env con tu nicho y credenciales YouTube        ║" -ForegroundColor White
Write-Host "║  2. Ejecuta OAuth: docker compose exec shorts-bot \       ║" -ForegroundColor White
Write-Host "║       node scripts/get-youtube-token.js                    ║" -ForegroundColor White
Write-Host "║  3. Pega YOUTUBE_REFRESH_TOKEN en .env y reinicia:        ║" -ForegroundColor White
Write-Host "║       docker compose restart                               ║" -ForegroundColor White
Write-Host "║  4. Pon DRY_RUN=false en .env cuando estés listo          ║" -ForegroundColor White
Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan