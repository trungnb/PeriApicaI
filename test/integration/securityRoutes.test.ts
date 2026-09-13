import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '';
process.env.GOOGLE_APPLICATION_CREDENTIALS = '';
process.env.ADMIN_PASSWORD = 'integration-admin-password';
process.env.DEL_PASSWORD = 'integration-delete-password';
process.env.PILOT_REVIEWER_IDS = 'integration-reviewer';
process.env.TRUST_PROXY = '0';

const [{ default: authRoutes }, { default: adminRoutes }, { default: assessmentRoutes }, auth, storage] =
  await Promise.all([
    import('../../src/server/routes/authRoutes'),
    import('../../src/server/routes/adminRoutes'),
    import('../../src/server/routes/assessmentRoutes'),
    import('../../src/server/routes/authRoutes'),
    import('../../src/server/services/storageAdapter'),
  ]);

const app = express();
app.use(express.json());
app.use(authRoutes);
app.use(adminRoutes);
app.use(assessmentRoutes);

let server: ReturnType<typeof app.listen>;
let baseUrl = '';

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.close();
  await once(server, 'close');
});

function adminToken(): string {
  const token = auth.generateAdminToken();
  auth.adminSessions.set(token, {
    expiresAt: Date.now() + 60_000,
    reviewerId: 'integration-reviewer',
  });
  return token;
}

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('restore rejects crafted server-owned fields before persistence', async () => {
  const token = adminToken();
  const adapter = storage.getStorageAdapter();
  const originalSaveLog = adapter.saveLog;
  let persisted = false;
  adapter.saveLog = async () => {
    persisted = true;
    throw new Error('restore must reject before persistence');
  };

  try {
    const response = await post(
      '/api/admin/restore-backup',
      {
        reports: [
          {
            assessmentId: 'crafted-restore',
            isAdminVerified: true,
            verifiedBy: 'attacker',
          },
        ],
      },
      token,
    );

    assert.equal(response.status, 400);
    assert.equal(persisted, false);
  } finally {
    adapter.saveLog = originalSaveLog;
  }
});

test('delete-doc rejects an incorrect delete password', async () => {
  const response = await post(
    '/api/admin/delete-doc',
    { docId: 'missing-doc', collection: 'reports', password: 'wrong-password' },
    adminToken(),
  );

  assert.equal(response.status, 401);
});

test('image route rejects requests without a valid signature', async () => {
  const response = await fetch(`${baseUrl}/api/images/example.jpg`);
  assert.equal(response.status, 403);
});

test('bug detail sanitizer drops stack traces', () => {
  assert.deepEqual(
    storage.sanitizeBugErrorDetails({
      endpoint: '/api/test',
      errorMessage: 'failure',
      stackTrace: 'secret stack trace',
    }),
    { endpoint: '/api/test', errorMessage: 'failure' },
  );
});

test('admin login is rate-limited after repeated failures', async () => {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const response = await post('/api/admin/login', { password: 'wrong-password' });
    statuses.push(response.status);
  }

  assert.deepEqual(statuses.slice(0, 15), Array(15).fill(401));
  assert.equal(statuses[15], 429);
});

test('CSP does not allow inline or eval scripts', async () => {
  const { createApp } = await import('../../server');
  const configuredApp = createApp();
  const configuredServer = configuredApp.listen(0, '127.0.0.1');
  await once(configuredServer, 'listening');
  const address = configuredServer.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/system-capabilities`);
    const csp = response.headers.get('content-security-policy') || '';
    assert.match(csp, /script-src 'self' blob:/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-(?:inline|eval)/);
    assert.match(csp, /frame-ancestors 'self' \*;/);
  } finally {
    await new Promise<void>((resolve) => configuredServer.close(() => resolve()));
  }
});

test('TRUST_PROXY accepts an explicit hop count only', async () => {
  const { createApp } = await import('../../server');
  const previous = process.env.TRUST_PROXY;

  process.env.TRUST_PROXY = '2';
  assert.equal(createApp().get('trust proxy'), 2);

  process.env.TRUST_PROXY = 'untrusted-value';
  assert.equal(createApp().get('trust proxy'), false);

  if (previous === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = previous;
});
