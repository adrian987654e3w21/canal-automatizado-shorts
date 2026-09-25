# 🚀 Guía Rápida de Despliegue - Canal Automatizado Shorts

> **Todo en un contenedor Docker** (Node + Ollama + Piper)  
> **Coste: 0 €/mes** (Oracle Cloud Free Tier, VPS propio, o tu PC)

---

## 📋 Requisitos previos (5 min)

| Qué | Enlace |
|-----|--------|
| **Docker Desktop** (Win/Mac) o **Docker Engine + Compose** (Linux) | https://docs.docker.com/get-docker/ |
| **Cuenta Google** (para YouTube + Google Cloud) | https://accounts.google.com |
| **Terminal** (PowerShell en Windows, bash en Linux/Mac) | — |

---

## ⚡ Despliegue en 3 comandos

### Windows (PowerShell como Administrador)
```powershell
git clone https://github.com/TU_USUARIO/canal-automatizado.git
cd canal-automatizado
.\deploy.ps1
```

### Linux / macOS / WSL / VPS
```bash
git clone https://github.com/TU_USUARIO/canal-automatizado.git
cd canal-automatizado
chmod +x deploy.sh
./deploy.sh
```

> El script:
> 1. Verifica Docker
> 2. Crea `.env` si no existe
> 3. Descarga modelo Piper (voz español)
> 4. Genera fondo de prueba
> 5. Hace `docker compose build && docker compose up -d`
> 6. Espera healthcheck

---

## 🔧 Configuración OBLIGATORIA (hazlo AHORA)

### 1. Edita `.env` con tu nicho
```dotenv
CONTENT_NICHE=curiosidades del espacio   # ← CAMBIA ESTO a tu tema
USE_LOCAL_AI=true
DRY_RUN=true
```

### 2. YouTube OAuth (solo la primera vez)
```bash
# Abre terminal dentro del contenedor
docker compose exec shorts-bot node scripts/get-youtube-token.js
```
- Se abre URL en tu navegador → elige tu canal → **Permitir**
- Copia el código → pégalo en la terminal
- Copia la línea `YOUTUBE_REFRESH_TOKEN=...` a tu `.env` local

### 3. Reinicia para aplicar el token
```bash
docker compose restart
```

### 4. Prueba una generación manual
```bash
docker compose exec shorts-bot node index.js --now
```
Revisa el MP4 en `data/output/<timestamp>/short.mp4`

### 5. Cuando te guste el resultado → publica
```dotenv
# En .env
DRY_RUN=false
YOUTUBE_PRIVACY=unlisted   # o private/public
```
```bash
docker compose restart
docker compose exec shorts-bot node index.js --now
```
Verifica en [YouTube Studio → Contenido → Shorts](https://studio.youtube.com/channel/UC/videos?filter=shorts)

---

## 🕐 Programación automática (ya está en `.env`)
```dotenv
CRON_SCHEDULE=0 10 * * *        # 10:00 cada día
CRON_TIMEZONE=America/Mexico_City
RUN_ON_START=false
```
El cron corre **dentro del contenedor** sin tocar el host.

---

## 📁 Datos persistentes (volúmenes Docker)

| Volumen | Qué guarda | En host |
|---------|------------|---------|
| `ollama_models` | Modelos LLM descargados | `docker volume inspect faceless-shorts_ollama_models` |
| `piper_voices` | Modelos `.onnx` de voz | `data/voices/` (bind mount) |
| `backgrounds` | Fondos de video | `data/backgrounds/` (bind mount) |
| `output` | Shorts generados | `data/output/` (bind mount) |

**Backup**: copia la carpeta `data/` entera.

---

## 🖥️ Dónde ejecutarlo GRATIS 24/7

| Opción | Specs | Cómo |
|--------|-------|------|
| **Oracle Cloud Free Tier** (recomendado) | 4 ARM OCPU, 24 GB RAM, 200 GB disco | Crear VM Ubuntu 22.04 ARM → SSH → `./deploy.sh` |
| **Tu PC/portátil** | Lo que tengas | Deja Docker Desktop abierto |
| **VPS barato** (Hetzner CX22, DigitalOcean) | 2 vCPU, 4 GB RAM, ~€4/mes | Igual que Oracle |
| **GitHub Codespaces** | 2 vCPU, 8 GB RAM, 60 h/mes gratis | Abre repo → Terminal → `./deploy.sh` |

> **Mínimo recomendado**: 4 GB RAM libres + 10 GB disco para modelos.

---

## 🔧 Comandos útiles día a día

```bash
# Ver logs en tiempo real
docker compose logs -f

# Parar todo
docker compose down

# Reiniciar (tras cambiar .env)
docker compose restart

# Generar UN short ahora (fuera del cron)
docker compose exec shorts-bot node index.js --now

# Entrar al contenedor (debug)
docker compose exec shorts-bot bash

# Actualizar imagen (tras git pull)
docker compose build --no-cache && docker compose up -d

# Ver estado y healthcheck
docker compose ps
```

---

## 🔄 Cambiar a modo Cloud (OpenAI + ElevenLabs)
Edita `.env`:
```dotenv
USE_LOCAL_AI=false
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
```
```bash
docker compose restart
```
**Sin tocar código ni reconstruir imagen.**

---

## ❗ Solución de problemas

| Síntoma | Causa | Solución |
|---------|-------|----------|
| `Healthcheck failed` | Ollama tarda en bajar modelo | `docker compose logs -f` → espera a `pulling llama3.1:8b... done` |
| `PIPER_MODEL not found` | Modelo voz no descargado | `./deploy.sh` lo baja auto, o manual: `wget -P data/voices https://huggingface.co/.../es_ES-sharvard-medium.onnx` |
| `YouTube 403/quota` | Cuota diaria agotada / OAuth mal | Verifica `YOUTUBE_REFRESH_TOKEN` en `.env` → `docker compose restart` |
| `No space left` | Disco lleno | `docker system prune -a` + borra `data/output/` antiguos |
| `Out of memory` | RAM insuficiente | Aumenta `memory` en `docker-compose.yml` o usa modelo menor (`gemma2:2b`) |

---

## 📞 Soporte

1. **Logs**: `docker compose logs -f shorts-bot`
2. **Errores guardados**: cada ejecución fallida crea `data/output/<timestamp>/error.json`
3. **Revisa `.env`**: 90% de problemas son variables mal puestas

---

## ✅ Checklist final antes de dormir tranquilo

- [ ] Canal YouTube creado y **verificado por SMS**
- [ ] Google Cloud: YouTube Data API v3 habilitada + OAuth Desktop + usuario de prueba = tu email
- [ ] `.env` tiene: `CONTENT_NICHE`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`
- [ ] `DRY_RUN=false` y `YOUTUBE_PRIVACY=unlisted` (o `public`)
- [ ] `docker compose ps` muestra `healthy`
- [ ] Probaste `docker compose exec shorts-bot node index.js --now` y subió a YouTube
- [ ] Cron programado en `.env` (`CRON_SCHEDULE`, `CRON_TIMEZONE`)
- [ ] Backup de carpeta `data/` automatizado (cron host, rclone, etc.)

---

**¡Listo!** Tu canal genera y publica shorts cada día sin que muevas un dedo. 🎬