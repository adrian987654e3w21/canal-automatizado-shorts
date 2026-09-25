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

function balancedText(text, maxCharacters) {
  if (text.length <= Math.min(24, maxCharacters)) return text;

  const target = Math.ceil(text.length / 2);
  const words = text.split(' ');
  let best = null;

  for (let index = 1; index < words.length; index += 1) {
    const left = words.slice(0, index).join(' ');
    const right = words.slice(index).join(' ');
    if (left.length > 24 || right.length > 24) continue;

    const distance = Math.abs(left.length - target);
    if (!best || distance < best.distance) best = { left, right, distance };
  }

  if (best) return `${best.left}\n${best.right}`;
  return text;
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

function groupWords(words, options) {
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
  const cues = groups.map((group) => {
    const text = sanitizeText(group.map((word) => word.text).join(' '));
    return {
      start: group[0].start,
      end: Math.max(group[0].start + 0.2, group.at(-1).end),
      text: balancedText(text, options.maxCharacters ?? 40),
    };
  });

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
