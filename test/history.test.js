import assert from 'node:assert/strict';
import test from 'node:test';

process.env.CONTENT_NICHE = 'pruebas';
process.env.OPENAI_API_KEY = 'test';
process.env.ELEVENLABS_API_KEY = 'test';
process.env.ELEVENLABS_VOICE_ID = 'test';
process.env.BACKGROUND_DIR = 'assets/backgrounds';
process.env.DRY_RUN = 'true';

const { pickBackground } = await import('../src/utils/history.js');

const HISTORY = { backgrounds: ['a.mp4', 'b.mp4', 'c.mp4'] };

test('elige un fondo que no se ha usado todavia', () => {
  const files = ['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4'];
  // random = 0 siempre: debe caer en el primer recien usado.
  assert.equal(pickBackground(files, HISTORY, () => 0), 'd.mp4');
});

test('prioriza los fondos frescos frente a los ya usados', () => {
  const files = ['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4', 'e.mp4'];
  assert.equal(pickBackground(files, HISTORY, () => 0.99), 'e.mp4');
  assert.equal(pickBackground(files, HISTORY, () => 0.5), 'e.mp4');
  assert.equal(pickBackground(files, HISTORY, () => 0.1), 'd.mp4');
});

test('reutiliza el fondo mas antiguo cuando ya no quedan frescos', () => {
  const files = ['a.mp4', 'b.mp4', 'c.mp4'];
  // Todos estan en el historial: se permite repetir, menos repetido primero.
  const chosen = pickBackground(files, HISTORY, () => 0);
  assert.ok(files.includes(chosen));
});

test('con un solo fondo siempre devuelve ese fondo', () => {
  assert.equal(pickBackground(['unico.mp4'], {}, () => 0.99), 'unico.mp4');
});

test('falla de forma explicita si no hay fondos', () => {
  assert.throws(() => pickBackground([], {}), /No hay ningun video de fondo/);
  assert.throws(() => pickBackground(null, {}), /No hay ningun video de fondo/);
});
