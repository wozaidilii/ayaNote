import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaClient } from "@/generated/prisma/client";
import ws from "ws";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Provision Neon on Vercel and pull env (vercel env pull).",
    );
  }

  // Neon serverless driver needs a WebSocket constructor in Node.
  neonConfig.webSocketConstructor = ws;
  // Prefer HTTP for short serverless queries (avoids WS setup latency on cold paths).
  neonConfig.poolQueryViaFetch = true;

  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Reuse across warm serverless invocations (dev + prod).
globalForPrisma.prisma = prisma;
