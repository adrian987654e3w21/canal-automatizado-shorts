import { spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';

// No se importa src/config.js a proposito: la generacion de fondos no necesita
// claves de API y debe poder ejecutarse antes de tener ninguna.
const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const backgroundDir = process.env.BACKGROUND_DIR?.trim() || 'assets/backgrounds';

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const DURATION = 60;

/**
 * Genera fondos abstractos en movimiento usando fuentes sinteticas de FFmpeg.
 *
 * Son clips originales: al no derivar de material de terceros no arrastran
 * ningun problema de derechos, que es el riesgo real de un canal faceless.
 * No sustituyen a un buen b-roll, pero son infinitamente mejor que un color
 * plano y permiten publicar desde el primer dia.
 */
const PRESETS = [
  {
    name: 'gradiente-ciano',
    filter: `gradients=s=${WIDTH}x${HEIGHT}:c0=0x04121f:c1=0x0b3a5c:c2=0x12e1c9:c3=0x04121f:nb_colors=4:speed=0.012:rate=${FPS}`,
  },
  {
    name: 'gradiente-morado',
    filter: `gradients=s=${WIDTH}x${HEIGHT}:c0=0x120b1f:c1=0x3a1c6b:c2=0xe14bd0:c3=0x120b1f:nb_colors=4:speed=0.01:rate=${FPS}`,
  },
  {
    name: 'ondas-calida',
    filter: `gradients=s=${WIDTH}x${HEIGHT}:c0=0x1a0d05:c1=0x5c2b0b:c2=0xe1a312:c3=0x1a0d05:nb_colors=4:speed=0.014:rate=${FPS}`,
  },
  {
    name: 'azul-corporativo',
    filter: `gradients=s=${WIDTH}x${HEIGHT}:c0=0x050d1a:c1=0x123a63:c2=0x3f8cff:c3=0x050d1a:nb_colors=4:speed=0.011:rate=${FPS}`,
  },
  {
    name: 'verde-datos',
    filter: `gradients=s=${WIDTH}x${HEIGHT}:c0=0x04140f:c1=0x0f4d33:c2=0x2ee88a:c3=0x04140f:nb_colors=4:speed=0.013:rate=${FPS}`,
  },
  {
    name: 'grafito',
    filter: `gradients=s=${WIDTH}x${HEIGHT}:c0=0x0a0a0c:c1=0x1e2024:c2=0x3a3f47:c3=0x0a0a0c:nb_colors=4:speed=0.009:rate=${FPS}`,
  },
];

function run(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(ffmpegStatic, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => (
      code === 0 ? resolvePromise() : reject(new Error(stderr.slice(-500)))
    ));
  });
}

const directory = isAbsolute(backgroundDir) ? backgroundDir : resolve(ROOT, backgroundDir);
await mkdir(directory, { recursive: true });

const only = process.argv.slice(2);
const presets = only.length > 0 ? PRESETS.filter((preset) => only.includes(preset.name)) : PRESETS;

if (presets.length === 0) {
  console.error(`No hay ningun preset con ese nombre. Disponibles: ${PRESETS.map((p) => p.name).join(', ')}`);
  process.exitCode = 1;
} else {
  for (const preset of presets) {
    const output = join(directory, `${preset.name}.mp4`);
    const started = Date.now();
    try {
      await run([
        '-y',
        '-f', 'lavfi', '-i', preset.filter,
        '-t', String(DURATION),
        '-an',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(preset.crf ?? 26),
        '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0',
        '-movflags', '+faststart',
        output,
      ]);
      const { size } = await stat(output);
      console.log(`  OK  ${preset.name}.mp4 — ${(size / 1e6).toFixed(1)} MB en ${((Date.now() - started) / 1000).toFixed(0)} s`);
    } catch (error) {
      console.error(` FALLA ${preset.name}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
