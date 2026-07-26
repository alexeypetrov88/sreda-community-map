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
  const [hosting, packageJson, schema, envExample] = await Promise.all([
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);
  assert.match(hosting, /"d1": "DB"/);
  assert.doesNotMatch(hosting, /"project_id"/);
  assert.doesNotMatch(envExample, /\b\d{8,12}:AA[A-Za-z0-9_-]{30,}\b/);
  assert.match(
    envExample,
    /^SREDA_ADMIN_USERNAMES=community_owner,community_moderator$/m,
  );
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(schema, /members/);
  assert.match(schema, /plans/);
  assert.match(schema, /membershipRequests/);
  assert.match(schema, /adminDecisionMessages/);
  assert.match(schema, /auditEvents/);
  assert.match(packageJson, /"version": "1\.0\.0"/);
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", root)));
});

test("final membership decisions clear every recorded admin keyboard", async () => {
  const [route, telegram] = await Promise.all([
    readFile(new URL("app/api/telegram/route.ts", root), "utf8"),
    readFile(new URL("lib/telegram.ts", root), "utf8"),
  ]);
  assert.match(route, /clearDecisionMessages/);
  assert.match(route, /adminDecisionMessages/);
  assert.match(route, /rememberDecisionMessage\(requestRecord\.id, message\)/);
  assert.match(telegram, /editMessageReplyMarkup/);
  assert.match(telegram, /inline_keyboard: \[\]/);
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

test("members can edit the display name used by map and presence views", async () => {
  const [source, meRoute, mapRoute, presenceRoute, schema, migration] =
    await Promise.all([
      readFile(new URL("app/SredaApp.tsx", root), "utf8"),
      readFile(new URL("app/api/me/route.ts", root), "utf8"),
      readFile(new URL("app/api/map/route.ts", root), "utf8"),
      readFile(new URL("app/api/presence/route.ts", root), "utf8"),
      readFile(new URL("db/schema.ts", root), "utf8"),
      readFile(new URL("drizzle/0004_purple_brood.sql", root), "utf8"),
    ]);
  assert.match(schema, /displayName: text\("display_name"\)/);
  assert.match(migration, /"first_name" \|\|/);
  assert.match(source, /className="profile-form"/);
  assert.match(source, /method: "PATCH"/);
  assert.match(meRoute, /normalizeDisplayName\(payload\.displayName\)/);
  assert.match(meRoute, /\.set\(\{ displayName \}\)/);
  assert.match(mapRoute, /name: memberDisplayName\(member\)/);
  assert.match(presenceRoute, /name: memberDisplayName\(member\)/);
});

test("mobile date fields are constrained to their grid column", async () => {
  const styles = await readFile(new URL("app/globals.css", root), "utf8");
  assert.match(styles, /\.two-columns input\[type="date"\]/);
  assert.match(styles, /max-inline-size:\s*100%/);
  assert.match(styles, /-webkit-appearance:\s*none/);
  assert.match(
    styles,
    /@media \(max-width: 560px\)[\s\S]*\.quick-actions,\s*\.two-columns,\s*\.profile-form\s*\{[\s\S]*grid-template-columns:\s*1fr/,
  );
  assert.match(styles, /\.date-stepper > \*/);
  assert.match(
    styles,
    /\.date-input\s*\{[\s\S]*max-inline-size:\s*100%[\s\S]*-webkit-appearance:\s*none/,
  );
});

test("travelling map popups show the active visit date range", async () => {
  const [source, mapRoute, styles] = await Promise.all([
    readFile(new URL("app/SredaApp.tsx", root), "utf8"),
    readFile(new URL("app/api/map/route.ts", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(mapRoute, /startsOn: plans\.startsOn/);
  assert.match(mapRoute, /endsOn: plans\.endsOn/);
  assert.match(mapRoute, /startsOn: activePlan\.startsOn/);
  assert.match(mapRoute, /endsOn: activePlan\.endsOn/);
  assert.match(source, /popup-visit-dates/);
  assert.match(source, /friendlyDate\(person\.startsOn\)/);
  assert.match(source, /friendlyDate\(person\.endsOn\)/);
  assert.match(styles, /\.popup-visit-dates/);
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
