import assert from 'node:assert/strict';
import test from 'node:test';
import { createAss, createAssFromSrt, toAssColor } from '../src/utils/ass.js';

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

test('convierte colores RGB al formato &HAABBGGRR de libass', () => {
  assert.equal(toAssColor('#FFD400'), '&H0000D4FF');
  assert.equal(toAssColor('000000'), '&H00000000');
  assert.equal(toAssColor('#000000', '80'), '&H80000000');
  assert.throws(() => toAssColor('azul'), /invalido/);
});

test('incrusta el estilo y el anclaje en el propio ASS', () => {
  const alignment = alignmentFromWords(['Hola', 'mundo']);
  const { ass } = createAss(alignment, { width: 1080, height: 1920, alignment: 2, marginV: 300 });

  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  // El campo 18 del estilo V4+ es Alignment: debe decir 2 (abajo centro).
  const style = ass.match(/^Style: (.+)$/m)[1].split(',');
  assert.equal(style[0], 'Pop');
  assert.equal(style[18], '2');
  assert.equal(style[21], '300');
  // Sin force_style: el estilo viaja en el archivo, no en el comando de ffmpeg.
  assert.doesNotMatch(ass, /force_style/);
});

test('genera una capa base y una capa de resaltado por palabra', () => {
  const alignment = alignmentFromWords(['Uno', 'dos', 'tres']);
  const { ass, cueCount, wordCount } = createAss(alignment, { karaoke: true });

  const base = ass.split('\n').filter((line) => line.startsWith('Dialogue: 0,'));
  const highlight = ass.split('\n').filter((line) => line.startsWith('Dialogue: 1,'));

  assert.equal(cueCount, 1);
  assert.equal(wordCount, 3);
  assert.equal(base.length, 1);
  assert.equal(highlight.length, 3);
  assert.match(base[0], /Uno dos tres/);
  assert.match(highlight[0], /\{\\c&H0000D4FF\\b1\}Uno/);
  assert.match(highlight[2], /tres\{\\c&H00FFFFFF\\b0\}$/);
});

test('desactiva el resaltado cuando karaoke=false', () => {
  const alignment = alignmentFromWords(['Uno', 'dos', 'tres']);
  const { ass } = createAss(alignment, { karaoke: false });
  assert.equal(ass.split('\n').filter((line) => line.startsWith('Dialogue: 1,')).length, 0);
});

test('neutraliza las llaves que libass interpretaria como override', () => {
  const alignment = alignmentFromWords(['{raro}', 'texto']);
  const { ass } = createAss(alignment, { karaoke: false });
  assert.doesNotMatch(ass, /\{raro\}/);
  assert.match(ass, /\(raro\) texto/);
});

test('genera ASS a partir de un SRT cuando no hay alineacion por palabra', () => {
  const srt = [
    '1',
    '00:00:00,200 --> 00:00:02,000',
    'Esta linea se divide aqui',
    '',
    '2',
    '00:00:02,000 --> 00:00:04,000',
    'Segunda linea',
    '',
  ].join('\n');
  const { ass, cueCount } = createAssFromSrt(srt, { karaoke: true });

  const base = ass.split('\n').filter((line) => line.startsWith('Dialogue: 0,'));
  assert.equal(cueCount, 2);
  assert.equal(base.length, 2);
  // El primer bloque se equilibra en dos lineas con \N; el segundo no cabe.
  assert.match(base[0], /Esta linea se\\Ndivide aqui$/);
  assert.match(base[1], /Segunda linea$/);
  // El parser no debe arrastrar el indice ni la linea de tiempo al texto.
  assert.doesNotMatch(ass, /00:00:04,000 Segunda/);
});

test('no pierde bloques al parsear un SRT multilinea', () => {
  const srt = '1\n00:00:00,000 --> 00:00:01,000\nUno\n\n2\n00:00:01,000 --> 00:00:02,000\nDos\n';
  const { cueCount } = createAssFromSrt(srt, { karaoke: false });
  assert.equal(cueCount, 2);
});
