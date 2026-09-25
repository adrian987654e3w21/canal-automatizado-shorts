import { spawn } from 'node:child_process';
import { writeFile, stat } from 'node:fs/promises';
import config from '../config.js';

function runPiper(args, stdinText) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.piper.binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => reject(new Error(`No se pudo ejecutar Piper: ${err.message}`)));
    child.on('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Piper termino con codigo ${code}: ${stderr.slice(-1000)}`));
    });

    if (stdinText) {
      child.stdin.write(stdinText);
      child.stdin.end();
    }
  });
}

export async function synthesizeVoiceOver({ text, outputFile }) {
  if (!text || text.length > 5000) {
    throw new Error('El texto para Piper debe tener entre 1 y 5000 caracteres.');
  }

  // 1) Generar MP3
  await runPiper(
    [
      '--model', config.piper.model,
      '--output_file', outputFile,
      '--length_scale', String(config.piper.lengthScale),
      '--noise_scale', String(config.piper.noiseScale),
      '--noise_w', String(config.piper.noiseW),
      '--sample_rate', String(config.piper.sampleRate),
    ],
    text,
  );

  const audioStat = await stat(outputFile);
  if (audioStat.size === 0) throw new Error('Piper genero un MP3 vacio.');

  // 2) Generar SRT nativo (Piper --output_srt)
  const srtFile = outputFile.replace(/\.mp3$/i, '.srt');
  await runPiper(
    [
      '--model', config.piper.model,
      '--output_srt', srtFile,
      '--length_scale', String(config.piper.lengthScale),
      '--noise_scale', String(config.piper.noiseScale),
      '--noise_w', String(config.piper.noiseW),
      '--sample_rate', String(config.piper.sampleRate),
    ],
    text,
  );

  const srtStat = await stat(srtFile);
  if (srtStat.size === 0) throw new Error('Piper genero un SRT vacio.');

  const srtContent = await import('node:fs/promises').then((fs) => fs.readFile(srtFile, 'utf8'));
  const cues = parseSrt(srtContent);
  const durationSeconds = cues.length > 0 ? cues.at(-1).end : 0;

  return {
    alignment: null, // no se usa alignment de caracteres; el SRT ya viene sincronizado
    audioPath: outputFile,
    bytes: audioStat.size,
    durationSeconds,
    srtFile,
    srtContent,
  };
}

function parseSrt(srt) {
  const cues = [];
  const blocks = srt.trim().split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!timeMatch) continue;
    const start = parseTimestamp(timeMatch[1]);
    const end = parseTimestamp(timeMatch[2]);
    const text = lines.slice(2).join('\n').trim();
    if (text) cues.push({ start, end, text });
  }
  return cues;
}

function parseTimestamp(ts) {
  const [hms, ms] = ts.split(',');
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s + Number(ms) / 1000;
}