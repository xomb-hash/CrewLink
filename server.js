import http from 'node:http';
import { config } from './src/config/index.js';
import { appRouter } from './src/app.js';
import { storage } from './src/lib/storage.js';

// Ensure storage file/structure is initialized
storage.ensureLoaded();

const server = http.createServer(appRouter);

server.listen(config.port, () => {
  console.log(`===============================================`);
  console.log(` Crewlink server running at ${config.appUrl}`);
  console.log(` Port: ${config.port} | Mode: ${config.nodeEnv}`);
  console.log(` Zero npm packages installed (Standard Node.js)`);
  console.log(`===============================================`);
});

function handleShutdown(signal) {
  console.log(`Received ${signal}, closing server gracefully...`);
  server.close(() => {
    storage.save();
    console.log('Crewlink server closed.');
    process.exit(0);
  });
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
