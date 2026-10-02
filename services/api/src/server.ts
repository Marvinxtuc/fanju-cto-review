import { buildApp } from "./app.js";
import { prisma } from "./prisma.js";
import { drainAndDisconnect } from "./shutdown.js";

const port = Number(process.env.API_PORT || 3000);
const host = process.env.API_HOST || "0.0.0.0";
const app = await buildApp();
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = setTimeout(() => process.exit(1), 15_000);
  deadline.unref();
  void (async () => {
    const clean = await drainAndDisconnect({
      closeHttp: () => app.close(),
      disconnectDatabase: () => prisma.$disconnect(),
      logError: error => app.log.error(error),
    });
    clearTimeout(deadline);
    if (!clean) process.exit(1);
  })();
});

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}
