import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    pool: "threads",
    // Bound memory use so the expanded DOM suite starts reliably on Windows.
    maxWorkers: 2,
    setupFiles: ["./src/test/setup.ts"],
  },
});
