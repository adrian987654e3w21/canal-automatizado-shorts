import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ffmpegStatic from 'ffmpeg-static';

// src/config.js es un singleton validado en el momento de importarlo, asi que
// el entorno se fija una unica vez aqui, antes de que ningun test lo cargue.
process.env.CONTENT_NICHE = 'pruebas';
process.env.OPENAI_API_KEY = 'test';
process.env.ELEVENLABS_API_KEY = 'test';
process.env.ELEVENLABS_VOICE_ID = 'test';
process.env.DRY_RUN = 'true';
process.env.VIDEO_WIDTH = '360';
process.env.VIDEO_HEIGHT = '640';
process.env.VIDEO_PRESET = 'ultrafast';
process.env.SUBTITLE_FONT = 'Arial';
// El tamano se expresa en pixeles reales respecto al PlayResX/Y del ASS.
process.env.SUBTITLE_FONT_SIZE = '28';

const { probeMedia, renderShortVideo } = await import('../src/services/video.js');
const { createAssFromSrt } = await import('../src/utils/ass.js');

const ASS_OPTIONS = { width: 360, height: 640, fontSize: 28 };

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegStatic, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg termino con codigo ${code}: ${stderr.slice(-1000)}`));
    });
  });
}

async function makeFixtures(directory, { name = '' } = {}) {
  const background = join(directory, `fondo${name}.mp4`);
  const audio = join(directory, `voz${name}.mp3`);
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0x102030:s=360x640:r=30', '-t', '2', '-an', '-c:v', 'libx264', background]);
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2', '-c:a', 'libmp3lame', audio]);
  return { background, audio };
}

test('renderiza MP4 vertical con audio y subtititles', { timeout: 120_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'faceless-video-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const { background, audio } = await makeFixtures(directory);
  const subtitles = join(directory, 'subtitles.ass');
  const output = join(directory, 'short.mp4');

  const { ass } = createAssFromSrt('1\n00:00:00,200 --> 00:00:01,800\nPrueba de subtitulos sincronizados\n', ASS_OPTIONS);
  await writeFile(subtitles, ass, 'utf8');

  const result = await renderShortVideo({
    backgroundFile: background,
    audioFile: audio,
    subtitleFile: subtitles,
    outputFile: output,
    durationSeconds: 2,
  });
  const metadata = await probeMedia(output);

  assert.ok(result.bytes > 0);
  assert.equal(metadata.format.duration, 2);
  assert.equal(metadata.streams.find((stream) => stream.codec_type === 'video').width, 360);
  assert.equal(metadata.streams.find((stream) => stream.codec_type === 'video').height, 640);
  assert.ok(await readFile(output).then(() => true));
});

test('funciona con espacios en las rutas de entrada y salida', { timeout: 120_000 }, async (t) => {
  // Regresion: el proyecto vive en "Canal Automatizado" y, sin escapar el
  // espacio, ffmpeg parte el argumento del filtergraph y falla al abrir la
  // salida con un error que no señala la causa real.
  const directory = await mkdtemp(join(tmpdir(), 'faceless espacios test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const { background, audio } = await makeFixtures(directory, { name: ' con espacios' });
  const subtitles = join(directory, 'subtitulos con espacios.ass');
  const output = join(directory, 'salida con espacios.mp4');

  const { ass } = createAssFromSrt('1\n00:00:00,200 --> 00:00:01,800\nRutas con espacios\n', ASS_OPTIONS);
  await writeFile(subtitles, ass, 'utf8');

  const result = await renderShortVideo({
    backgroundFile: background,
    audioFile: audio,
    subtitleFile: subtitles,
    outputFile: output,
    durationSeconds: 2,
  });

  assert.ok(result.bytes > 0);
  assert.equal((await probeMedia(output)).format.duration, 2);
});
