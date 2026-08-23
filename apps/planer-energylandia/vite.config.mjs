import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function resolveRelease() {
  const configuredRelease = String(process.env.GITHUB_SHA || "").trim();
  if (/^[a-f0-9]{7,40}$/i.test(configuredRelease)) {
    return configuredRelease.toLowerCase().slice(0, 12);
  }
  try {
    const checkedOutRelease = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[a-f0-9]{7,40}$/i.test(checkedOutRelease)
      ? checkedOutRelease.toLowerCase().slice(0, 12)
      : "dev";
  } catch {
    return "dev";
  }
}

const release = resolveRelease();

function releasePlugin() {
  let buildOutputDirectory = null;
  return {
    name: "pogodapark-release",
    configResolved(config) {
      buildOutputDirectory = config.command === "build"
        ? resolve(config.root, config.build.outDir)
        : null;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || "/", "http://localhost").pathname;
        if (pathname !== "/release.json") return next();
        response.statusCode = 200;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.setHeader("cache-control", "no-store");
        response.end(JSON.stringify({ release }));
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "release.json",
        source: `${JSON.stringify({ release })}\n`,
      });
    },
    async closeBundle() {
      if (!buildOutputDirectory) return;
      const manifestPath = resolve(buildOutputDirectory, "manifest.webmanifest");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.id = "./";
      manifest.start_url = release === "dev" ? "./" : `./?r${release}`;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    },
  };
}

export default defineConfig({
  base: "./",
  define: {
    __APP_RELEASE__: JSON.stringify(release),
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    proxy: {
      "/api/queues": {
        target: "https://queue-times.com",
        changeOrigin: true,
        rewrite: () => "/parks/317/queue_times.json",
      },
    },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react(), releasePlugin()],
});
