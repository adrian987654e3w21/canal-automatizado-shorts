import { stat } from 'node:fs/promises';
import config from '../config.js';

const API_BASE = `https://graph.facebook.com/v${config.instagram.graphVersion}`;

export function isEnabled() {
  return config.instagram.enabled;
}

/**
 * Sube el Short como Reel en Instagram.
 *
 * Dos condiciones que la API no perdona y que hay que tener listas antes:
 *  1. La cuenta de Instagram debe ser Business o Creator y estar vinculada a una
 *     Fan Page de Facebook.
 *  2. `video_url` debe ser una URL PUBLICAMENTE accesible. Instagram descarga el
 *     video desde esa URL, asi que un archivo local no sirve: hace falta exponer
 *     el MP4 (tunel, NAS publico u objeto en la nube).
 */
export async function publish({ videoFile, content }) {
  if (!isEnabled()) return { platform: 'instagram', skipped: true, reason: 'deshabilitado' };
  if (!config.instagram.publicVideoBaseUrl) {
    throw new Error('IG_REELS_URL_BASE es obligatorio: Instagram descarga el MP4 desde una URL publica.');
  }

  const file = await stat(videoFile);
  if (file.size === 0) throw new Error('El MP4 que se intenta publicar en Instagram esta vacio.');

  const fileName = file.name ?? `${config.instagram.slug}.mp4`;
  const videoUrl = `${config.instagram.publicVideoBaseUrl.replace(/\/+$/, '')}/${fileName}`;

  const caption = [content.description, content.tags.map((tag) => `#${tag.replace(/\s+/g, '')}`).join(' '), config.instagram.descriptionFooter]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, config.instagram.captionMaxLength);

  // 1) Reservar el contenedor. Instagram tarda en procesarlo.
  const container = await graph(`/IG_${config.instagram.userId}/media`, {
    method: 'POST',
    body: {
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      share_to_feed: config.instagram.shareToFeed,
    },
  });

  const creationId = container.id;
  if (!creationId) throw new Error('Instagram no devolvio un id de contenedor.');

  // 2) Esperar a que termine de procesar antes de publicar.
  const ready = await waitUntilReady(creationId);
  if (!ready) {
    return { platform: 'instagram', creationId, status: 'processing', published: false };
  }

  // 3) Publicar el contenedor ya procesado.
  const published = await graph(`/IG_${config.instagram.userId}/media_publish`, {
    method: 'POST',
    body: { creation_id: creationId },
  });

  return {
    platform: 'instagram',
    creationId,
    mediaId: published.id ?? null,
    permalink: published.permalink ?? null,
    status: 'published',
  };
}

async function waitUntilReady(creationId, attempts = 30, delayMs = 10_000) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await graph(`/${creationId}?fields=status_code,status`);
    if (status.status_code === 'FINISHED') return true;
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new Error(`Instagram rechazo el contenedor: ${status.status ?? status_code}`);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function graph(path, { method = 'GET', body } = {}) {
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set('access_token', config.instagram.accessToken);

  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : new URLSearchParams(body),
    signal: AbortSignal.timeout(config.instagram.timeoutMs),
  });

  const raw = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.error) {
    const detail = payload?.error?.message ?? raw.slice(0, 400);
    throw new Error(`Instagram devolvio ${response.status}: ${detail}`);
  }
  return payload;
}
