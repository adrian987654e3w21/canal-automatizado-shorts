import { access, constants } from 'node:fs/promises';
import { resolve } from 'node:path';

// src/config.js valida el entorno al importarse y lanza si falta algo. El
// objetivo de este script es justamente decir qué falta, así que ese error se
// captura y se muestra como lista legible en vez de como stack trace.
let config;
try {
  config = (await import('../src/config.js')).default;
} catch (error) {
  console.error('\n  La configuracion no es valida todavía:\n');
  const missing = error.message.split('\n- ').slice(1);
  if (missing.length > 0) {
    for (const item of missing) console.error(`    - ${item}`);
  } else {
    console.error(`    ${error.message}`);
  }
  console.error('\n  Edita .env y vuelve a ejecutar: npm run doctor\n');
  console.error('  Las claves se sacan de:');
  console.error('    OpenAI     -> https://platform.openai.com/api-keys');
  console.error('    ElevenLabs -> https://elevenlabs.io/app/settings/api-keys');
  console.error('    Voces      -> https://elevenlabs.io/voice-settings\n');
  process.exit(1);
}

const { listBackgrounds } = await import('../src/utils/backgrounds.js');

const checks = [];
const add = (ok, label, detail = '') => checks.push({ ok, label, detail });

async function canReach(url, headers = {}) {
  try {
    const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(10_000) });
    return { status: response.status };
  } catch (error) {
    return { error: error.message };
  }
}

const backgrounds = await listBackgrounds();
add(
  backgrounds.length > 0,
  'Fondos de video',
  backgrounds.length > 0
    ? `${backgrounds.length} clip(s): ${backgrounds.map((file) => file.split(/[\\/]/).pop()).join(', ')}`
    : 'Ninguno. Deja MP4/MOV en BACKGROUND_DIR o define BACKGROUND_FILE.',
);
if (backgrounds.length === 1) {
  add(false, 'Variedad de fondos', 'Solo hay 1 clip: todos los Shorts saldran con el mismo fondo.');
}

const openai = await canReach('https://api.openai.com/v1/models', { Authorization: `Bearer ${config.openai.apiKey}` });
add(
  !openai.error && openai.status === 200,
  'OpenAI',
  openai.error
    ?? (openai.status === 200
      ? `HTTP 200 con ${config.openai.model}`
      : `HTTP ${openai.status}: revisa OPENAI_API_KEY y OPENAI_MODEL (${config.openai.model})`),
);

if (config.localAI.enabled) {
  const ollama = await canReach(`${config.localAI.ollama.baseUrl}/api/tags`);
  add(!ollama.error, 'Ollama (local)', ollama.error ?? `HTTP ${ollama.status}`);
} else {
  const eleven = await canReach(`${config.elevenlabs.apiBaseUrl}/v1/voices`, { 'xi-api-key': config.elevenlabs.apiKey });
  add(
    !eleven.error && eleven.status === 200,
    'ElevenLabs',
    eleven.error ?? `HTTP ${eleven.status} con la voz ${config.elevenlabs.voiceId}`,
  );
}

add(config.dryRun, 'Modo de simulacion', config.dryRun ? 'DRY_RUN=true: no se publica nada' : 'Publicacion real');

if (config.dryRun) {
  add(true, 'YouTube', 'Omitido: DRY_RUN=true. Usa youtube:auth y pon DRY_RUN=false cuando quieras publicar.');
} else {
  add(Boolean(config.youtube.refreshToken || config.youtube.accessToken), 'Credenciales de YouTube', 'Falta el token.');
  if (config.youtube.refreshToken || config.youtube.accessToken) {
    const yt = await canReach('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true', {
      Authorization: `Bearer ${config.youtube.accessToken ?? ''}`,
    });
    add(!yt.error, 'YouTube API', yt.error ?? (config.youtube.accessToken ? `HTTP ${yt.status}` : 'Refresh token presente'));
  }
}

if (config.tiktok.enabled) {
  add(Boolean(config.tiktok.accessToken), 'TikTok', config.tiktok.accessToken ? 'Token presente' : 'Falta TIKTOK_ACCESS_TOKEN.');
} else {
  add(true, 'TikTok', 'Deshabilitado (TIKTOK_ENABLED=false)');
}

if (config.instagram.enabled) {
  add(Boolean(config.instagram.userId), 'Instagram', config.instagram.userId ? `IG ${config.instagram.userId}` : 'Falta INSTAGRAM_USER_ID.');
  add(
    Boolean(config.instagram.publicVideoBaseUrl),
    'URL publica para Instagram',
    config.instagram.publicVideoBaseUrl ?? 'Falta IG_REELS_URL_BASE: Instagram descarga el MP4 desde esa URL.',
  );
} else {
  add(true, 'Instagram', 'Deshabilitado (INSTAGRAM_ENABLED=false)');
}

try {
  await access(resolve(config.rootDir, '.env'), constants.R_OK);
  add(true, 'Permisos de escritura', config.media.outputDir);
} catch (error) {
  add(false, 'Permisos de escritura', error.message);
}

console.log(`\n  Diagnostico del canal — ${config.content.niche}\n`);
for (const check of checks) {
  const mark = check.ok ? '  OK  ' : ' FALLA';
  console.log(`[${mark}] ${check.label}${check.detail ? ` — ${check.detail}` : ''}`);
}

const failed = checks.filter((check) => !check.ok).length;
console.log(`\n  ${checks.length - failed}/${checks.length} comprobaciones correctas.\n`);
process.exitCode = failed > 0 ? 1 : 0;
