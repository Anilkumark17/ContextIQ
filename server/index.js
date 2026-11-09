import { app } from './src/app.js';
import { config } from './src/config.js';
import { startPipelineWorker, stopPipelineWorker } from './src/services/RagPipeline/pipeline.worker.js';

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
  startPipelineWorker();
});

// Finish the in-flight document before exiting. If shutdown is forced anyway, the job's lease
// expires and the next start reclaims it.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  server.close();
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  await stopPipelineWorker();
  clearTimeout(forceExit);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
