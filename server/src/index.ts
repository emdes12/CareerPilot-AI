import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrap } from './bootstrap.js';
import { config, ROOT } from './config.js';
import { migrate } from './migrate.js';
import { api } from './routes/api.js';
import { startScheduler } from './scheduler.js';
import { startWorker } from './agents/core/orchestrator.js';
import { registerWorkflows } from './agents/workflows.js';

async function main() {
  await migrate();
  const userId = await bootstrap();
  registerWorkflows();
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  // The email composer carries attachments (base64), so it alone gets a larger body limit.
  const bigJson = express.json({ limit: '36mb' }); const smallJson = express.json({ limit: '2mb' });
  app.use((req, res, next) => (req.path === '/api/compose/send' ? bigJson : smallJson)(req, res, next));
  app.use(cookieParser());
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', api);
  const dist = path.join(ROOT, 'web', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.listen(config.port, '127.0.0.1', () => console.log(`[server] CareerPilot AI API on http://127.0.0.1:${config.port}`));
  if (process.env.DISABLE_WORKER !== '1') startWorker();
  if (process.env.DISABLE_SCHEDULER !== '1') await startScheduler(userId);
}

main().catch((e) => { console.error(e); process.exit(1); });
