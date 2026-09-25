import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import config from './config.js';
import * as openaiService from './services/openai.js';
import * as elevenlabsService from './services/elevenlabs.js';
import * as ollamaService from './services/ollama.js';
import * as piperService from './services/piper.js';
import { createSrt } from './utils/subtitles.js';
import { probeMedia, renderShortVideo } from './services/video.js';
import { publishToYouTube } from './services/youtube.js';

const useLocalAI = config.localAI.enabled;

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function recentTitles(limit = 30) {
  let directories;
  try {
    directories = await readdir(config.media.outputDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = directories
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit);

  const results = await Promise.allSettled(
    candidates.map(async (directory) => {
      const data = await readFile(join(config.media.outputDir, directory, 'content.json'), 'utf8');
      return JSON.parse(data).title;
    }),
  );

  return results
    .filter((result) => result.status === 'fulfilled' && typeof result.value === 'string')
    .map((result) => result.value);
}

export async function runPipeline({ trigger = 'manual' } = {}) {
  await mkdir(config.media.outputDir, { recursive: true });

  const startedAt = new Date();
  const runPrefix = startedAt.toISOString().replace(/[-:.]/g, '');
  const runDirectory = await mkdtemp(join(config.media.outputDir, `${runPrefix}-`));
  const contentFile = join(runDirectory, 'content.json');
  const audioFile = join(runDirectory, 'voice.mp3');
  const subtitleFile = join(runDirectory, 'subtitles.srt');
  const videoFile = join(runDirectory, 'short.mp4');
  const resultFile = join(runDirectory, 'result.json');
  let step = 'inicializacion';

  try {
    step = 'lectura de temas recientes';
    const previous = await recentTitles();

    const scriptStep = useLocalAI ? 'generacion del guion con Ollama' : 'generacion del guion con OpenAI';
    step = scriptStep;
    console.log(`[${runDirectory}] Generando guion para: ${config.content.niche}`);
    const generateShortContent = useLocalAI ? ollamaService.generateShortContent : openaiService.generateShortContent;
    const { content, wordCount, usage } = await generateShortContent({ recentTitles: previous });
    await writeJson(contentFile, content);
    console.log(`[${runDirectory}] Guion valido: ${wordCount} palabras.`);

    const ttsStep = useLocalAI ? 'voz en off con Piper' : 'voz en off con ElevenLabs';
    step = ttsStep;
    const synthesizeVoiceOver = useLocalAI ? piperService.synthesizeVoiceOver : elevenlabsService.synthesizeVoiceOver;
    const speech = await synthesizeVoiceOver({ text: content.script, outputFile: audioFile });
    console.log(`[${runDirectory}] Audio generado: ${speech.bytes} bytes.`);

    step = 'subtitulos sincronizados';
    let subtitleContent;
    if (useLocalAI) {
      subtitleContent = speech.srtContent;
      await writeFile(subtitleFile, subtitleContent, 'utf8');
    } else {
      const subtitles = createSrt(speech.alignment, config.media.subtitles);
      await writeFile(subtitleFile, subtitles.srt, 'utf8');
    }

    step = 'validacion de duracion';
    const audioMetadata = await probeMedia(audioFile);
    const audioDuration = Number(audioMetadata.format?.duration);
    if (!Number.isFinite(audioDuration)) {
      throw new Error('No se pudo determinar la duracion del MP3.');
    }
    if (
      audioDuration < config.openai.script.minSeconds
      || audioDuration > config.openai.script.maxSeconds
    ) {
      throw new Error(
        `La voz dura ${audioDuration.toFixed(2)} s y el rango permitido es ` +
        `${config.openai.script.minSeconds}-${config.openai.script.maxSeconds} s. ` +
        'Ajusta SCRIPT_MIN_WORDS/SCRIPT_MAX_WORDS o PIPER_LENGTH_SCALE.',
      );
    }
    const subtitleCount = useLocalAI
      ? (speech.srtContent.match(/\n\d+\n/g)?.length ?? 0)
      : (speech.alignment ? createSrt(speech.alignment, config.media.subtitles).cues.length : 0);
    console.log(`[${runDirectory}] Duracion validada: ${audioDuration.toFixed(2)} s; ${subtitleCount} subtitulos.`);

    step = 'montaje vertical con FFmpeg';
    const video = await renderShortVideo({
      backgroundFile: config.media.backgroundFile,
      audioFile,
      subtitleFile,
      outputFile: videoFile,
      durationSeconds: audioDuration,
    });
    console.log(`[${runDirectory}] MP4 generado: ${video.bytes} bytes.`);

    let youtube = null;
    if (!config.dryRun) {
      step = 'publicacion en YouTube';
      youtube = await publishToYouTube({ videoFile, content });
      console.log(`[${runDirectory}] Publicado: ${youtube.url}`);
    } else {
      console.log(`[${runDirectory}] DRY_RUN=true: se omite la publicacion.`);
    }

    const result = {
      status: 'completed',
      trigger,
      dryRun: config.dryRun,
      createdAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      niche: config.content.niche,
      wordCount,
      audioDurationSeconds: Number(audioDuration.toFixed(3)),
      subtitleCount,
      videoBytes: video.bytes,
      openaiUsage: usage,
      youtube,
      files: {
        runDirectory,
        contentFile,
        audioFile,
        subtitleFile,
        videoFile,
      },
    };
    await writeJson(resultFile, result);

    return result;
  } catch (error) {
    const failed = {
      status: 'failed',
      trigger,
      step,
      createdAt: startedAt.toISOString(),
      failedAt: new Date().toISOString(),
      error: error.message,
      runDirectory,
    };
    try {
      await writeJson(join(runDirectory, 'error.json'), failed);
    } catch {
      // El error original es mas util que un fallo secundario al guardar el diagnostico.
    }
    error.runDirectory = runDirectory;
    error.failedStep = step;
    throw error;
  }
}
