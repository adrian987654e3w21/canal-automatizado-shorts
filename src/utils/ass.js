import { alignmentToWords, groupWords, parseSrt, splitIntoLines } from './subtitles.js';

const DEFAULTS = {
  width: 1080,
  height: 1920,
  font: 'Arial',
  fontSize: 84,
  color: '#FFFFFF',
  highlightColor: '#FFD400',
  outlineColor: '#000000',
  outline: 5,
  shadow: 2,
  bold: true,
  alignment: 2,
  marginL: 90,
  marginR: 90,
  marginV: 300,
  karaoke: true,
  maxCharacters: 40,
  maxDurationSeconds: 3.2,
  maxWords: 8,
};

/** Convierte #RRGGBB o #RRGGBBAA al formato &HAABBGGRR que libass espera. */
export function toAssColor(value, fallbackAlpha = '00') {
  const match = String(value ?? '').trim().match(/^#?([0-9a-f]{6})(?:([0-9a-f]{2}))?$/i);
  if (!match) throw new Error(`Color de subtitulo invalido: ${value}`);

  const [, rgb, alpha] = match;
  return `&H${alpha ?? fallbackAlpha}${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`.toUpperCase();
}

function toAssTimestamp(seconds) {
  const totalCentiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const rest = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;

  return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

/** Las llaves abren bloques de override de estilo: hay que neutralizarlas. */
function escapeText(value) {
  return String(value)
    .replace(/\\/g, '')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')');
}

function dialogue(layer, start, end, style, text) {
  return `Dialogue: ${layer},${toAssTimestamp(start)},${toAssTimestamp(end)},${style},,0,0,0,,${text}`;
}

function buildHeader(options) {
  const { width, height, font, fontSize, color, highlightColor, outlineColor, outline, shadow, bold, alignment, marginL, marginR, marginV } = options;

  // El orden de los campos de un estilo V4+ es fijo; libass lo lee posicionalmente.
  const style = [
    'Pop',
    font,
    fontSize,
    toAssColor(color),
    toAssColor(highlightColor),
    toAssColor(outlineColor),
    toAssColor('#000000', '80'),
    bold ? -1 : 0,
    0, 0, 0,
    100, 100, 0, 0,
    1,
    outline,
    shadow,
    alignment,
    marginL, marginR, marginV,
    1,
  ].join(',');

  return [
    '[Script Info]',
    '; Generado automaticamente por el pipeline de Shorts. No editar a mano.',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: ${style}`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');
}

function renderGroups(groups, options) {
  const { karaoke, highlightColor, color, maxCharacters } = options;
  const accent = toAssColor(highlightColor);
  const base = toAssColor(color);
  const events = [];

  for (const group of groups) {
    const lines = splitIntoLines(group, maxCharacters);
    const baseText = lines.map((line) => line.words.map((word) => escapeText(word.text)).join(' ')).join('\\N');
    const start = group[0].start;
    const end = Math.max(start + 0.2, group.at(-1).end);

    // Capa 0: el bloque completo, siempre visible.
    events.push(dialogue(0, start, end, 'Pop', baseText));

    if (!karaoke) continue;

    // Capa 1: mismo texto, pero solo la palabra activa en color acento.
    for (let index = 0; index < group.length; index += 1) {
      const wordStart = group[index].start;
      const wordEnd = Math.max(wordStart + 0.05, group[index].end);
      if (wordEnd <= start || wordStart >= end) continue;

      const highlighted = lines
        .map((line) => line.words
          .map((word, position) => {
            const text = escapeText(word.text);
            return line.offset + position === index ? `{\\c${accent}\\b1}${text}{\\c${base}\\b0}` : text;
          })
          .join(' '))
        .join('\\N');

      events.push(dialogue(1, wordStart, wordEnd, 'Pop', highlighted));
    }
  }

  return events;
}

/**
 * Genera un ASS con el estilo embebido y resaltado palabra a palabra.
 *
 * Es indispensable usar ASS en lugar de SRT + force_style: el filtro `subtitles`
 * de ffmpeg ignora `Alignment` dentro de `force_style` sobre ficheros SRT, y los
 * subtitulos acaban anclados arriba a la izquierda en vez de abajo al centro.
 */
export function createAss(alignment, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const words = alignmentToWords(alignment);
  const groups = groupWords(words, settings);

  return {
    ass: [buildHeader(settings), ...renderGroups(groups, settings), ''].join('\n'),
    cueCount: groups.length,
    wordCount: words.length,
  };
}

/** Variante para motores sin alineacion palabra a palabra (Piper, edge-tts). */
export function createAssFromCues(cues, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const groups = cues.map((cue) => {
    const words = cue.text.split(/\s+/).filter(Boolean).map((text) => ({ text }));
    const totalCharacters = words.reduce((sum, word) => sum + word.text.length, 0) || 1;

    let cursor = cue.start;
    return words.map((word) => {
      const span = (cue.end - cue.start) * (word.text.length / totalCharacters);
      const entry = { text: word.text, start: cursor, end: cursor + span };
      cursor += span;
      return entry;
    });
  });

  return {
    ass: [buildHeader(settings), ...renderGroups(groups, settings), ''].join('\n'),
    cueCount: cues.length,
    wordCount: groups.reduce((sum, group) => sum + group.length, 0),
  };
}

export function createAssFromSrt(srt, options = {}) {
  return createAssFromCues(parseSrt(srt), options);
}
