# Canal Automatizado de Shorts/Reels

Backend en Node.js para ejecutar todos los días este flujo:

1. OpenAI genera un guion nuevo de 45-60 segundos, título, descripción y etiquetas mediante JSON Schema.
2. ElevenLabs genera la voz en off MP3 y devuelve la alineación temporal de cada carácter.
3. FFmpeg repite un fondo vertical, mezcla el audio y quema subtítulos ASS sincronizados con resaltado por palabra.
4. El mismo MP4 se publica en YouTube, TikTok e Instagram Reels.

El diseño evita ejecuciones solapadas, conserva los artefactos de cada intento y valida que la locución no se salga de la duración permitida.

## Antes de nada: el nicho decide cuánto entra

El RPM de los Shorts no depende de la calidad del vídeo, depende de **quién compra los anuncios que se muestran al lado**. Finanzas, B2B, herramientas de software y seguros pagan bastante mas que el entretenimiento o las curiosidades, que son los nichos con menos ingresos. La diferencia entre nichos es de 5 a 20 veces, y los nichos de alto RPM son además los únicos que reciben patrocinios directos.

El sistema no impone el nicho: se define en `CONTENT_NICHE`. Lo que sí hace es guardar todo en `output/history.json` e inyectar los temas ya publicados en el prompt, porque un canal que repite el mismo tema corre riesgo de desmonetización bajo la política de contenido repetitivo de YouTube.

## Requisitos

- Node.js 22 o superior y npm.
- **Modo cloud (por defecto):** API key de OpenAI + API key de ElevenLabs.
- **Modo local gratis (opcional):** Ollama + modelo LLM + Piper TTS + modelo de voz `.onnx`.
- Varios vídeos verticales sin derechos restringidos en `assets/backgrounds/` (el sistema rota entre ellos).
- Para publicar: un proyecto de Google Cloud con YouTube Data API v3 y credenciales OAuth 2.0.
- Opcional: TikTok for Developers con la *Content Posting API* aprobada, y una cuenta de Instagram Business/Creator con una URL pública desde la que descargar el MP4.

`ffmpeg-static` y `ffprobe-static` incluyen binarios para el sistema actual, por lo que normalmente no hace falta instalar FFmpeg manualmente.

## Estructura

```text
.
├── assets/
│   ├── backgrounds/
│   │   ├── default.mp4          # Fondo vertical con licencia
│   │   └── README.md
│   └── voices/                  # Modelos Piper .onnx + .onnx.json (modo local)
├── output/                     # Un directorio por ejecucion + history.json
├── scripts/
│   ├── create-demo-background.js
│   ├── doctor.js
│   └── get-youtube-token.js
├── src/
│   ├── config.js
│   ├── pipeline.js
│   ├── services/
│   │   ├── elevenlabs.js
│   │   ├── instagram.js
│   │   ├── ollama.js
│   │   ├── openai.js
│   │   ├── piper.js
│   │   ├── publisher.js         # Reparte el MP4 entre las plataformas activas
│   │   ├── tiktok.js
│   │   ├── video.js
│   │   └── youtube.js
│   └── utils/
│       ├── ass.js               # Subtitulos ASS con estilo y resaltado
│       ├── backgrounds.js       # Descubrimiento y rotacion de clips
│       ├── history.js           # Anti-repeticion
│       └── subtitles.js
├── test/
│   ├── ass.test.js
│   ├── history.test.js
│   ├── subtitles.test.js
│   └── video.test.js
├── .env.example
├── .gitignore
├── index.js
└── package.json
```

## 1. Instalación

```bash
npm install
```

Copia la plantilla de configuración:

```bash
# Windows PowerShell
Copy-Item .env.example .env

# macOS/Linux
cp .env.example .env
```

Edita `.env` y cambia, como mínimo:

```dotenv
CONTENT_NICHE=curiosidades del espacio
OPENAI_API_KEY=tu_clave
ELEVENLABS_API_KEY=tu_clave
ELEVENLABS_VOICE_ID=id_de_la_voz
DRY_RUN=true
```

El nicho, idioma, audiencia, tono, palabras y horario son configurables; no es necesario editar codigo para cambiar el tema del canal.

### OpenAI

1. Crea una API key en la plataforma de OpenAI.
2. Comprueba que la cuenta tenga facturacion y limites disponibles.
3. Usa `gpt-4o` como valor inicial de `OPENAI_MODEL`; también puedes seleccionar otro modelo GPT-4 compatible con Structured Outputs.

El servicio usa la **Responses API** con `strict: true`. Valida entre 120 y 140 palabras por defecto y reintenta hasta tres veces si el resultado no cumple el formato.

### ElevenLabs

1. Crea una API key en ElevenLabs.
2. Abre el selector de voces y copia el **Voice ID** de la voz que quieras usar.
3. Mantén `eleven_multilingual_v2` para un guion en español, o cambia `ELEVENLABS_MODEL_ID` por otro modelo habilitado para tu cuenta.

ElevenLabs devuelve el MP3 en Base64 y las marcas `character_start_times_seconds` y `character_end_times_seconds`. Esas marcas alimentan el SRT; no se pierde precisión al convertir a subtítulos.

### Modo 100 % gratis: Ollama + Piper (alternativa local)

Si no quieres pagar APIs, puedes ejecutar todo en local:

1. **Instala Ollama** y descarga un modelo compatible con JSON Schema (Ollama ≥ 0.5):
   ```bash
   curl -fsSL https://ollama.com/install.sh | sh
   ollama pull llama3.1:8b        # o gemma2:9b, qwen2.5:7b, etc.
   ```
   El servicio usa `/api/generate` con `format: <JSON Schema>` y `stream: false`.

2. **Instala Piper TTS** y descarga una voz en español:
   ```bash
   # Linux (Debian/Ubuntu)
   sudo apt install -y piper-tts
   # O descarga el binario desde https://github.com/rhasspy/piper/releases
   mkdir -p assets/voices
   cd assets/voices
   wget https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx
   wget https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx.json
   ```

3. **Activa el modo local** en `.env`:
   ```dotenv
   USE_LOCAL_AI=true
   OLLAMA_MODEL=llama3.1:8b
   PIPER_MODEL=assets/voices/es_ES-sharvard-medium.onnx
   # OPENAI_API_KEY y ELEVENLABS_API_KEY ya no son obligatorios
   ```

4. **Requisitos de hardware**: 8 GB RAM + 4 GB disco para modelos. En Oracle Cloud Free Tier (ARM 4 OCPU / 24 GB) funciona holgado.

> **Nota**: La calidad de guion/voz es inferior a GPT-4o + ElevenLabs, pero suficiente para shorts evergreen. Puedes alternar modos cambiando `USE_LOCAL_AI` sin tocar código.

### Fondo de video

Coloca un MP4 con licencia en:

```text
assets/backgrounds/default.mp4
```

Recomendado: H.264, 1080x1920, 30 fps y al menos 60 segundos. El montaje hace crop central y repite el archivo con `-stream_loop -1`.

Para comprobar la instalación sin aportar material propio:

```bash
npm run background:demo
```

Esto crea un fondo abstracto animado de prueba. No debe usarse como material definitivo si no coincides con los requisitos visuales o legales del canal.

## 2. Validación local sin publicar

Mantén:

```dotenv
DRY_RUN=true
```

Y ejecuta una vez de forma inmediata:

```bash
npm run generate-now
```

El flujo genera `content.json`, `voice.mp3`, `subtitles.srt`, `subtitles.ass`, `short.mp4` y `result.json` dentro de un nuevo directorio de `output/`. No llamará a YouTube.

Prueba las utilidades sin gastar APIs:

```bash
npm test
```

## 3. Configurar YouTube Data API v3

1. Crea o selecciona un proyecto en Google Cloud.
2. Ve a **APIs & Services > Library**, habilita **YouTube Data API v3** y configura la facturacion si Google lo requiere.
3. Configura la pantalla de consentimiento OAuth. Para una cuenta personal puedes usar la app en modo de pruebas y agregar tu propia cuenta de Google como usuario de prueba.
4. En **APIs & Services > Credentials**, crea un **OAuth Client ID** de tipo **Desktop app**.
5. Usa esta URI de redireccion exacta tanto en Google como en `.env`:

   ```dotenv
   YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth2/callback
   ```

6. Completa las credenciales:

   ```dotenv
   YOUTUBE_CLIENT_ID=...apps.googleusercontent.com
   YOUTUBE_CLIENT_SECRET=...
   YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth2/callback
   ```

7. Genera el refresh token:

   ```bash
   npm run youtube:auth
   ```

8. Abre la URL mostrada, selecciona la cuenta del canal, autoriza y pega en la terminal el codigo o la URL de redireccion. Copia la linea `YOUTUBE_REFRESH_TOKEN=...` a `.env`.

El alcance solicitado es deliberadamente reducido a `youtube.upload`. Para una cuenta de marca, selecciona esa cuenta durante OAuth. `YOUTUBE_ACCESS_TOKEN` existe para pruebas manuales, pero caduca; no es la opción adecuada para el piloto automático diario.

## 4. Publicar en YouTube

Después de revisar varios videos locales:

```dotenv
DRY_RUN=false
YOUTUBE_PRIVACY=unlisted
```

`YOUTUBE_PRIVACY` admite `private`, `unlisted` o `public`. Para validar la integración sin exponer el contenido al público, deja `unlisted`; cambia a `public` solo cuando el flujo y los derechos del material estén confirmados.

Variables utiles:

```dotenv
YOUTUBE_CATEGORY_ID=27
YOUTUBE_DEFAULT_TAGS=shorts,curiosidades,espacio
YOUTUBE_DESCRIPTION_FOOTER=Contenido generado con asistencia de inteligencia artificial.
YOUTUBE_MADE_FOR_KIDS=false
YOUTUBE_EMBEDDABLE=true
YOUTUBE_PLAYLIST_ID=
```

- `YOUTUBE_CATEGORY_ID=27` corresponde a Education.
- `YOUTUBE_MADE_FOR_KIDS` es una declaración responsable; configúrala según el contenido real.
- `YOUTUBE_PLAYLIST_ID` es opcional.
- Las etiquetas generadas por IA se combinan con las predeterminadas y se limitan a 500 caracteres.

## 5. Programar una ejecución diaria

`index.js` usa `node-cron`. Ejemplos de expresion:

```dotenv
# 10:00 todos los dias
CRON_SCHEDULE=0 10 * * *

# 18:30 de lunes a viernes
CRON_SCHEDULE=30 18 * * 1-5
```

La zona horaria se controla por separado y evita depender de la zona del servidor:

```dotenv
CRON_TIMEZONE=America/Mexico_City
```

Arranca el servicio:

```bash
npm start
```

Desarrollo con reinicio al cambiar archivos:

```bash
npm run dev
```

Opciones de arranque:

```dotenv
RUN_ON_START=false
DRY_RUN=false
```

- `RUN_ON_START=true` hace una ejecucion al arrancar y continua luego con el cron.
- `node-cron` usa `noOverlap: true`; si una ejecucion sigue activa cuando llega otra, omite la nueva.
- Mantener el proceso activo es indispensable. En un servidor, conviene administrarlo con systemd, PM2 o el servicio de su proveedor.
- Si el equipo estaba apagado a la hora programada, no se recupera esa ejecucion al volver a encenderlo.

## Variables de entorno

Las variables estan documentadas y agrupadas en `.env.example`. Las principales son:

| Grupo | Variables |
| --- | --- |
| Canal | `CONTENT_NICHE`, `CONTENT_LANGUAGE`, `TARGET_AUDIENCE`, `TONE`, `CONTENT_GUARDRAILS` |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL`, limites de palabras/segundos |
| ElevenLabs | API key, voice/model ID, estabilidad, similitud, estilo, velocidad |
| **Local AI (gratis)** | `USE_LOCAL_AI`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TEMPERATURE`, `OLLAMA_MAX_TOKENS`, `PIPER_BINARY`, `PIPER_MODEL`, `PIPER_LENGTH_SCALE`, `PIPER_NOISE_SCALE`, `PIPER_NOISE_W`, `PIPER_SAMPLE_RATE` |
| Video | `BACKGROUND_FILE`, dimensiones, FPS, CRF, preset y estilos de subtitulo |
| Cron | `CRON_SCHEDULE`, `CRON_TIMEZONE`, `RUN_ON_START` |
| YouTube | OAuth, privacidad, categoria, etiquetas, playlist y contenido para ninos |
| Ejecucion | `DRY_RUN`, `OUTPUT_DIR`, rutas opcionales de FFmpeg/FFprobe |

## Salidas y diagnostico

Cada intento crea una carpeta con nombre timestamp, por ejemplo:

```text
output/20260925T140000-AbCd12/
├── content.json
├── voice.mp3
├── subtitles.srt
├── subtitles.ass
├── short.mp4
└── result.json
```

`subtitles.srt` es la referencia legible; `subtitles.ass` es el que se quema en el video. El ASS lleva el estilo embebido y el resaltado palabra a palabra, y es necesario porque el filtro `subtitles` de FFmpeg ignora `Alignment` cuando se le pasa un SRT con `force_style`, dejando los subtitulos anclados arriba a la izquierda en lugar de abajo al centro.

Si una etapa falla, se genera `error.json` con la etapa, el mensaje y los timestamps. Los archivos parciales no se borran para poder diagnosticar el problema.

## Publicar en varias plataformas a la vez

Un mismo MP4 en varias plataformas multiplica el alcance sin coste de producción: es la palanca de ingresos más grande que no depende del nicho. Las tres son opcionales e independientes, y cada una se activa por separado.

| Plataforma | Variable | Requisito que no es negociable |
| --- | --- | --- |
| YouTube | `DRY_RUN=false` | Proyecto OAuth con la *YouTube Data API v3* habilitada. |
| TikTok | `TIKTOK_ENABLED=true` | Aprobar la *Content Posting API* en TikTok for Developers. Sin aprobación, la API responde 403. |
| Instagram | `INSTAGRAM_ENABLED=true` | Cuenta Business/Creator vinculada a una Fan Page **y** `IG_REELS_URL_BASE` servida por HTTP público, porque Instagram descarga el MP4 desde esa URL en lugar de leer tu disco. |

Los fallos están aislados: si TikTok rechaza la subida, el Short sigue saliendo por YouTube e Instagram, y el resultado queda registrado en `result.json` con el detalle por plataforma. Así una caída de red a media ejecución no tira abajo el trabajo del día.

## Monetización: lo que este sistema no hace

Conviene decirlo claro, porque es donde suelen crear expectativas falsas:

- El código genera y publica el contenido. **No genera ingresos por sí solo.** El dinero aparece cuando se acumulan las condiciones de la plataforma (para YouTube Shorts, 1.000 suscriptores y 10 millones de Shorts vistos en 90 días).
- Con un solo vídeo al día, llegar a ese umbral tarda meses. Lo que acelera la facturación no es el vídeo, es el nicho, el número de canales y las plataformas.
- YouTube desmonetiza el contenido repetitivo generado en masa. Por eso el sistema lleva registro de temas y te avisa cuando solo tienes un fondo: publicar lo mismo con otro título no cuenta como contenido nuevo.

```bash
npm run doctor   # comprueba claves, fondos, plataformas y permisos antes de la primera publicación
```

## Puesta en marcha

1. Copia y rellena las tres claves marcadas `TODO` en `.env`:
   `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` y `ELEVENLABS_VOICE_ID`.
2. Comprueba que todo responde: `npm run doctor`.
3. Genera un Short de prueba sin publicar: `npm run generate-now`.
   Revísalo en `output/<timestamp>/short.mp4`. **Míralo antes de seguir.**
4. Autoriza YouTube: `npm run youtube:auth` y pega el `YOUTUBE_REFRESH_TOKEN`.
5. Pon `DRY_RUN=false` cuando confíes en lo que genera, y lanza el proceso
   permanente: `npm start` o `docker compose up -d`.

### Los fondos vienen incluidos

`assets/backgrounds/` trae seis clips abstractos generados con FFmpeg
(`npm run backgrounds:generate`). Son originales y no tienen problemas de
derechos, pero son un punto de partida, no material de archivo. Sustitúyelos
por b-roll vertical con licencia en cuanto puedas: es lo que más retiene y lo
que separa un canal que crece de uno que se queda en 200 vistas.

## Consideraciones operativas

- `node-cron` programa dentro del proceso; no ofrece garantías exactly-once. Esta base evita solapamientos locales, pero no coordina varias copias del servicio. Para varias réplicas usa un orquestador de trabajos o un coordinador externo.
- El proceso debe seguir vivo a la hora del cron. `npm start` en primer plano no sobrevive a un reinicio del equipo: para producción usa `docker compose up -d`, que ya viene con `restart: unless-stopped`.
- YouTube puede limitar la subida de proyectos OAuth no verificados. Revisa las cuotas y la situacion de verificacion de tu proyecto.
- Usa solo fondos, musica y recursos con licencia. Los Shorts reutilizables siguen sujetos a copyright, aunque el canal sea faceless.
- Revisa las obligaciones de divulgacion de contenido sintetico o generado con IA aplicables a tu cuenta y localization.
- Para noticias, finanzas o afirmaciones cambiantes, anade una etapa de fuentes/fact-check antes de publicar: la base evita inventar datos, pero no realiza verificacion externa automatica.
- Protege `.env`, refresh tokens y videos no publicados. `.gitignore` ya excluye `.env` y `output/`.
