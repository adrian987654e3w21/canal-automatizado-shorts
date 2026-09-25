import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputFile = resolve(rootDir, 'assets/backgrounds/default.mp4');
const ffmpegBinary = process.env.FFMPEG_PATH?.trim() || ffmpegStatic;
const force = process.argv.includes('--force');

if (!ffmpegBinary) {
  throw new Error('FFmpeg no esta disponible. Ejecuta npm install o define FFMPEG_PATH.');
}
if (existsSync(outputFile) && !force) {
  console.log(`El fondo ya existe: ${outputFile}. Usa --force para reemplazarlo.`);
  process.exit(0);
}

await mkdir(dirname(outputFile), { recursive: true });
console.log(`Generando fondo vertical de prueba: ${outputFile}`);

const args = [
  '-y',
  '-f', 'lavfi',
  '-i', 'color=c=0x07111F:s=1080x1920:r=30',
  '-vf', 'noise=alls=6:allf=t+u,format=yuv420p',
  '-t', '60',
  '-an',
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-crf', '24',
  '-movflags', '+faststart',
  outputFile,
];

const child = spawn(ffmpegBinary, args, { stdio: 'inherit' });
child.on('error', (error) => {
  console.error(`No se pudo ejecutar FFmpeg: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  if (code !== 0) {
    console.error(`FFmpeg termino con codigo ${code}.`);
    process.exitCode = code ?? 1;
  }
});
