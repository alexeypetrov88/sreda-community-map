import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function applyMigration(database, name) {
  const source = await readFile(new URL(`drizzle/${name}`, root), "utf8");
  for (const statement of source.split("--> statement-breakpoint")) {
    if (statement.trim()) database.exec(statement);
  }
}

test("migrations preserve legacy data and add editable display names", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  await applyMigration(database, "0000_clean_captain_marvel.sql");
  database.exec(`
    INSERT INTO members (
      telegram_id, username, first_name, last_name, status,
      home_city, home_country, home_country_code, home_lat, home_lng
    ) VALUES (
      1001, 'member', 'Member', 'Example', 'approved',
      'London', 'United Kingdom', 'GB', 51.5074, -0.1278
    );
    INSERT INTO members (
      telegram_id, username, first_name, status,
      home_city, home_country, home_country_code, home_lat, home_lng
    ) VALUES (
      1002, 'former', 'Former', 'rejected',
      'Berlin', 'Germany', 'DE', 52.52, 13.405
    );
    INSERT INTO plans (
      id, telegram_id, starts_on, ends_on,
      city, country, country_code, lat, lng
    ) VALUES (
      '11111111-1111-4111-8111-111111111111', 1001,
      '2026-08-01', '2026-08-05',
      'Paris', 'France', 'FR', 48.8566, 2.3522
    );
    INSERT INTO plans (
      id, telegram_id, starts_on, ends_on,
      city, country, country_code, lat, lng
    ) VALUES (
      '33333333-3333-4333-8333-333333333333', 1002,
      '2026-09-01', '2026-09-05',
      'Vienna', 'Austria', 'AT', 48.2082, 16.3738
    );
  `);

  await applyMigration(database, "0001_boring_betty_brant.sql");
  database.exec(`
    UPDATE members
    SET approved_by = telegram_id, username = 'Legacy_Admin'
    WHERE telegram_id = 1001
  `);
  await applyMigration(database, "0002_furry_rockslide.sql");
  await applyMigration(database, "0003_freezing_mac_gargan.sql");
  await applyMigration(database, "0004_purple_brood.sql");

  const member = database
    .prepare(
      `SELECT status, home_place_id AS homePlaceId,
              display_name AS displayName
       FROM members WHERE telegram_id = 1001`,
    )
    .get();
  assert.deepEqual({ ...member }, {
    status: "approved",
    homePlaceId: "legacy-home-0000000000001001",
    displayName: "Member Example",
  });
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM places").get().count,
    2,
  );
  assert.equal(
    database.prepare("PRAGMA foreign_key_check").all().length,
    0,
  );
  assert.equal(
    database
      .prepare("SELECT home_place_id FROM members WHERE telegram_id = 1002")
      .get().home_place_id,
    null,
  );
  assert.equal(
    database
      .prepare("SELECT count(*) AS count FROM plans WHERE telegram_id = 1002")
      .get().count,
    0,
  );

  assert.throws(
    () =>
      database.exec(`
        INSERT INTO plans (
          id, telegram_id, place_id, starts_on, ends_on
        ) VALUES (
          '22222222-2222-4222-8222-222222222222', 1001,
          'legacy-plan-11111111111141118111111111111111',
          '2026-08-03', '2026-08-04'
        )
      `),
    /overlapping plan/i,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE members SET status = 'self-approved' WHERE telegram_id = 1001
      `),
    /constraint/i,
  );
  assert.deepEqual(
    {
      ...database
        .prepare(
          "SELECT username, telegram_id AS telegramId FROM admin_claims",
        )
        .get(),
    },
    { username: "legacy_admin", telegramId: 1001 },
  );
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO admin_claims (username, telegram_id)
        VALUES ('another_admin', 1001)
      `),
    /unique/i,
  );
  database.exec(`
    INSERT INTO membership_requests (
      id, telegram_id, expires_at
    ) VALUES (
      'decision-message-test', 1001, '2030-01-01T00:00:00.000Z'
    );
    INSERT INTO admin_decision_messages (
      request_id, chat_id, message_id
    ) VALUES (
      'decision-message-test', 1001, 77
    );
  `);
  assert.equal(
    database
      .prepare(
        "SELECT count(*) AS count FROM admin_decision_messages",
      )
      .get().count,
    1,
  );
  database.exec(
    "DELETE FROM membership_requests WHERE id = 'decision-message-test'",
  );
  assert.equal(
    database
      .prepare(
        "SELECT count(*) AS count FROM admin_decision_messages",
      )
      .get().count,
    0,
  );
});
