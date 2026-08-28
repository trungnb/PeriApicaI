import express from 'express';
import path from 'path';
import compression from 'compression';
import { createServer as createViteServer } from 'vite';

import { PORT, serverLog } from './src/server/config/env';
import { flushCacheOnShutdown, initFirestoreRealtimeListeners, stopFirestoreRealtimeListeners } from './src/server/services/storageAdapter';
import { startCleanupJob } from './src/server/jobs/cleanupJob';
import { startAutoSyncJob } from './src/server/jobs/syncJob';

import healthRoutes from './src/server/routes/healthRoutes';
import authRoutes from './src/server/routes/authRoutes';
import assessmentRoutes from './src/server/routes/assessmentRoutes';
import adminRoutes from './src/server/routes/adminRoutes';
import bugRoutes from './src/server/routes/bugRoutes';
import pathologyRoutes from './src/server/routes/pathologyRoutes';
import { startPathologySnapshot } from './src/server/services/firestorePathologyService';

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  // Enable gzip/brotli compression for fast payload delivery
  app.use(compression());
  app.use(express.json({ limit: '10mb' })); // Reduced from 50mb to prevent payload DoS
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  // Security Headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; frame-ancestors 'self' *;");
    next();
  });

  // HTTP Request Logger Middleware
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
        serverLog(level, 'HTTP', `${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
      });
    }
    next();
  });

  // Register API Routes
  app.use(healthRoutes);
  app.use(authRoutes);
  app.use(assessmentRoutes);
  app.use(adminRoutes);
  app.use(bugRoutes);
  app.use(pathologyRoutes);

  // Start background jobs & Realtime Snapshot Stream
  startCleanupJob();
  startAutoSyncJob();
  initFirestoreRealtimeListeners();
  startPathologySnapshot();

  // Vite development middleware or production static asset serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, {
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.includes('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Graceful shutdown handling (Flush RAM Cache to Disk & Stop Stream on SIGINT/SIGTERM)
  const shutdownHandler = (signal: string) => {
    serverLog('INFO', 'ServerSignal', `Nhận tín hiệu ${signal}. Tiến hành Graceful Shutdown...`);
    stopFirestoreRealtimeListeners();
    flushCacheOnShutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdownHandler('SIGINT'));
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));

  app.listen(PORT, '0.0.0.0', () => {
    serverLog('INFO', 'ServerInit', `Server đã khởi chạy thành công trên cổng ${PORT} [Mode: ${process.env.NODE_ENV || 'development'}]`);
  });
}

startServer().catch((err) => {
  serverLog('ERROR', 'ServerStartupError', 'Lỗi không thể khởi chạy server', err);
  process.exit(1);
});
