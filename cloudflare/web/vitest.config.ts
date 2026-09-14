import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Mirrors the broker's config. The hosted worker had no tests at all, which is
// why a handful of boundary defects (login timing, an unguarded /logout, a
// caller-declared content type served back inline) survived review.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
