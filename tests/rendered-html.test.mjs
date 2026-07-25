import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("builds the private Sreda entry point", async () => {
  const [serverBundle, clientFiles] = await Promise.all([
    readFile(new URL("dist/server/index.js", root), "utf8"),
    readdir(new URL("dist/client/assets/", root)),
  ]);
  const appAsset = clientFiles.find((name) => name.startsWith("SredaApp-"));
  assert.ok(appAsset);
  const clientBundle = await readFile(
    new URL(`dist/client/assets/${appAsset}`, root),
    "utf8",
  );
  assert.match(
    serverBundle,
    /Sreda Community Map — find your people nearby/i,
  );
  assert.match(clientBundle, /private community map/i);
  assert.match(clientBundle, /Who is here today/i);
  assert.doesNotMatch(clientBundle, /unpkg\.com\/leaflet/i);
  assert.doesNotMatch(`${serverBundle}\n${clientBundle}`, /codex-preview|react-loading-skeleton/i);
});

test("removes the disposable starter and declares durable storage", async () => {
  const [hosting, packageJson, schema] = await Promise.all([
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
  ]);
  assert.match(hosting, /"d1": "DB"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(schema, /members/);
  assert.match(schema, /plans/);
  assert.match(schema, /membershipRequests/);
  assert.match(schema, /auditEvents/);
  assert.match(packageJson, /"version": "1\.0\.0"/);
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", root)));
});

test("every community-data route uses the central membership guard", async () => {
  const protectedRoutes = ["me", "home", "plans", "map", "presence", "geocode"];
  for (const route of protectedRoutes) {
    const source = await readFile(
      new URL(`app/api/${route}/route.ts`, root),
      "utf8",
    );
    assert.match(
      source,
      /requireApprovedMember\(request\)/,
      `${route} must authenticate every request`,
    );
  }
});

test("build contains privacy headers and no client-coordinate write helper", async () => {
  const [worker, server, layout] = await Promise.all([
    readFile(new URL("worker/index.ts", root), "utf8"),
    readFile(new URL("lib/server.ts", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
  ]);
  assert.match(worker, /content-security-policy/i);
  assert.match(worker, /script-src 'self' 'unsafe-inline' https:\/\/telegram\.org/i);
  assert.match(worker, /script-src-attr 'none'/i);
  assert.match(worker, /private, no-store/i);
  assert.match(worker, /permissions-policy/i);
  assert.match(layout, /https:\/\/telegram\.org\/js\/telegram-web-app\.js/i);
  assert.match(layout, /strategy="beforeInteractive"/i);
  assert.doesNotMatch(server, /cleanPlace/);
});

test("city search cannot submit its parent location form", async () => {
  const source = await readFile(new URL("app/SredaApp.tsx", root), "utf8");
  assert.doesNotMatch(source, /<form className="city-search-row"/);
  assert.match(source, /className="city-search-row"/);
  assert.match(source, /onClick=\{\(\) => void search\(\)\}/);
  assert.match(source, /event\.key !== "Enter"/);
});

test("mobile date fields are constrained to their grid column", async () => {
  const styles = await readFile(new URL("app/globals.css", root), "utf8");
  assert.match(styles, /\.two-columns input\[type="date"\]/);
  assert.match(styles, /max-inline-size:\s*100%/);
  assert.match(styles, /-webkit-appearance:\s*none/);
  assert.match(
    styles,
    /@media \(max-width: 560px\)[\s\S]*\.quick-actions,\s*\.two-columns\s*\{[\s\S]*grid-template-columns:\s*1fr/,
  );
  assert.match(styles, /\.date-stepper > \*/);
  assert.match(
    styles,
    /\.date-input\s*\{[\s\S]*max-inline-size:\s*100%[\s\S]*-webkit-appearance:\s*none/,
  );
});

test("uses the approved Sreda icon throughout the app", async () => {
  const [source, styles, layout] = await Promise.all([
    readFile(new URL("app/SredaApp.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
  ]);
  const icon = new URL(
    "public/sreda-community-map-icon-v3-dark-green.png",
    root,
  );
  await access(icon);
  assert.doesNotMatch(source, /className="brand-mark"><span>S<\/span>/);
  assert.match(
    styles,
    /url\("\/sreda-community-map-icon-v3-dark-green\.png"\)/,
  );
  assert.match(layout, /sreda-community-map-icon-v3-dark-green\.png/);
});
