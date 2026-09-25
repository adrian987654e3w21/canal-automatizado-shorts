import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import config from './config.js';
import * as openaiService from './services/openai.js';
import * as elevenlabsService from './services/elevenlabs.js';
import * as ollamaService from './services/ollama.js';
import * as piperService from './services/piper.js';
import { createSrt } from './utils/subtitles.js';
import { createAss, createAssFromSrt } from './utils/ass.js';
import { listBackgrounds } from './utils/backgrounds.js';
import { loadHistory, pickBackground, saveHistory } from './utils/history.js';
import { probeMedia, renderShortVideo } from './services/video.js';
import { publishToAll } from './services/publisher.js';

const useLocalAI = config.localAI.enabled;

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function runPipeline({ trigger = 'manual' } = {}) {
  await mkdir(config.media.outputDir, { recursive: true });

  const history = await loadHistory();

  const startedAt = new Date();
  const runPrefix = startedAt.toISOString().replace(/[-:.]/g, '');
  const runDirectory = await mkdtemp(join(config.media.outputDir, `${runPrefix}-`));
  const contentFile = join(runDirectory, 'content.json');
  const audioFile = join(runDirectory, 'voice.mp3');
  const subtitleFile = join(runDirectory, 'subtitles.srt');
  const assFile = join(runDirectory, 'subtitles.ass');
  const videoFile = join(runDirectory, 'short.mp4');
  const resultFile = join(runDirectory, 'result.json');
  let step = 'inicializacion';

  try {
    step = 'lectura de temas recientes';
    const previousTitles = history.topics;

    const scriptStep = useLocalAI ? 'generacion del guion con Ollama' : 'generacion del guion con OpenAI';
    step = scriptStep;
    console.log(`[${runDirectory}] Generando guion para: ${config.content.niche}`);
    const generateShortContent = useLocalAI ? ollamaService.generateShortContent : openaiService.generateShortContent;
    const { content, wordCount, usage } = await generateShortContent({ recentTitles: previousTitles });
    await writeJson(contentFile, content);
    console.log(`[${runDirectory}] Guion valido: ${wordCount} palabras.`);

    const ttsStep = useLocalAI ? 'voz en off con Piper' : 'voz en off con ElevenLabs';
    step = ttsStep;
    const synthesizeVoiceOver = useLocalAI ? piperService.synthesizeVoiceOver : elevenlabsService.synthesizeVoiceOver;
    const speech = await synthesizeVoiceOver({ text: content.script, outputFile: audioFile });
    console.log(`[${runDirectory}] Audio generado: ${speech.bytes} bytes.`);

    step = 'subtitulos sincronizados';
    // El SRT se conserva como referencia o para subirlo aparte; el burnt-in va en
    // ASS porque es el unico formato con el que se respeta el anclaje del estilo.
    let subtitleCueCount;
    let ass;
    if (useLocalAI) {
      await writeFile(subtitleFile, speech.srtContent, 'utf8');
      ass = createAssFromSrt(speech.srtContent, config.media.assOptions);
    } else {
      const subtitles = createSrt(speech.alignment, config.media.subtitles);
      await writeFile(subtitleFile, subtitles.srt, 'utf8');
      ass = createAss(speech.alignment, config.media.assOptions);
    }
    await writeFile(assFile, ass.ass, 'utf8');
    subtitleCueCount = ass.cueCount;

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
    console.log(`[${runDirectory}] Duracion validada: ${audioDuration.toFixed(2)} s; ${subtitleCueCount} bloques de subtitulo.`);

    step = 'montaje vertical con FFmpeg';
    const available = await listBackgrounds();
    const background = pickBackground(available, history);
    console.log(`[${runDirectory}] Fondo: ${background} (${available.length} disponibles).`);

    const video = await renderShortVideo({
      backgroundFile: background,
      audioFile,
      subtitleFile: assFile,
      outputFile: videoFile,
      durationSeconds: audioDuration,
    });
    console.log(`[${runDirectory}] MP4 generado: ${video.bytes} bytes.`);

    let publish = null;
    if (!config.dryRun) {
      step = 'publicacion';
      publish = await publishToAll({ videoFile, content });
      for (const item of publish.results) {
        console.log(`[${runDirectory}] ${item.platform}: ${item.url ?? item.status ?? 'sin url'}`);
      }
    } else {
      console.log(`[${runDirectory}] DRY_RUN=true: se omite la publicacion.`);
    }

    history.topics = [...history.topics, content.topic || content.title];
    if (config.media.rotateBackgrounds) {
      history.backgrounds = [...history.backgrounds, background];
    }
    await saveHistory(history);

    const result = {
      status: 'completed',
      trigger,
      dryRun: config.dryRun,
      createdAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      niche: config.content.niche,
      wordCount,
      audioDurationSeconds: Number(audioDuration.toFixed(3)),
      subtitleCount: subtitleCueCount,
      videoBytes: video.bytes,
      openaiUsage: usage,
      youtube,
      files: {
        runDirectory,
        contentFile,
        audioFile,
        subtitleFile,
        assFile,
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
