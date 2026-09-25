import { stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import config from '../config.js';

const bundledFfmpeg = typeof ffmpegStatic === 'string' ? ffmpegStatic : null;
const bundledFfprobe = typeof ffprobeStatic === 'string' ? ffprobeStatic : ffprobeStatic?.path ?? null;
const ffmpegBinary = config.media.ffmpegPath ?? bundledFfmpeg;
const ffprobeBinary = config.media.ffprobePath ?? bundledFfprobe;

if (!ffmpegBinary || !ffprobeBinary) {
  throw new Error('No se encontro FFmpeg. Instala las dependencias o define FFMPEG_PATH y FFPROBE_PATH.');
}

ffmpeg.setFfmpegPath(ffmpegBinary);
ffmpeg.setFfprobePath(ffprobeBinary);

function escapeFilterPath(value) {
  return value
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

export function probeMedia(inputFile) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputFile, (error, metadata) => {
      if (error) {
        reject(new Error(`ffprobe no pudo leer ${inputFile}: ${error.message}`));
        return;
      }
      resolve(metadata);
    });
  });
}

export async function renderShortVideo({ backgroundFile, audioFile, subtitleFile, outputFile, durationSeconds }) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('La duracion de la voz en off no es valida.');
  }

  await Promise.all([
    stat(backgroundFile).then((result) => {
      if (result.size === 0) throw new Error('El video de fondo esta vacio.');
    }),
    stat(audioFile).then((result) => {
      if (result.size === 0) throw new Error('El audio de voz en off esta vacio.');
    }),
    stat(subtitleFile).then((result) => {
      if (result.size === 0) throw new Error('El archivo SRT esta vacio.');
    }),
  ]);

  const { width, height, fps, crf, preset } = config.media.video;
  const subtitleStyle = config.media.subtitles;
  const filter = [
    `[0:v:0]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height},setsar=1,format=yuv420p,` +
      `subtitles=filename='${escapeFilterPath(subtitleFile)}':force_style='` +
      `FontName=${subtitleStyle.font},FontSize=${subtitleStyle.fontSize},` +
      `PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,` +
      `Outline=${subtitleStyle.outline},Shadow=1,Bold=1,Alignment=2,` +
      `MarginV=${subtitleStyle.marginV}'[v]`,
    '[1:a:0]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a]',
  ].join(';');

  await new Promise((resolve, reject) => {
    ffmpeg(backgroundFile)
      .inputOptions(['-stream_loop', '-1'])
      .input(audioFile)
      .outputOptions([
        '-filter_complex', filter,
        '-map', '[v]',
        '-map', '[a]',
        '-t', durationSeconds.toFixed(3),
        '-r', String(fps),
        '-c:v', 'libx264',
        '-preset', preset,
        '-crf', String(crf),
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '48000',
        '-ac', '2',
        '-movflags', '+faststart',
      ])
      .output(outputFile)
      .on('error', (error) => {
        reject(new Error(`FFmpeg no pudo crear el video: ${error.message}`));
      })
      .on('end', resolve)
      .run();
  });

  const output = await stat(outputFile);
  if (output.size === 0) {
    throw new Error('FFmpeg genero un archivo MP4 vacio.');
  }

  return {
    videoPath: outputFile,
    bytes: output.size,
    ffmpeg: basename(ffmpegBinary),
    subtitlePath: basename(subtitleFile),
    workingDirectory: dirname(outputFile),
  };
}
