import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const members = sqliteTable(
  "members",
  {
    telegramId: integer("telegram_id").primaryKey(),
    username: text("username"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    approvedAt: text("approved_at"),
    approvedBy: integer("approved_by"),
    homeCity: text("home_city"),
    homeCountry: text("home_country"),
    homeCountryCode: text("home_country_code"),
    homeLat: real("home_lat"),
    homeLng: real("home_lng"),
  },
  (table) => [index("members_status_idx").on(table.status)],
);

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    telegramId: integer("telegram_id")
      .notNull()
      .references(() => members.telegramId, { onDelete: "cascade" }),
    startsOn: text("starts_on").notNull(),
    endsOn: text("ends_on").notNull(),
    city: text("city").notNull(),
    country: text("country").notNull(),
    countryCode: text("country_code").notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("plans_member_idx").on(table.telegramId),
    index("plans_dates_idx").on(table.startsOn, table.endsOn),
  ],
);

export const citySearchCache = sqliteTable("city_search_cache", {
  query: text("query").primaryKey(),
  resultsJson: text("results_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
