import assert from 'node:assert/strict';
import test from 'node:test';
import { createSrt } from '../src/utils/subtitles.js';

function alignmentFromWords(words) {
  const characters = [];
  const starts = [];
  const ends = [];
  let time = 0;

  words.forEach((word, wordIndex) => {
    [...word].forEach((character) => {
      characters.push(character);
      starts.push(time);
      time += 0.08;
      ends.push(time);
    });
    if (wordIndex < words.length - 1) {
      characters.push(' ');
      starts.push(time);
      ends.push(time);
      time += 0.2;
    }
  });
  return { characters, character_start_times_seconds: starts, character_end_times_seconds: ends };
}

test('crea cues SRT en orden y respeta el final de la voz', () => {
  const alignment = alignmentFromWords(['Hola', 'mundo.', '¿Qué', 'tal?']);
  const result = createSrt(alignment, { maxCharacters: 14, maxWords: 3, maxDurationSeconds: 3.2 });

  assert.match(result.srt, /^1\n00:00:00,000 --> /);
  assert.match(result.srt, /Hola mundo\./);
  assert.ok(result.srt.includes('¿Qué tal?'));
  assert.equal(result.cues.length, 2);
  assert.ok(result.cues[0].end <= result.cues[1].start);
});

test('divide una linea larga en dos lineas equilibradas', () => {
  const alignment = alignmentFromWords([
    'Esta',
    'frase',
    'debe',
    'dividirse',
    'para',
    'mantener',
    'una',
    'lectura',
    'cómoda.',
  ]);
  const result = createSrt(alignment, { maxCharacters: 27, maxWords: 8, maxDurationSeconds: 3.2 });

  assert.ok(result.cues[0].text.includes('\n'));
  for (const line of result.cues[0].text.split('\n')) {
    assert.ok(line.length <= 24);
  }
});

test('rechaza una alineacion vacia', () => {
  const empty = { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] };
  assert.throws(() => createSrt(empty), /No se pudieron extraer palabras/);
});
