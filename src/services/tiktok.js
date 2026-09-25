import { createReadStream, stat } from 'node:fs';
import { readFile } from 'node:fs/promises';
import config from '../config.js';

const API_BASE = 'https://open.tiktokapis.com/v2';
const UPLOAD_CHUNK_BYTES = 10 * 1024 * 1024;

export function isEnabled() {
  return config.tiktok.enabled;
}

async function postJson(path, { method = 'POST', body, token, query } = {}) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(config.tiktok.timeoutMs),
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
    throw new Error(`TikTok devolvio ${response.status}: ${detail}`);
  }
  return payload?.data ?? payload;
}

/**
 * Sube el Short como TikTok.
 *
 * Requiere aprobar la "Content Posting API" en el panel de TikTok for Developers;
 * hasta entonces la app queda en estado no publicado y la API responde 403.
 */
export async function publish({ videoFile, content }) {
  if (!isEnabled()) return { platform: 'tiktok', skipped: true, reason: 'deshabilitado' };

  const file = await stat(videoFile);
  if (file.size === 0) throw new Error('El MP4 que se intenta publicar en TikTok esta vacio.');
  if (file.size > config.tiktok.maxBytes) {
    throw new Error(`El video supera el limite de TikTok (${file.size} bytes).`);
  }

  const token = await accessToken();
  const title = [content.title, config.tiktok.descriptionFooter]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, config.tiktok.titleMaxLength);

  // 1) Reservar el hueco de publicacion y obtener el upload_id.
  const init = await postJson('/post/publish/video/init/', {
    token,
    body: {
      post_info: {
        title,
        privacy_level: config.tiktok.privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_owner_type: 'DIRECT_POST',
      },
      source_info: { source: 'PULL_FROM_URL', video_url: '' },
    },
  });

  const uploadId = init?.publish_id;
  if (!uploadId) throw new Error('TikTok no devolvio un publish_id.');

  // 2) Subir los bytes del MP3... del MP4 en troceado con Content-Range.
  const bytes = await readFile(videoFile);
  for (let offset = 0; offset < bytes.length; offset += UPLOAD_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, Math.min(offset + UPLOAD_CHUNK_BYTES, bytes.length));
    const total = bytes.length;

    const response = await fetch(`${API_BASE}/post/publish/video/upload/?upload_id=${uploadId}`, {
      method: 'POST',
      headers: {
        'Content-Length': String(chunk.length),
        'Content-Range': `bytes ${offset}-${offset + chunk.length - 1}/${total}`,
        'Content-Type': 'video/mp4',
        Authorization: `Bearer ${token}`,
      },
      body: chunk,
      signal: AbortSignal.timeout(config.tiktok.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`La subida a TikTok fallo en el fragmento ${offset}: HTTP ${response.status}.`);
    }
  }

  return { platform: 'tiktok', publishId: uploadId, url: init?.share_url ?? null, status: 'processing' };
}

async function accessToken() {
  if (config.tiktok.accessToken) return config.tiktok.accessToken;
  throw new Error('Falta TIKTOK_ACCESS_TOKEN. Generalo con la Content Posting API de TikTok for Developers.');
}
