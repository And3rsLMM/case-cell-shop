import { resolve } from "node:path";

import { defineConfig } from "prisma/config";
import { config } from "dotenv";

config({
  path: resolve(__dirname, "../../.env.example"),
  quiet: true
});
config({
  path: resolve(__dirname, "../../.env"),
  override: true,
  quiet: true
});

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts"
  }
});
