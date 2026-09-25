import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT_DIR = resolve(fileURLToPath(new URL('../', import.meta.url)));

dotenv.config({ path: resolve(ROOT_DIR, '.env') });

const env = process.env;
const missing = [];

function optional(name, fallback = '') {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? fallback : value;
}

function required(name) {
  const value = env[name]?.trim() ?? '';
  if (!value) missing.push(name);
  return value;
}

function integer(name, fallback, { min, max } = {}) {
  const raw = optional(name);
  if (raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || (min !== undefined && value < min) || (max !== undefined && value > max)) {
    throw new Error(`${name} debe ser un entero${min === undefined ? '' : ` entre ${min} y ${max}`}.`);
  }
  return value;
}

function number(name, fallback, { min, max } = {}) {
  const raw = optional(name);
  if (raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || (min !== undefined && value < min) || (max !== undefined && value > max)) {
    throw new Error(`${name} debe ser un numero${min === undefined ? '' : ` entre ${min} y ${max}`}.`);
  }
  return value;
}

function boolean(name, fallback = false) {
  const raw = optional(name).toLowerCase();
  if (raw === '') return fallback;
  if (['1', 'true', 'yes', 'si', 'sí'].includes(raw)) return true;
  if (['0', 'false', 'no'].includes(raw)) return false;
  throw new Error(`${name} debe ser true o false.`);
}

function list(name) {
  return optional(name)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function fromRoot(value) {
  return isAbsolute(value) ? value : resolve(ROOT_DIR, value);
}

const dryRun = boolean('DRY_RUN', true);
const useLocalAI = boolean('USE_LOCAL_AI', false);
const minScriptSeconds = number('MIN_SCRIPT_SECONDS', 45, { min: 10, max: 700 });
const maxScriptSeconds = number('MAX_SCRIPT_SECONDS', 60, { min: 10, max: 700 });
const minScriptWords = integer('SCRIPT_MIN_WORDS', 120, { min: 20, max: 2000 });
const maxScriptWords = integer('SCRIPT_MAX_WORDS', 140, { min: 20, max: 2000 });

const cronSchedule = optional('CRON_SCHEDULE', '0 10 * * *');
const cronTimezone = optional('CRON_TIMEZONE', 'UTC');
const backgroundDir = fromRoot(optional('BACKGROUND_DIR', 'assets/backgrounds'));
const explicitBackgrounds = list('BACKGROUND_FILES').map(fromRoot);
const singleBackground = optional('BACKGROUND_FILE') ? fromRoot(optional('BACKGROUND_FILE')) : null;
const outputDir = fromRoot(optional('OUTPUT_DIR', 'output'));

const config = {
  rootDir: ROOT_DIR,
  dryRun,
  cron: {
    schedule: cronSchedule,
    timezone: cronTimezone,
    runOnStart: boolean('RUN_ON_START', false),
  },
  content: {
    niche: required('CONTENT_NICHE'),
    language: optional('CONTENT_LANGUAGE', 'es-ES'),
    audience: optional('TARGET_AUDIENCE', 'una audiencia general'),
    tone: optional('TONE', 'directo, claro y entretenido'),
    guardrails: optional(
      'CONTENT_GUARDRAILS',
      'No inventes hechos ni cifras. Evita enganos, clickbait y afirmaciones no verificables.',
    ),
  },
  openai: {
    apiKey: useLocalAI ? optional('OPENAI_API_KEY') : optional('OPENAI_API_KEY'),
    baseUrl: optional('OPENAI_BASE_URL'),
    model: optional('OPENAI_MODEL', 'gpt-4o'),
    script: {
      minWords: minScriptWords,
      maxWords: maxScriptWords,
      minSeconds: minScriptSeconds,
      maxSeconds: maxScriptSeconds,
    },
  },
  groq: {
    apiKey: optional('GROQ_API_KEY'),
    model: optional('GROQ_MODEL', 'llama-3.3-70b-versatile'),
  },
  elevenlabs: {
    apiKey: useLocalAI ? optional('ELEVENLABS_API_KEY') : required('ELEVENLABS_API_KEY'),
    voiceId: useLocalAI ? optional('ELEVENLABS_VOICE_ID') : required('ELEVENLABS_VOICE_ID'),
    modelId: optional('ELEVENLABS_MODEL_ID', 'eleven_multilingual_v2'),
    apiBaseUrl: optional('ELEVENLABS_API_BASE_URL', 'https://api.elevenlabs.io').replace(/\/+$/, ''),
    outputFormat: optional('ELEVENLABS_OUTPUT_FORMAT', 'mp3_44100_128'),
    voiceSettings: {
      stability: number('ELEVENLABS_STABILITY', 0.5, { min: 0, max: 1 }),
      similarityBoost: number('ELEVENLABS_SIMILARITY_BOOST', 0.75, { min: 0, max: 1 }),
      style: number('ELEVENLABS_STYLE', 0, { min: 0, max: 1 }),
      speed: number('ELEVENLABS_SPEED', 1, { min: 0.7, max: 1.2 }),
      useSpeakerBoost: boolean('ELEVENLABS_USE_SPEAKER_BOOST', true),
    },
  },
  media: {
    // Rotacion de fondos: si BACKGROUND_FILES esta vacio se escanea el directorio.
    backgroundsDir: backgroundDir,
    backgroundFiles: explicitBackgrounds,
    backgroundFile: singleBackground,
    rotateBackgrounds: boolean('BACKGROUND_ROTATION', true),
    outputDir,
    ffmpegPath: optional('FFMPEG_PATH') || null,
    ffprobePath: optional('FFPROBE_PATH') || null,
    video: {
      width: integer('VIDEO_WIDTH', 1080, { min: 240, max: 3840 }),
      height: integer('VIDEO_HEIGHT', 1920, { min: 240, max: 3840 }),
      fps: integer('VIDEO_FPS', 30, { min: 20, max: 60 }),
      crf: integer('VIDEO_CRF', 20, { min: 0, max: 51 }),
      preset: optional('VIDEO_PRESET', 'medium'),
    },
    subtitles: {
      maxCharacters: integer('SUBTITLE_MAX_CHARACTERS', 40, { min: 20, max: 80 }),
      maxDurationSeconds: number('SUBTITLE_MAX_DURATION_SECONDS', 3.2, { min: 1, max: 8 }),
      maxWords: integer('SUBTITLE_MAX_WORDS', 8, { min: 2, max: 16 }),
      font: optional('SUBTITLE_FONT', 'Arial'),
      // El ASS declara PlayResX/PlayResY iguales al video, asi que el tamano es
      // en pixeles reales: 84 px sobre 1080x1920 es el rango legible de Shorts.
      fontSize: integer('SUBTITLE_FONT_SIZE', 84, { min: 8, max: 200 }),
      color: optional('SUBTITLE_COLOR', '#FFFFFF'),
      highlightColor: optional('SUBTITLE_HIGHLIGHT_COLOR', '#FFD400'),
      outlineColor: optional('SUBTITLE_OUTLINE_COLOR', '#000000'),
      outline: integer('SUBTITLE_OUTLINE', 5, { min: 0, max: 20 }),
      shadow: integer('SUBTITLE_SHADOW', 2, { min: 0, max: 20 }),
      bold: boolean('SUBTITLE_BOLD', true),
      karaoke: boolean('SUBTITLE_KARAOKE', true),
      // 1 = abajo centro, 2 = abajo izquierda, 5 = centro, 8 = arriba centro.
      alignment: integer('SUBTITLE_ALIGNMENT', 2, { min: 1, max: 9 }),
      marginL: integer('SUBTITLE_MARGIN_L', 90, { min: 0, max: 1000 }),
      marginR: integer('SUBTITLE_MARGIN_R', 90, { min: 0, max: 1000 }),
      marginV: integer('SUBTITLE_MARGIN_V', 300, { min: 0, max: 1000 }),
      // Las fuentes se resuelven con las del sistema; no hay carpeta de fuentes
      // propia configurable a proposito (rompia el filtergraph de ffmpeg).
    },
  },
  history: {
    file: optional('HISTORY_FILE', 'history.json'),
    maxEntries: integer('HISTORY_MAX_ENTRIES', 120, { min: 10, max: 5000 }),
  },
  tiktok: {
    enabled: boolean('TIKTOK_ENABLED', false),
    accessToken: optional('TIKTOK_ACCESS_TOKEN'),
    privacyLevel: optional('TIKTOK_PRIVACY_LEVEL', 'SELF_ONLY'),
    titleMaxLength: integer('TIKTOK_TITLE_MAX', 2200, { min: 100, max: 2200 }),
    maxBytes: integer('TIKTOK_MAX_BYTES', 4_096_000_000, { min: 1_000_000 }),
    timeoutMs: integer('TIKTOK_TIMEOUT_MS', 300_000, { min: 10_000 }),
    descriptionFooter: optional('TIKTOK_DESCRIPTION_FOOTER'),
  },
  instagram: {
    enabled: boolean('INSTAGRAM_ENABLED', false),
    userId: optional('INSTAGRAM_USER_ID'),
    accessToken: optional('INSTAGRAM_ACCESS_TOKEN'),
    publicVideoBaseUrl: optional('IG_REELS_URL_BASE'),
    slug: optional('IG_REELS_SLUG', 'short'),
    graphVersion: optional('IG_GRAPH_VERSION', '21.0'),
    captionMaxLength: integer('IG_CAPTION_MAX', 2200, { min: 100, max: 2200 }),
    shareToFeed: boolean('IG_SHARE_TO_FEED', true),
    timeoutMs: integer('IG_TIMEOUT_MS', 60_000, { min: 10_000 }),
    descriptionFooter: optional('IG_DESCRIPTION_FOOTER'),
  },
  youtube: {
    clientId: optional('YOUTUBE_CLIENT_ID'),
    clientSecret: optional('YOUTUBE_CLIENT_SECRET'),
    refreshToken: optional('YOUTUBE_REFRESH_TOKEN'),
    redirectUri: optional('YOUTUBE_REDIRECT_URI', 'http://localhost:3000/oauth2/callback'),
    accessToken: optional('YOUTUBE_ACCESS_TOKEN'),
    privacy: optional('YOUTUBE_PRIVACY', 'unlisted'),
    categoryId: optional('YOUTUBE_CATEGORY_ID', '27'),
    defaultTags: list('YOUTUBE_DEFAULT_TAGS'),
    descriptionFooter: optional('YOUTUBE_DESCRIPTION_FOOTER'),
    madeForKids: boolean('YOUTUBE_MADE_FOR_KIDS', false),
    embeddable: boolean('YOUTUBE_EMBEDDABLE', true),
    playlistId: optional('YOUTUBE_PLAYLIST_ID'),
  },
  localAI: {
    enabled: boolean('USE_LOCAL_AI', false),
    ollama: {
      baseUrl: optional('OLLAMA_BASE_URL', 'http://localhost:11434').replace(/\/+$/, ''),
      model: optional('OLLAMA_MODEL', 'llama3.1:8b'),
      temperature: number('OLLAMA_TEMPERATURE', 0.7, { min: 0, max: 2 }),
      maxTokens: integer('OLLAMA_MAX_TOKENS', 1800, { min: 500, max: 8000 }),
    },
    piper: {
      binary: optional('PIPER_BINARY', 'piper'),
      model: optional('PIPER_MODEL', ''),
      lengthScale: number('PIPER_LENGTH_SCALE', 1.0, { min: 0.5, max: 2 }),
      noiseScale: number('PIPER_NOISE_SCALE', 0.667, { min: 0, max: 1 }),
      noiseW: number('PIPER_NOISE_W', 0.8, { min: 0, max: 1 }),
      sampleRate: integer('PIPER_SAMPLE_RATE', 22050, { min: 8000, max: 48000 }),
    },
  },
};

if (minScriptSeconds > maxScriptSeconds) {
  throw new Error('MIN_SCRIPT_SECONDS no puede ser mayor que MAX_SCRIPT_SECONDS.');
}
if (minScriptWords > maxScriptWords) {
  throw new Error('SCRIPT_MIN_WORDS no puede ser mayor que SCRIPT_MAX_WORDS.');
}
if (config.media.video.width % 2 !== 0 || config.media.video.height % 2 !== 0) {
  throw new Error('VIDEO_WIDTH y VIDEO_HEIGHT deben ser numeros pares.');
}
if (!['private', 'unlisted', 'public'].includes(config.youtube.privacy)) {
  throw new Error('YOUTUBE_PRIVACY debe ser private, unlisted o public.');
}

try {
  new Intl.DateTimeFormat('es', { timeZone: config.cron.timezone }).format();
} catch {
  throw new Error(`CRON_TIMEZONE no es una zona horaria valida: ${config.cron.timezone}`);
}

// Debe existir al menos un fondo: el archivo explicito o alguno en el directorio.
// El contenido del directorio se comprueba en listBackgrounds() al ejecutar.
const declaredBackgrounds = [
  ...(singleBackground ? [singleBackground] : []),
  ...explicitBackgrounds,
];
if (declaredBackgrounds.length > 0) {
  for (const file of declaredBackgrounds) {
    if (!existsSync(file)) missing.push(`BACKGROUND_FILES (archivo no encontrado: ${file})`);
  }
} else if (!existsSync(backgroundDir)) {
  missing.push(`BACKGROUND_DIR (carpeta no encontrada: ${backgroundDir})`);
}

if (!dryRun) {
  if (!config.youtube.accessToken && !config.youtube.refreshToken) {
    missing.push('YOUTUBE_REFRESH_TOKEN o YOUTUBE_ACCESS_TOKEN');
  }
  if (!config.youtube.accessToken && config.youtube.refreshToken) {
    if (!config.youtube.clientId) missing.push('YOUTUBE_CLIENT_ID');
    if (!config.youtube.clientSecret) missing.push('YOUTUBE_CLIENT_SECRET');
  }
}

if (missing.length > 0) {
  throw new Error(`Faltan variables o recursos obligatorios en .env:\n- ${missing.join('\n- ')}`);
}

if (!config.localAI.enabled) {
  // Validaciones solo para modo cloud
  if (!config.openai.apiKey) missing.push('OPENAI_API_KEY');
  if (!config.elevenlabs.apiKey) missing.push('ELEVENLABS_API_KEY');
  if (!config.elevenlabs.voiceId) missing.push('ELEVENLABS_VOICE_ID');
} else {
  // Validaciones solo para modo local
  if (!config.localAI.piper.model) missing.push('PIPER_MODEL');
  if (!existsSync(config.localAI.piper.model)) {
    missing.push(`PIPER_MODEL (archivo no encontrado: ${config.localAI.piper.model})`);
  }
}

if (missing.length > 0) {
  throw new Error(`Faltan variables o recursos obligatorios en .env:\n- ${missing.join('\n- ')}`);
}

// Shortcuts para retrocompatibilidad con los servicios (ollama.js, piper.js)
config.ollama = config.localAI.ollama;
config.piper = config.localAI.piper;

// Opciones que se pasan tal cual al generador de ASS.
config.media.assOptions = {
  ...config.media.subtitles,
  width: config.media.video.width,
  height: config.media.video.height,
};

export default config;
