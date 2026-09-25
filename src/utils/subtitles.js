function toTimestamp(seconds) {
  const totalMilliseconds = Math.max(0, Math.floor(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const remainingSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

function sanitizeText(value) {
  return value
    .replace(/\r/g, '')
    .replace(/\n+/g, ' ')
    .replace(/</g, '‹')
    .replace(/>/g, '›')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decide en que palabra conviene partir un grupo para balancear dos lineas.
 * Devuelve el indice de corte, o -1 si el grupo cabe en una sola linea.
 * Se exporta para que el generador de ASS reutilice exactamente el mismo
 * criterio de corte que el SRT y ambos rendericen el texto en el mismo sitio.
 */
export function balancedSplitIndex(words, maxCharacters = 40) {
  const texts = words.map((word) => word.text);
  const text = texts.join(' ');
  if (text.length <= Math.min(24, maxCharacters)) return -1;

  const target = Math.ceil(text.length / 2);
  let best = null;

  for (let index = 1; index < texts.length; index += 1) {
    const left = texts.slice(0, index).join(' ');
    const right = texts.slice(index).join(' ');
    if (left.length > 24 || right.length > 24) continue;

    const distance = Math.abs(left.length - target);
    if (!best || distance < best.distance) best = { index, distance };
  }

  return best ? best.index : -1;
}

/** Agrupa un grupo de palabras en lineas visuales, con sus indices de origen. */
export function splitIntoLines(words, maxCharacters = 40) {
  const index = balancedSplitIndex(words, maxCharacters);
  const parts = index < 0 ? [words] : [words.slice(0, index), words.slice(index)];

  const lines = [];
  let cursor = 0;
  for (const part of parts) {
    if (part.length === 0) continue;
    lines.push({ offset: cursor, words: part });
    cursor += part.length;
  }
  return lines;
}

function balancedText(words, maxCharacters) {
  return splitIntoLines(words, maxCharacters)
    .map((line) => line.words.map((word) => word.text).join(' '))
    .join('\n');
}

export function alignmentToWords(alignment) {
  if (!alignment || !Array.isArray(alignment.characters)) {
    throw new Error('La alineacion de ElevenLabs no contiene un arreglo de caracteres.');
  }

  const starts = alignment.character_start_times_seconds ?? [];
  const ends = alignment.character_end_times_seconds ?? [];
  if (starts.length !== alignment.characters.length || ends.length !== alignment.characters.length) {
    throw new Error('Las marcas de tiempo de ElevenLabs no coinciden con sus caracteres.');
  }

  const words = [];
  let current = null;

  const finishWord = () => {
    if (!current) return;
    const text = sanitizeText(current.text);
    if (text) {
      words.push({
        text,
        start: current.start,
        end: Math.max(current.start + 0.05, current.end),
      });
    }
    current = null;
  };

  alignment.characters.forEach((character, index) => {
    const value = String(character ?? '');
    const start = Number(starts[index]);
    const end = Number(ends[index]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;

    if (!value.trim()) {
      finishWord();
      return;
    }

    current ??= { text: '', start, end };
    current.text += value;
    current.start = Math.min(current.start, start);
    current.end = Math.max(current.end, end);
  });
  finishWord();

  if (words.length === 0) {
    throw new Error('No se pudieron extraer palabras de la alineacion de ElevenLabs.');
  }
  return words;
}

export function groupWords(words, options) {
  const {
    maxCharacters = 40,
    maxDurationSeconds = 3.2,
    maxWords = 8,
  } = options;
  const groups = [];
  let current = [];

  for (const word of words) {
    const candidate = [...current, word];
    const candidateText = candidate.map((item) => item.text).join(' ');
    const candidateDuration = candidate.at(-1).end - candidate[0].start;
    const pauseBeforeWord = current.length > 0 ? word.start - current.at(-1).end : 0;

    if (
      current.length > 0
      && (
        candidateText.length > maxCharacters
        || candidate.length > maxWords
        || candidateDuration > maxDurationSeconds
        || pauseBeforeWord > 0.7
      )
    ) {
      groups.push(current);
      current = [];
    }

    current.push(word);
  }

  if (current.length > 0) groups.push(current);
  return groups;
}

export function createSrt(alignment, options = {}) {
  const words = alignmentToWords(alignment);
  const groups = groupWords(words, options);
  const cues = groups.map((group) => ({
    start: group[0].start,
    end: Math.max(group[0].start + 0.2, group.at(-1).end),
    text: balancedText(group, options.maxCharacters ?? 40),
  }));

  const srt = cues
    .map((cue, index) => `${index + 1}\n${toTimestamp(cue.start)} --> ${toTimestamp(cue.end)}\n${cue.text}\n`)
    .join('\n');

  return {
    srt,
    cues,
    durationSeconds: words.at(-1).end,
    wordCount: words.length,
  };
}

function fromSrtTimestamp(value) {
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return null;

  const [, hours, minutes, seconds, fraction] = match;
  return Number(hours) * 3600
    + Number(minutes) * 60
    + Number(seconds)
    + Number(fraction.padEnd(3, '0')) / 1000;
}

/**
 * Recupera los bloques de un SRT. Necesario para el motor local (Piper/edge-tts),
 * que solo devuelve tiempos por bloque y no una alineacion palabra a palabra.
 */
export function parseSrt(srt) {
  const lines = String(srt)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const cues = [];

  for (let index = 0; index < lines.length; index += 1) {
    const arrow = lines[index].indexOf('-->');
    if (arrow < 0) continue;

    const start = fromSrtTimestamp(lines[index].slice(0, arrow));
    const end = fromSrtTimestamp(lines[index].slice(arrow + 3));
    if (start === null || end === null) continue;

    // El texto son las lineas siguientes hasta el indice del siguiente bloque,
    // que tras limpiar lineas vacias es un numero suelto.
    const textLines = [];
    let cursor = index + 1;
    while (cursor < lines.length && !lines[cursor].includes('-->') && !/^\d+$/.test(lines[cursor])) {
      textLines.push(lines[cursor]);
      cursor += 1;
    }

    const text = sanitizeText(textLines.join(' '));
    if (text) cues.push({ start, end: Math.max(end, start + 0.2), text });

    index = cursor - 1;
  }

  if (cues.length === 0) {
    throw new Error('El SRT no contiene ningun cue con formato de tiempo valido.');
  }
  return cues;
}
