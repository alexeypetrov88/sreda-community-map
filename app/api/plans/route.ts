import { and, asc, eq, gte, lte } from "drizzle-orm";
import { places, plans } from "../../../db/schema";
import {
  enforceMemberRateLimit,
  isIsoDate,
  parseJsonObject,
  privateJson,
  publicPlace,
  requireApprovedMember,
  resolveCanonicalPlace,
  routeError,
} from "../../../lib/server";
import { dateRangeDays } from "../../../lib/security";

function minimumPlanDate() {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

function maximumPlanDate() {
  return new Date(Date.now() + 2 * 366 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function publicPlan(row: {
  id: string;
  startsOn: string;
  endsOn: string;
  place: typeof places.$inferSelect;
}) {
  return {
    id: row.id,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    ...publicPlace(row.place),
  };
}

export async function GET(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db
    .select({
      id: plans.id,
      startsOn: plans.startsOn,
      endsOn: plans.endsOn,
      place: places,
    })
    .from(plans)
    .innerJoin(places, eq(plans.placeId, places.id))
    .where(eq(plans.telegramId, auth.member.telegramId))
    .orderBy(asc(plans.startsOn));
  return privateJson({ plans: rows.map(publicPlan) });
}

export async function POST(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;
  const limited = await enforceMemberRateLimit(
    auth.member.telegramId,
    "plan-write",
    20,
    3_600,
  );
  if (limited) return limited;

  try {
    const payload = await parseJsonObject(request);
    const place = await resolveCanonicalPlace(auth.db, payload.placeId);
    const startsOn = payload.startsOn;
    const endsOn = payload.endsOn;
    if (!place || !isIsoDate(startsOn) || !isIsoDate(endsOn)) {
      return privateJson(
        { error: "Choose a city and valid dates" },
        { status: 400 },
      );
    }
    if (
      startsOn > endsOn ||
      startsOn < minimumPlanDate() ||
      startsOn > maximumPlanDate() ||
      dateRangeDays(startsOn, endsOn) > 366
    ) {
      return privateJson(
        {
          error:
            startsOn < minimumPlanDate()
              ? "Trips cannot start more than one day in the past"
              : startsOn > maximumPlanDate()
                ? "Trips must start within the next two years"
                : "Trips must be 366 days or shorter",
        },
        { status: 400 },
      );
    }

    const [overlap] = await auth.db
      .select({ id: plans.id })
      .from(plans)
      .where(
        and(
          eq(plans.telegramId, auth.member.telegramId),
          lte(plans.startsOn, endsOn),
          gte(plans.endsOn, startsOn),
        ),
      )
      .limit(1);
    if (overlap) {
      return privateJson(
        {
          error:
            "These dates overlap another trip. Cancel it first or choose new dates.",
        },
        { status: 409 },
      );
    }

    const plan = {
      id: crypto.randomUUID(),
      telegramId: auth.member.telegramId,
      placeId: place.id,
      startsOn,
      endsOn,
    };
    try {
      await auth.db.insert(plans).values(plan);
    } catch (error) {
      if (
        error instanceof Error &&
        /overlapping plan|constraint/i.test(error.message)
      ) {
        return privateJson(
          { error: "These dates overlap another trip." },
          { status: 409 },
        );
      }
      throw error;
    }
    return privateJson(
      {
        plan: publicPlan({
          id: plan.id,
          startsOn,
          endsOn,
          place,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;
  const limited = await enforceMemberRateLimit(
    auth.member.telegramId,
    "plan-write",
    20,
    3_600,
  );
  if (limited) return limited;

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  ) {
    return privateJson({ error: "Valid plan id is required" }, { status: 400 });
  }
  const deleted = await auth.db
    .delete(plans)
    .where(
      and(
        eq(plans.id, id),
        eq(plans.telegramId, auth.member.telegramId),
      ),
    )
    .returning({ id: plans.id });
  if (!deleted.length) {
    return privateJson({ error: "Plan not found" }, { status: 404 });
  }
  return privateJson({ deleted: id });
}
