import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    const diagnostics = await app.db.getOperationalDiagnostics();
    const ready =
      diagnostics.migration.compatible &&
      diagnostics.runtime.quickCheck === 'ok' &&
      diagnostics.runtime.foreignKeysEnabled;
    if (!ready) {
      return reply.code(503).send({
        status: 'not_ready',
        checks: diagnostics,
      });
    }
    return {
      status: 'ready',
      checks: diagnostics,
    };
  });
  app.get('/health/diagnostics', async () => {
    const diagnostics = await app.db.getOperationalDiagnostics();
    return {
      timestamp: new Date().toISOString(),
      service: {
        status: 'ok',
        uptimeSeconds: Math.floor(process.uptime()),
        environment: process.env.NODE_ENV ?? 'development',
      },
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
      },
      requests: app.opsMetrics,
      database: diagnostics,
    };
  });
};
