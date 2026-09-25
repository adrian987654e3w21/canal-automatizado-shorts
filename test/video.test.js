import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ffmpegStatic from 'ffmpeg-static';

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

test('renderiza MP4 vertical con audio y subtititles', { timeout: 120_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'faceless-video-test-'));
  const background = join(directory, 'background.mp4');
  const audio = join(directory, 'voice.mp3');
  const subtitles = join(directory, 'subtitles.srt');
  const output = join(directory, 'short.mp4');
  t.after(() => rm(directory, { recursive: true, force: true }));

  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'color=c=0x102030:s=360x640:r=30',
    '-t', '2', '-an', '-c:v', 'libx264', background,
  ]);
  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '2', '-c:a', 'libmp3lame', audio,
  ]);
  await writeFile(
    subtitles,
    '1\n00:00:00,200 --> 00:00:01,800\nPrueba de subtitulos sincronizados\n',
    'utf8',
  );

  process.env.CONTENT_NICHE = 'pruebas';
  process.env.OPENAI_API_KEY = 'test';
  process.env.ELEVENLABS_API_KEY = 'test';
  process.env.ELEVENLABS_VOICE_ID = 'test';
  process.env.BACKGROUND_FILE = background;
  process.env.OUTPUT_DIR = join(directory, 'output');
  process.env.DRY_RUN = 'true';
  process.env.VIDEO_WIDTH = '360';
  process.env.VIDEO_HEIGHT = '640';
  process.env.VIDEO_PRESET = 'ultrafast';
  process.env.SUBTITLE_FONT = 'Arial';

  const { probeMedia, renderShortVideo } = await import('../src/services/video.js');
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
