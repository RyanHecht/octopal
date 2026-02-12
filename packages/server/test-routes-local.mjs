import Fastify from 'fastify';

const fastify = Fastify({
  logger: { level: 'info' }
});

// Mimic the auth routes structure
function authRoutes() {
  return async function (instance) {
    console.log('Registering auth routes...');
    instance.post('/token', async (request, reply) => {
      return { test: 'works' };
    });
    console.log('Auth routes registered');
  };
}

fastify.get('/health', async () => ({ status: 'ok' }));

console.log('About to register auth routes...');
await fastify.register(authRoutes(), { prefix: '/auth' });
console.log('Finished registering routes');

await fastify.listen({ port: 13850, host: '127.0.0.1' });
console.log('Test server listening on 13850');

setTimeout(() => {}, 10000);
