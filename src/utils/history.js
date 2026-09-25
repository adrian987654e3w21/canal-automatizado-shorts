import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import config from '../config.js';

const EMPTY = { topics: [], hooks: [], backgrounds: [] };

function historyFile() {
  return resolve(config.media.outputDir, config.history.file);
}

function trim(list, max) {
  return [...list].slice(-max);
}

export async function loadHistory() {
  try {
    const raw = await readFile(historyFile(), 'utf8');
    const data = { ...EMPTY, ...JSON.parse(raw) };
    return {
      topics: trim(data.topics ?? [], config.history.maxEntries),
      hooks: trim(data.hooks ?? [], config.history.maxEntries),
      backgrounds: data.backgrounds ?? [],
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveHistory(history) {
  const file = historyFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({
    topics: trim(history.topics ?? [], config.history.maxEntries),
    hooks: trim(history.hooks ?? [], config.history.maxEntries),
    backgrounds: history.backgrounds ?? [],
  }, null, 2)}\n`, 'utf8');
}

/**
 * Elige el siguiente fondo dando prioridad a los que no se han usado lately.
 * `random` se inyecta para poder testearlo de forma determinista.
 */
export function pickBackground(files, history, random = Math.random) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('No hay ningun video de fondo disponible en la carpeta configurada.');
  }
  if (files.length === 1) return files[0];

  const used = new Set(history?.backgrounds ?? []);
  const fresh = files.filter((file) => !used.has(file));
  const pool = fresh.length > 0 ? fresh : files;

  return pool[Math.floor(random() * pool.length)];
}
