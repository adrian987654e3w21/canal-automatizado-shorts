import { readdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import config from '../config.js';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);

/**
 * Resuelve el listado de fondos a partir de BACKGROUND_FILES (lista explicita)
 * o, si esta vacia, escaneando BACKGROUND_DIR.
 */
export async function listBackgrounds() {
  // Un archivo explicito tiene prioridad sobre el escaneo del directorio.
  if (config.media.backgroundFile) {
    return [config.media.backgroundFile];
  }
  if (config.media.backgroundFiles.length > 0) {
    return config.media.backgroundFiles;
  }

  const entries = await readdir(config.media.backgroundsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => resolve(config.media.backgroundsDir, entry.name))
    .sort();
}
