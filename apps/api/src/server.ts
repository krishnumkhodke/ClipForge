// apps/api/src/server.ts
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";

const app = Fastify({
  logger: true,
});

await app.register(cors, {
  origin: "http://127.0.0.1:3000",
});

await app.register(multipart);

app.get("/health", async () => {
  return { ok: true, service: "clipforge-api" };
});

const port = Number(process.env.PORT ?? 4000);

await app.listen({
  host: "127.0.0.1",
  port,
});