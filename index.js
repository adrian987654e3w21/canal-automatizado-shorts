import cron from 'node-cron';
import { createServer } from 'node:http';
import config from './src/config.js';
import { runPipeline } from './src/pipeline.js';

// Health check HTTP server (para Docker)
const HEALTH_PORT = process.env.HEALTH_PORT ? Number(process.env.HEALTH_PORT) : 3000;
let healthServer;

function startHealthServer() {
  healthServer = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
  healthServer.listen(HEALTH_PORT, '0.0.0.0', () => {
    console.log(`[health] Servidor de health check en puerto ${HEALTH_PORT}`);
  });
}

let activeRun = false;
let stopping = false;

async function executeSafely(trigger) {
  if (activeRun) {
    console.warn(`[${trigger}] Se omite la ejecucion porque ya hay un proceso activo.`);
    return null;
  }

  activeRun = true;
  try {
    return await runPipeline({ trigger });
  } catch (error) {
    console.error(`[${trigger}] Fallo durante ${error.failedStep ?? 'el flujo'}: ${error.message}`);
    console.error(`Artefactos conservados en: ${error.runDirectory ?? 'sin directorio'}`);
    return null;
  } finally {
    activeRun = false;
  }
}

const manualRun = process.argv.includes('--now');

if (manualRun) {
  const result = await executeSafely('manual');
  if (!result) process.exitCode = 1;
  if (healthServer) healthServer.close();
} else {
  // Iniciar health server en modo daemon (cron)
  startHealthServer();
  if (!cron.validate(config.cron.schedule)) {
    throw new Error(`CRON_SCHEDULE no es una expresion cron valida: ${config.cron.schedule}`);
  }

  const task = cron.schedule(
    config.cron.schedule,
    () => executeSafely('cron'),
    {
      name: 'faceless-short-daily',
      timezone: config.cron.timezone,
      noOverlap: true,
    },
  );

  task.on('execution:started', () => console.log('[cron] Ejecucion diaria iniciada.'));
  task.on('execution:finished', () => console.log('[cron] Ejecucion diaria terminada.'));
  task.on('execution:overlap', () => console.warn('[cron] Ejecucion omitida por solapamiento.'));
  task.on('execution:failed', (context) => {
    console.error('[cron] La tarea fallo:', context?.execution?.error?.message ?? 'error desconocido');
  });

  console.log(`Canal de Shorts iniciado. Programacion: ${config.cron.schedule} (${config.cron.timezone}).`);
  console.log(`Nicho: ${config.content.niche}. DRY_RUN=${config.dryRun}.`);
  console.log(`Proxima ejecucion: ${task.getNextRun()?.toISOString() ?? 'no disponible'}.`);

  if (config.cron.runOnStart) {
    console.log('RUN_ON_START=true: iniciando una ejecucion inmediata.');
    void executeSafely('startup');
  }

  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    task.destroy();
    if (healthServer) healthServer.close();
    console.log(`\n${signal} recibido; programacion detenida.`);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}
