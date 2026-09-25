import { writeFile } from 'node:fs/promises';
import config from '../config.js';

function validateAlignment(alignment) {
  return alignment
    && Array.isArray(alignment.characters)
    && Array.isArray(alignment.character_start_times_seconds)
    && Array.isArray(alignment.character_end_times_seconds)
    && alignment.characters.length === alignment.character_start_times_seconds.length
    && alignment.characters.length === alignment.character_end_times_seconds.length;
}

export async function synthesizeVoiceOver({ text, outputFile }) {
  if (!text || text.length > 5000) {
    throw new Error('El texto para ElevenLabs debe tener entre 1 y 5000 caracteres.');
  }

  const url = new URL(
    `/v1/text-to-speech/${encodeURIComponent(config.elevenlabs.voiceId)}/with-timestamps`,
    `${config.elevenlabs.apiBaseUrl}/`,
  );
  url.searchParams.set('output_format', config.elevenlabs.outputFormat);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'xi-api-key': config.elevenlabs.apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: config.elevenlabs.modelId,
      apply_text_normalization: 'auto',
      voice_settings: {
        stability: config.elevenlabs.voiceSettings.stability,
        similarity_boost: config.elevenlabs.voiceSettings.similarityBoost,
        style: config.elevenlabs.voiceSettings.style,
        speed: config.elevenlabs.voiceSettings.speed,
        use_speaker_boost: config.elevenlabs.voiceSettings.useSpeakerBoost,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const rawBody = await response.text();
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const details = payload?.detail ?? payload?.message ?? rawBody.slice(0, 500);
    throw new Error(`ElevenLabs devolvio HTTP ${response.status}: ${JSON.stringify(details)}`);
  }
  if (typeof payload?.audio_base64 !== 'string' || payload.audio_base64.length === 0) {
    throw new Error('ElevenLabs no devolvio audio_base64.');
  }
  const alignment = payload.alignment ?? payload.normalized_alignment;
  if (!validateAlignment(alignment)) {
    throw new Error('ElevenLabs no devolvio una alineacion de caracteres valida; no se pueden crear subtitulos sincronizados.');
  }

  const audio = Buffer.from(payload.audio_base64, 'base64');
  if (audio.length === 0) {
    throw new Error('El MP3 recibido de ElevenLabs esta vacio.');
  }

  await writeFile(outputFile, audio);

  const finalTimestamp = alignment.character_end_times_seconds.at(-1);
  return {
    alignment,
    audioPath: outputFile,
    bytes: audio.length,
    durationSeconds: Number.isFinite(Number(finalTimestamp)) ? Number(finalTimestamp) : null,
  };
}
