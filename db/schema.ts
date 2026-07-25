import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const memberStatuses = [
  "pending",
  "approved",
  "rejected",
  "revoked",
  "blocked",
] as const;

export const requestStatuses = [
  "pending",
  "approved",
  "rejected",
  "expired",
] as const;

export const places = sqliteTable(
  "places",
  {
    id: text("id").primaryKey(),
    canonicalKey: text("canonical_key").notNull(),
    city: text("city").notNull(),
    country: text("country").notNull(),
    countryCode: text("country_code").notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("places_canonical_key_idx").on(table.canonicalKey),
    check("places_id_check", sql`length(${table.id}) BETWEEN 16 AND 64`),
    check("places_city_check", sql`length(${table.city}) BETWEEN 1 AND 100`),
    check(
      "places_country_check",
      sql`length(${table.country}) BETWEEN 1 AND 100`,
    ),
    check(
      "places_country_code_check",
      sql`length(${table.countryCode}) = 2`,
    ),
    check("places_lat_check", sql`${table.lat} BETWEEN -90 AND 90`),
    check("places_lng_check", sql`${table.lng} BETWEEN -180 AND 180`),
  ],
);

export const members = sqliteTable(
  "members",
  {
    telegramId: integer("telegram_id").primaryKey(),
    username: text("username"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    status: text("status", { enum: memberStatuses })
      .notNull()
      .default("pending"),
    requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    approvedAt: text("approved_at"),
    approvedBy: integer("approved_by"),
    statusChangedAt: text("status_changed_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    homePlaceId: text("home_place_id").references(() => places.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("members_status_idx").on(table.status),
    check(
      "members_status_check",
      sql`${table.status} IN ('pending','approved','rejected','revoked','blocked')`,
    ),
    check(
      "members_first_name_check",
      sql`length(${table.firstName}) BETWEEN 1 AND 100`,
    ),
    check(
      "members_last_name_check",
      sql`${table.lastName} IS NULL OR length(${table.lastName}) <= 100`,
    ),
    check(
      "members_username_check",
      sql`${table.username} IS NULL OR length(${table.username}) <= 64`,
    ),
  ],
);

export const adminClaims = sqliteTable(
  "admin_claims",
  {
    username: text("username").primaryKey(),
    telegramId: integer("telegram_id").notNull(),
    claimedAt: text("claimed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("admin_claims_telegram_id_idx").on(table.telegramId),
    check(
      "admin_claims_username_check",
      sql`length(${table.username}) BETWEEN 5 AND 32`,
    ),
  ],
);

export const membershipRequests = sqliteTable(
  "membership_requests",
  {
    id: text("id").primaryKey(),
    telegramId: integer("telegram_id")
      .notNull()
      .references(() => members.telegramId, { onDelete: "cascade" }),
    status: text("status", { enum: requestStatuses })
      .notNull()
      .default("pending"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
    decidedAt: text("decided_at"),
    decidedBy: integer("decided_by"),
  },
  (table) => [
    index("membership_requests_member_idx").on(table.telegramId),
    index("membership_requests_status_idx").on(table.status, table.expiresAt),
    uniqueIndex("membership_requests_one_pending_idx")
      .on(table.telegramId)
      .where(sql`${table.status} = 'pending'`),
    check(
      "membership_requests_status_check",
      sql`${table.status} IN ('pending','approved','rejected','expired')`,
    ),
  ],
);

export const adminDecisionMessages = sqliteTable(
  "admin_decision_messages",
  {
    requestId: text("request_id")
      .notNull()
      .references(() => membershipRequests.id, { onDelete: "cascade" }),
    chatId: integer("chat_id").notNull(),
    messageId: integer("message_id").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({
      columns: [table.requestId, table.chatId, table.messageId],
      name: "admin_decision_messages_pk",
    }),
    index("admin_decision_messages_request_idx").on(table.requestId),
  ],
);

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    telegramId: integer("telegram_id")
      .notNull()
      .references(() => members.telegramId, { onDelete: "cascade" }),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "restrict" }),
    startsOn: text("starts_on").notNull(),
    endsOn: text("ends_on").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("plans_member_idx").on(table.telegramId),
    index("plans_dates_idx").on(table.startsOn, table.endsOn),
    check("plans_dates_check", sql`${table.startsOn} <= ${table.endsOn}`),
  ],
);

export const citySearchCache = sqliteTable("city_search_cache", {
  query: text("query").primaryKey(),
  resultsJson: text("results_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    actorTelegramId: integer("actor_telegram_id"),
    targetTelegramId: integer("target_telegram_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("audit_events_created_idx").on(table.createdAt),
    index("audit_events_target_idx").on(table.targetTelegramId),
    check("audit_events_type_check", sql`length(${table.type}) BETWEEN 1 AND 64`),
  ],
);

export const telegramUpdates = sqliteTable("telegram_updates", {
  updateId: integer("update_id").primaryKey(),
  processedAt: text("processed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const rateLimitCounters = sqliteTable("rate_limit_counters", {
  id: text("id").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
