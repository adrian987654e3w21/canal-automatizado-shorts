import config from '../config.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Titulo curto y preciso para YouTube, de 45 a 90 caracteres.' },
    description: { type: 'string', description: 'Descripcion breve de tres a cinco lineas, sin afirmaciones inventadas.' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Entre 5 y 15 etiquetas relevantes, sin caracteres especiales.' },
    script: { type: 'string', description: 'Texto completo que sera narrado, sin acotaciones ni formato Markdown.' },
  },
  required: ['title', 'description', 'tags', 'script'],
  additionalProperties: false,
};

class ContentValidationError extends Error {}

function systemPrompt() {
  const { content, openai } = config;
  return [
    'Eres editor jefe de un canal de Shorts faceless y escritor de guiones de retencion.',
    `Nicho: ${content.niche}.`,
    `Idioma de trabajo: ${content.language}. Escribe todo el contenido en ese idioma.`,
    `Audiencia: ${content.audience}.`,
    `Tono: ${content.tone}.`,
    `Reglas editoriales: ${content.guardrails}`,
    'El campo script es la locucion completa: no incluyas titulos, listas, emojis, URLs, acotaciones entre parentesis, indicaciones de musica ni marcas Markdown.',
    `La locucion debe tener entre ${openai.script.minWords} y ${openai.script.maxWords} palabras para durar aproximadamente ${openai.script.minSeconds}-${openai.script.maxSeconds} segundos.`,
    'Estructura: gancho claro en las primeras 5 palabras, una idea central, desarrollo con ritmo, giro o contexto y cierre interactivo mediante una pregunta directa.',
    'El titulo y la descripcion deben ser precisos, atractivos y compatibles con las reglas del canal.',
  ].join('\n');
}

function normalizeContent(raw) {
  const seenTags = new Set();
  const tags = (Array.isArray(raw.tags) ? raw.tags : [])
    .map((tag) => String(tag).replace(/^#/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (seenTags.has(key)) return false;
      seenTags.add(key);
      return true;
    });

  return {
    title: String(raw.title ?? '').replace(/\s+/g, ' ').trim(),
    description: String(raw.description ?? '').trim(),
    tags,
    script: String(raw.script ?? '').replace(/\r\n/g, '\n').trim(),
  };
}

function validateContent(content) {
  const words = content.script.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) ?? [];
  const { minWords, maxWords } = config.openai.script;

  if (words.length < minWords || words.length > maxWords) {
    throw new ContentValidationError(`El guion tiene ${words.length} palabras y el rango permitido es ${minWords}-${maxWords}.`);
  }
  if (!content.title || content.title.length > 100) {
    throw new ContentValidationError('El titulo debe tener entre 1 y 100 caracteres.');
  }
  if (content.description.length < 20 || content.description.length > 5000) {
    throw new ContentValidationError('La descripcion debe tener entre 20 y 5000 caracteres.');
  }
  if (content.tags.length < 3 || content.tags.length > 15) {
    throw new ContentValidationError('Debe devolver entre 3 y 15 etiquetas relevantes.');
  }
  if (/\[[^\]]*\]|https?:\/\//i.test(content.script)) {
    throw new ContentValidationError('El guion contiene un elemento de formato o una URL no permitida.');
  }

  return words.length;
}

function createUserPrompt(recentTitles, feedback) {
  const previous = recentTitles.length > 0
    ? `\nTemas publicados recientemente (no repitas su angulo):\n${JSON.stringify(recentTitles)}`
    : '';

  const correction = feedback
    ? `\nCorrige este problema del intento anterior: ${feedback}\nVuelve a crear el contenido completo.`
    : '';

  return [
    `Crea una publicacion nueva para hoy sobre ${config.content.niche}.`,
    'Elige un angulo concreto, evergreen y que pueda explicarse bien con un fondo generico, sin depender de imagenes concretas.',
    previous,
    correction,
  ].join('\n');
}

async function callOllama(prompt, system, format) {
  const url = `${config.ollama.baseUrl}/api/generate`;
  const body = {
    model: config.ollama.model,
    prompt,
    system,
    format,
    stream: false,
    options: {
      temperature: config.ollama.temperature,
      num_predict: config.ollama.maxTokens,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = await response.json();
  return data.response;
}

export async function generateShortContent({ recentTitles = [] } = {}) {
  let feedback = '';
  let lastValidationError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const userPrompt = createUserPrompt(recentTitles.slice(0, 30), feedback);
    const rawResponse = await callOllama(userPrompt, systemPrompt(), OUTPUT_SCHEMA);

    try {
      const parsed = JSON.parse(rawResponse);
      const content = normalizeContent(parsed);
      const wordCount = validateContent(content);

      return {
        content,
        wordCount,
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      };
    } catch (error) {
      if (!(error instanceof ContentValidationError) && !(error instanceof SyntaxError)) {
        throw error;
      }
      lastValidationError = error;
      feedback = error.message;
      console.warn(`Ollama: intento ${attempt} invalido; reintentando. Motivo: ${error.message}`);
    }
  }

  throw new Error(`No se pudo generar un guion valido tras 3 intentos: ${lastValidationError?.message ?? 'error desconocido'}`);
}