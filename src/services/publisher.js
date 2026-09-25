import config from '../config.js';
import * as youtube from './youtube.js';
import * as tiktok from './tiktok.js';
import * as instagram from './instagram.js';

const PLATFORMS = [
  { name: 'youtube', module: youtube },
  { name: 'tiktok', module: tiktok },
  { name: 'instagram', module: instagram },
];

/**
 * Publica el mismo MP4 en todas las plataformas activas.
 *
 * Se reparte en paralelo y los fallos son aislados: si TikTok rechaza la subida,
 * el Short sigue yendo a YouTube e Instagram. Un unico fallo de red no puede
 * tirar abajo el trabajo de todo el dia.
 */
export async function publishToAll({ videoFile, content }) {
  const active = PLATFORMS.filter((platform) => platform.module.isEnabled?.() !== false);

  if (active.length === 0) {
    return { results: [], ok: 0, failed: 0, skipped: 0 };
  }

  const settled = await Promise.allSettled(
    active.map(async (platform) => {
      const started = Date.now();
      const result = await platform.module.publish({ videoFile, content });
      return { ...result, platform: result.platform ?? platform.name, ms: Date.now() - started };
    }),
  );

  const results = settled.map((outcome, index) => {
    const name = active[index].name;
    if (outcome.status === 'fulfilled') return outcome.value;
    return { platform: name, status: 'failed', error: outcome.reason?.message ?? 'error desconocido' };
  });

  const failed = results.filter((result) => result.status === 'failed');
  for (const failure of failed) {
    console.error(`[publish] ${failure.platform} fallo: ${failure.error}`);
  }

  return {
    results,
    ok: results.filter((result) => result.status !== 'failed').length,
    failed: failed.length,
    skipped: results.filter((result) => result.skipped).length,
    dryRun: config.dryRun,
  };
}
