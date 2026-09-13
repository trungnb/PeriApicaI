import express from 'express';
import path from 'path';
import compression from 'compression';

import { PORT, serverLog, assertSigningSecretConfiguration } from './src/server/config/env';
import { flushCacheOnShutdown } from './src/server/services/storageAdapter';
import { startCleanupJob } from './src/server/jobs/cleanupJob';
import { startAutoSyncJob } from './src/server/jobs/syncJob';

import healthRoutes from './src/server/routes/healthRoutes';
import authRoutes from './src/server/routes/authRoutes';
import assessmentRoutes from './src/server/routes/assessmentRoutes';
import adminRoutes from './src/server/routes/adminRoutes';
import bugRoutes from './src/server/routes/bugRoutes';
import pathologyRoutes from './src/server/routes/pathologyRoutes';
import validityRoutes from './src/server/routes/validityRoutes';
import { startPathologySnapshot } from './src/server/services/firestorePathologyService';
import { initializeModelManager } from './src/server/services/modelManager';

function serveStaticAssets(app: express.Express, clientDistPath: string): void {
  app.use(express.static(clientDistPath, {
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (filePath.includes('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

export function createApp(): express.Express {
  const app = express();
  const trustProxySetting = process.env.TRUST_PROXY?.trim().toLowerCase();
  const trustProxyHops = trustProxySetting ? Number(trustProxySetting) : NaN;
  const trustProxy = trustProxySetting === 'true'
    ? 1
    : /^\d+$/.test(trustProxySetting || '') && Number.isSafeInteger(trustProxyHops)
      ? trustProxyHops
      : false;
  app.set('trust proxy', trustProxy);

  // Enable gzip/brotli compression for fast payload delivery (bypassing SSE streams)
  app.use(
    compression({
      filter: (req, res) => {
        if (req.headers.accept === 'text/event-stream' || req.path.includes('/api/analyze-radiograph') || req.path.includes('/api/segment-pathology')) {
          return false;
        }
        return compression.filter(req, res);
      },
    })
  );
  app.use(express.json({ limit: '3mb' })); // 3mb limit for compressed client images
  app.use(express.urlencoded({ limit: '3mb', extended: true }));

  // Security Headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob: https:; script-src 'self' blob: https://accounts.google.com; frame-src 'self' https://accounts.google.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://accounts.google.com; connect-src 'self' https: ws: wss:; frame-ancestors 'self' https://aistudio.google.com https://localhost.corp.google.com:26001;");
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
  app.use(validityRoutes);

  // Error handling middleware for API routes (Payload Too Large 413, JSON parsing errors)
  app.use('/api', (err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err) {
      if (err.type === 'entity.too.large' || err.status === 413) {
        return res.status(413).json({
          success: false,
          error: 'Payload Too Large: Dung lượng dữ liệu vượt quá giới hạn cho phép (3MB). Vui lòng kiểm tra lại ảnh.',
          userMessage: 'Dung lượng ảnh/dữ liệu quá lớn (tối đa 3MB).',
          code: 'PAYLOAD_TOO_LARGE',
        });
      }
      if (err.status === 400 && 'body' in err) {
        return res.status(400).json({
          success: false,
          error: 'Invalid JSON body',
          userMessage: 'Dữ liệu gửi lên không hợp lệ.',
        });
      }
      return res.status(err.status || 500).json({
        success: false,
        error: 'Internal server error',
      });
    }
    next();
  });

  return app;
}

async function startServer() {
  assertSigningSecretConfiguration();
  const app = createApp();

  // Start background jobs & Realtime Snapshot Stream
  startCleanupJob();
  startAutoSyncJob();
  startPathologySnapshot();
  void initializeModelManager();

  // Vite development middleware or production static asset serving
  const isCjsBundle = typeof __filename === 'string' && __filename.endsWith('.cjs');
  const isProduction = process.env.NODE_ENV === 'production' || isCjsBundle;

  const clientDistPath = path.join(process.cwd(), 'dist', 'client');

  if (!isProduction) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (viteErr) {
      serverLog('WARN', 'Vite', 'Vite dev server is unavailable, falling back to static client serving');
      serveStaticAssets(app, clientDistPath);
    }
  } else {
    serveStaticAssets(app, clientDistPath);
  }

  // Graceful shutdown handling (Flush RAM Cache to Disk & Stop Stream on SIGINT/SIGTERM)
  const shutdownHandler = async (signal: string) => {
    serverLog('INFO', 'ServerSignal', `Nhận tín hiệu ${signal}. Tiến hành Graceful Shutdown...`);
    await flushCacheOnShutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdownHandler('SIGINT'));
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));

  app.listen(PORT, '0.0.0.0', () => {
    serverLog('INFO', 'ServerInit', `Server đã khởi chạy thành công trên cổng ${PORT} [Mode: ${process.env.NODE_ENV || 'development'}]`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    serverLog('ERROR', 'ServerStartupError', 'Lỗi không thể khởi chạy server', err);
    process.exit(1);
  });
}
