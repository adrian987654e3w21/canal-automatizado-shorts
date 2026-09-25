import { spawn } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import config from '../config.js';

/**
 * Convierte subtítulos WebVTT al formato SRT que entiende ffmpeg.
 */
function vttToSrt(vtt) {
  const blocks = vtt
    .replace(/\r\n/g, '\n')
    .split('\n\n')
    .filter((block) => block.includes('-->'));

  const cues = blocks
    .map((block, idx) => {
      const lines = block.split('\n').filter(Boolean);
      const tsLine = lines.find((l) => l.includes('-->'));
      const textLines = lines.filter(
        (l) => !l.includes('-->') && !/^\d+$/.test(l.trim()) && !/^NOTE/i.test(l.trim()),
      );
      if (!tsLine || textLines.length === 0) return null;

      // VTT usa puntos (00:00:00.000), SRT usa comas (00:00:00,000)
      const srtTs = tsLine.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2');
      return `${idx + 1}\n${srtTs}\n${textLines.join('\n')}`;
    })
    .filter(Boolean);

  return cues.join('\n\n') + '\n';
}

/**
 * Ejecuta edge-tts y devuelve una promesa que se resuelve al terminar.
 */
function runEdgeTts(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('edge-tts', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stderr = [];
    child.stderr.on('data', (d) => stderr.push(d));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`edge-tts termino con codigo ${code}: ${Buffer.concat(stderr).toString().slice(0, 500)}`));
      }
    });
    child.on('error', reject);
  });
}

/**
 * Genera la voz en off y los subtítulos SRT usando Microsoft edge-tts (neuronal, gratuito).
 */
export async function synthesizeVoiceOver({ text, outputFile }) {
  if (!text || text.length > 10000) {
    throw new Error('El texto para edge-tts debe tener entre 1 y 10000 caracteres.');
  }

  const voice = config.edgeTts?.voice ?? 'es-ES-AlvaroNeural';
  const rate = config.edgeTts?.rate ?? '+0%';
  const vttFile = outputFile.replace(/\.[^.]+$/, '.vtt');
  const srtFile = outputFile.replace(/\.[^.]+$/, '.srt');

  // Genera audio MP3 + subtítulos VTT en paralelo
  await runEdgeTts([
    '--voice', voice,
    '--rate', rate,
    '--text', text,
    '--write-media', outputFile,
    '--write-subtitles', vttFile,
  ]);

  const audioStat = await stat(outputFile);
  if (audioStat.size === 0) throw new Error('edge-tts genero un audio vacio.');

  // Convertir VTT a SRT
  let srtContent = '';
  try {
    const vttContent = await readFile(vttFile, 'utf8');
    srtContent = vttToSrt(vttContent);
  } catch {
    srtContent = '';
  }

  // Fallback SRT si la conversión falla
  if (!srtContent.trim()) {
    const wordCount = text.split(/\s+/).length;
    const estimatedDuration = Math.max(5, Math.round((wordCount / 130) * 60));
    const hms = (s) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},000`;
    };
    srtContent = `1\n00:00:00,000 --> ${hms(estimatedDuration)}\n${text.slice(0, 100)}\n`;
  }

  await writeFile(srtFile, srtContent, 'utf8');

  return {
    alignment: null,
    audioPath: outputFile,
    bytes: audioStat.size,
    srtFile,
    srtContent,
  };
}
