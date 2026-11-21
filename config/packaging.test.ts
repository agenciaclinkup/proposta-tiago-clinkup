import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
const read = (file: string) => readFileSync(file, "utf8");
describe("empacotamento dedicado", () => {
  it("usa build standalone, usuario sem privilegios e healthcheck", () => {
    const docker = read("Dockerfile");
    expect(docker).toMatch(/FROM node:22-alpine AS builder/);
    expect(docker).toMatch(/\.next\/standalone/);
    expect(docker).toMatch(/USER node/);
    expect(existsSync("public/.gitkeep")).toBe(true);
    expect(docker).toMatch(/HEALTHCHECK.*\/api\/health/);
    expect(read("next.config.ts")).toMatch(/output:\s*["']standalone["']/);
  });
  it("limita a porta local e exige configuracao do Supabase", () => {
    const compose = read("docker-compose.yml");
    expect(compose).toContain("127.0.0.1:3000:3000");
    expect(compose).toContain("NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL:?");
    expect(compose).toContain('profiles: ["scheduler"]');
    const env = read(".env.example");
    for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "CRON_SECRET", "NEXT_PUBLIC_BRAND_FAVICON_URL", "NEXT_PUBLIC_BRAND_SUPPORT_WHATSAPP"]) expect(env).toContain(`${key}=`);
  });
});
