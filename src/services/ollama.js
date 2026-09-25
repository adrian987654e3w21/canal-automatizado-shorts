import config from '../config.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    script: { type: 'string' },
  },
  required: ['title', 'description', 'tags', 'script'],
  additionalProperties: false,
};

class ContentValidationError extends Error {}

function systemPrompt() {
  const { content, openai } = config;
  const minW = openai.script.minWords;
  const maxW = openai.script.maxWords;
  const minS = openai.script.minSeconds;
  const maxS = openai.script.maxSeconds;

  return [
    `Eres el guionista de un canal de YouTube sobre ${content.niche}.`,
    `Idioma: ${content.language}. Escribe TODO el contenido en ese idioma.`,
    `Audiencia: ${content.audience}.`,
    `Tono: ${content.tone}.`,
    `Restricciones: ${content.guardrails}`,
    '',
    'INSTRUCCIONES ESTRICTAS:',
    `1. "script": narración completa entre ${minW} y ${maxW} palabras (${minS}-${maxS} s).`,
    '   - Empieza con un gancho fuerte en las primeras 5 palabras.',
    '   - SIN listas, SIN emojis, SIN URLs, SIN acotaciones, SIN Markdown.',
    '   - Termina con una pregunta al espectador.',
    `2. "title": título atractivo para YouTube, entre 40 y 90 caracteres.`,
    '3. "description": resumen de 2-4 frases, mínimo 80 caracteres.',
    '4. "tags": EXACTAMENTE entre 5 y 10 palabras clave relevantes como lista JSON.',
    '',
    'EJEMPLO DE RESPUESTA CORRECTA:',
    '{"title":"¿Por qué el cielo es azul? La respuesta te sorprenderá","description":"El color del cielo esconde un fenómeno físico fascinante que pocos conocen. La dispersión de Rayleigh explica por qué vemos el cielo azul durante el día y rojo al atardecer.","tags":["ciencia","cielo","física","dispersión","Rayleigh","colores","astronomía","naturaleza","espacio","curiosidades"],"script":"¿Alguna vez te has preguntado por qué el cielo es azul? La respuesta está en cómo la luz del sol interactúa con nuestra atmósfera. Cuando la luz blanca del sol entra en la atmósfera, choca con las moléculas de aire. La luz azul tiene una longitud de onda más corta, lo que hace que se disperse en todas direcciones. Por eso cuando miramos al cielo, vemos azul en cualquier dirección. Al amanecer y al atardecer, la luz recorre más atmósfera y los colores rojos predominan. ¿Qué otro fenómeno del cielo te gustaría entender?"}',
    '',
    'Devuelve ÚNICAMENTE el JSON. Sin texto adicional.',
  ].join('\n');
}

function normalizeContent(raw) {
  const seenTags = new Set();
  let tags = (Array.isArray(raw.tags) ? raw.tags : [])
    .map((tag) => String(tag).replace(/^#/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (seenTags.has(key)) return false;
      seenTags.add(key);
      return true;
    });

  // Auto-completar tags desde el título si son insuficientes
  if (tags.length < 5 && raw.title) {
    const extraTags = [
      config.content.niche,
      'curiosidades',
      'ciencia',
      'espacio',
      'universo',
      'astronomia',
      'datos',
      'fascinante',
    ];
    for (const t of extraTags) {
      if (tags.length >= 8) break;
      const key = t.toLocaleLowerCase();
      if (!seenTags.has(key)) {
        tags.push(t);
        seenTags.add(key);
      }
    }
  }

  const title = String(raw.title ?? '').replace(/\s+/g, ' ').trim();
  let description = String(raw.description ?? '').trim();

  // Auto-completar descripción si es demasiado corta
  if (description.length < 80 && raw.script) {
    const scriptSnippet = String(raw.script ?? '').slice(0, 200).trim();
    description = description
      ? `${description} ${scriptSnippet}`.slice(0, 500)
      : scriptSnippet;
  }

  return {
    title,
    description,
    tags,
    script: String(raw.script ?? '').replace(/\r\n/g, '\n').trim(),
  };
}

function validateContent(content) {
  const words = content.script.match(/[\p{L}\p{N}]+(?:[''.-][\p{L}\p{N}]+)*/gu) ?? [];
  const { minWords, maxWords } = config.openai.script;

  if (words.length < minWords || words.length > maxWords) {
    throw new ContentValidationError(
      `El guion tiene ${words.length} palabras y el rango permitido es ${minWords}-${maxWords}.`,
    );
  }
  if (!content.title || content.title.length > 100) {
    throw new ContentValidationError('El titulo debe tener entre 1 y 100 caracteres.');
  }
  if (content.description.length < 20) {
    throw new ContentValidationError(`La descripcion tiene ${content.description.length} caracteres (minimo 20).`);
  }
  if (content.tags.length < 1) {
    throw new ContentValidationError('Debe devolver al menos 1 etiqueta relevante.');
  }
  if (/\[[^\]]*\]|https?:\/\//i.test(content.script)) {
    throw new ContentValidationError('El guion contiene un elemento de formato o una URL no permitida.');
  }

  return words.length;
}

function createUserPrompt(recentTitles, feedback) {
  const previous = recentTitles.length > 0
    ? `\nTemas publicados recientemente (NO repitas el mismo ángulo):\n${JSON.stringify(recentTitles)}`
    : '';

  const correction = feedback
    ? `\nERROR EN EL INTENTO ANTERIOR: ${feedback}\nCorrige ese error y vuelve a crear el contenido completo.`
    : '';

  return [
    `Crea una publicación nueva sobre "${config.content.niche}".`,
    'Elige un ángulo concreto, sorprendente y evergreen.',
    previous,
    correction,
    '\nRecuerda: responde SOLO con el JSON, sin texto adicional.',
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
  const MAX_ATTEMPTS = 5;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
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
      console.warn(`Ollama: intento ${attempt}/${MAX_ATTEMPTS} invalido; reintentando. Motivo: ${error.message}`);
    }
  }

  throw new Error(`No se pudo generar un guion valido tras ${MAX_ATTEMPTS} intentos: ${lastValidationError?.message ?? 'error desconocido'}`);
}