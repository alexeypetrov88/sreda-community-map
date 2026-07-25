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
  assert.match(serverBundle, /Sreda — find your people nearby/i);
  assert.match(clientBundle, /private community map/i);
  assert.match(clientBundle, /Who is here today/i);
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
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", root)));
});
