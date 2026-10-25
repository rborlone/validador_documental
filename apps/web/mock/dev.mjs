// `pnpm dev:mock`: levanta el servidor mock y Vite apuntando a él.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port = process.env.MOCK_PORT ?? '4010';
process.env.MOCK_PORT = port;
const { server } = await import('./server.mjs');

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = spawn('pnpm', ['exec', 'vite'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VITE_API_URL: `http://localhost:${port}` },
});

const shutdown = () => {
  vite.kill('SIGTERM');
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
vite.on('exit', (code) => {
  server.close();
  process.exit(code ?? 0);
});
