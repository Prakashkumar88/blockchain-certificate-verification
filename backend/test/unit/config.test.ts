import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/config/index.js";
import { config, id } from "../helpers/fixtures.js";
it("validates deployment identity, secrets, SIWE scope and production security", () => {
  const c = config(),
    dir = mkdtempSync(join(tmpdir(), "cert-config-")),
    path = join(dir, "manifest.json");
  try {
    writeFileSync(path, JSON.stringify(c.manifest));
    const env = Object.fromEntries(
      Object.entries(c)
        .filter(([k]) => k !== "manifest")
        .map(([k, v]) => [k, String(v)]),
    );
    env.DEPLOYMENT_MANIFEST_PATH = path;
    expect(loadConfig(env).manifest).toEqual(c.manifest);
    expect(() =>
      loadConfig({ ...env, SESSION_SECRET: "placeholder" }),
    ).toThrow();
    expect(() => loadConfig({ ...env, SIWE_DOMAIN: "evil.example" })).toThrow();
    expect(() => loadConfig({ ...env, NODE_ENV: "production" })).toThrow();
    writeFileSync(path, JSON.stringify({ ...c.manifest, deploymentId: id(9) }));
    expect(() => loadConfig(env)).toThrow("Manifest mismatch");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
