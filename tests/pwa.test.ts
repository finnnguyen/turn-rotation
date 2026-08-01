import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("production-ready app shell", () => {
  it("declares an installable standalone manifest", () => {
    const manifest = readFileSync(resolve(root, "src/app/manifest.ts"), "utf8");

    expect(manifest).toContain('display: "standalone"');
    expect(manifest).toContain('start_url: "/dashboard"');
    expect(manifest).toContain('purpose: "maskable"');
  });

  it("does not cache authenticated application pages", () => {
    const worker = readFileSync(resolve(root, "public/sw.js"), "utf8");

    expect(worker).toContain('const SAFE_ASSETS = ["/offline.html"');
    expect(worker).not.toContain('cache.put(event.request');
    expect(worker).not.toContain('"/dashboard"');
  });

  it("blocks mutations while offline", () => {
    const runtime = readFileSync(
      resolve(root, "src/components/pwa-runtime.tsx"),
      "utf8",
    );

    expect(runtime).toContain('document.addEventListener("submit"');
    expect(runtime).toContain("event.preventDefault()");
    expect(runtime).toContain('navigator.serviceWorker.register("/sw.js")');
  });

  it("stores only aggregate dashboard counts for offline viewing", () => {
    const snapshot = readFileSync(
      resolve(root, "src/components/dashboard-snapshot.tsx"),
      "utf8",
    );
    const offline = readFileSync(resolve(root, "public/offline.html"), "utf8");

    expect(snapshot).toContain("waitingCount: number");
    expect(snapshot).not.toContain("customerName");
    expect(snapshot).not.toContain("employeeName");
    expect(offline).toContain("Last synchronized dashboard");
    expect(offline).toContain("textContent");
    expect(offline).not.toContain("innerHTML");
  });
});
