// Separate entry point so env vars are loaded before server.js (and its
// imports, e.g. db.js constructing the pg Pool at module load time) run.
// ESM `import` statements are hoisted above any other code in a module, so
// loading .env couldn't happen first if this lived at the top of server.js
// itself — only a dynamic import() actually defers module evaluation.
try {
  process.loadEnvFile();
} catch {
  // No .env file (e.g. on Render, where env vars come from the dashboard).
}

await import("./server.js");
