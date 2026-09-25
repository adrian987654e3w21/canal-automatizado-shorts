import { spawn } from 'node:child_process';
import { readFile, writeFile, stat } from 'node:fs/promises';
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

  // 1) Generar audio WAV (piper siempre produce WAV)
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
  if (audioStat.size === 0) throw new Error('Piper genero un audio vacio.');

  // 2) Intentar generar SRT nativo — no todos los builds lo soportan
  const srtFile = outputFile.replace(/\.[^.]+$/, '.srt');
  let srtContent = '';
  let durationSeconds = 0;

  try {
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
    if (srtStat.size > 0) {
      srtContent = await readFile(srtFile, 'utf8');
    }
  } catch {
    // El binario no soporta --output_srt; se usara un SRT simple
    srtContent = '';
  }

  // Si no se obtuvo SRT, crear uno mínimo para que el pipeline continúe
  if (!srtContent) {
    // Estimación: ~130 palabras/min en español a length_scale=1
    const wordCount = text.split(/\s+/).length;
    const estimatedDuration = Math.max(5, Math.round((wordCount / 130) * 60));
    const hms = (s) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')},000`;
    };
    srtContent = `1\n00:00:00,000 --> ${hms(estimatedDuration)}\n${text.slice(0, 80)}\n`;
    await writeFile(srtFile, srtContent, 'utf8');
    durationSeconds = estimatedDuration;
  } else {
    const cues = parseSrt(srtContent);
    durationSeconds = cues.length > 0 ? cues.at(-1).end : 0;
  }

  return {
    alignment: null,
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