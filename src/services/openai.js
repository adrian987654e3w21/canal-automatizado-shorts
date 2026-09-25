import OpenAI from 'openai';
import config from '../config.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    topic: {
      type: 'string',
      description: 'Tema de tres a seis palabras en minusculas, sin acentos. Se usa para no repetir contenido.',
    },
    title: {
      type: 'string',
      description: 'Titulo curto y preciso para YouTube, de 45 a 90 caracteres.',
    },
    description: {
      type: 'string',
      description: 'Descripcion breve de tres a cinco lineas, sin afirmaciones inventadas.',
    },
    tags: {
      type: 'array',
      description: 'Entre 5 y 15 etiquetas relevantes, sin caracteres especiales.',
      items: { type: 'string' },
    },
    script: {
      type: 'string',
      description: 'Texto completo que sera narrado, sin acotaciones ni formato Markdown.',
    },
  },
  required: ['topic', 'title', 'description', 'tags', 'script'],
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
    topic: String(raw.topic ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
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
    throw new ContentValidationError(
      `El guion tiene ${words.length} palabras y el rango permitido es ${minWords}-${maxWords}.`,
    );
  }
  if (!content.title || content.title.length > 100) {
    throw new ContentValidationError('El titulo debe tener entre 1 y 100 caracteres.');
  }
  if (content.topic.length < 3) {
    throw new ContentValidationError('El tema debe tener al menos 3 caracteres.');
  }
  if (content.description.length < 80 || content.description.length > 5000) {
    throw new ContentValidationError('La descripcion debe tener entre 80 y 5000 caracteres.');
  }
  if (content.tags.length < 5 || content.tags.length > 15) {
    throw new ContentValidationError('Debe devolver entre 5 y 15 etiquetas relevantes.');
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
    'El tema debe ser sustancialmente distinto al de los anteriores: no basta con cambiar el titulo.',
    previous,
    correction,
  ].join('\n');
}

export async function generateShortContent({ recentTitles = [] } = {}) {
  const client = new OpenAI({ apiKey: config.openai.apiKey });
  let feedback = '';
  let lastValidationError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await client.responses.create({
      model: config.openai.model,
      store: false,
      max_output_tokens: 1800,
      input: [
        { role: 'system', content: systemPrompt() },
        {
          role: 'user',
          content: createUserPrompt(recentTitles.slice(0, 30), feedback),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'faceless_short',
          strict: true,
          schema: OUTPUT_SCHEMA,
        },
      },
    });

    if (response.status !== 'completed' || !response.output_text) {
      throw new Error(`OpenAI no devolvio una respuesta completa (estado: ${response.status ?? 'desconocido'}).`);
    }

    try {
      const content = normalizeContent(JSON.parse(response.output_text));
      const wordCount = validateContent(content);

      return {
        content,
        wordCount,
        usage: {
          inputTokens: response.usage?.input_tokens ?? null,
          outputTokens: response.usage?.output_tokens ?? null,
          totalTokens: response.usage?.total_tokens ?? null,
        },
      };
    } catch (error) {
      if (!(error instanceof ContentValidationError) && !(error instanceof SyntaxError)) {
        throw error;
      }
      lastValidationError = error;
      feedback = error.message;
      console.warn(`OpenAI: intento ${attempt} invalido; reintentando. Motivo: ${error.message}`);
    }
  }

  throw new Error(`No se pudo generar un guion valido tras 3 intentos: ${lastValidationError?.message ?? 'error desconocido'}`);
}
