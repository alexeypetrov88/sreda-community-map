import { and, asc, eq, gte } from "drizzle-orm";
import { getD1 } from "../../../db";
import {
  members,
  places,
  plans,
} from "../../../db/schema";
import {
  enforceMemberRateLimit,
  parseJsonObject,
  privateJson,
  publicPlace,
  requireApprovedMember,
  routeError,
} from "../../../lib/server";

export async function GET(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const [profile] = await auth.db
    .select({
      firstName: members.firstName,
      lastName: members.lastName,
      username: members.username,
      home: places,
    })
    .from(members)
    .leftJoin(places, eq(members.homePlaceId, places.id))
    .where(eq(members.telegramId, auth.member.telegramId))
    .limit(1);
  const upcomingPlans = await auth.db
    .select({
      id: plans.id,
      startsOn: plans.startsOn,
      endsOn: plans.endsOn,
      place: places,
    })
    .from(plans)
    .innerJoin(places, eq(plans.placeId, places.id))
    .where(
      and(
        eq(plans.telegramId, auth.member.telegramId),
        gte(plans.endsOn, yesterday),
      ),
    )
    .orderBy(asc(plans.startsOn));

  return privateJson({
    member: {
      firstName: profile.firstName,
      lastName: profile.lastName,
      username: profile.username,
      home: profile.home ? publicPlace(profile.home) : null,
    },
    upcomingPlans: upcomingPlans.map((plan) => ({
      id: plan.id,
      startsOn: plan.startsOn,
      endsOn: plan.endsOn,
      ...publicPlace(plan.place),
    })),
  });
}

export async function DELETE(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;
  const limited = await enforceMemberRateLimit(
    auth.member.telegramId,
    "account-delete",
    2,
    86_400,
  );
  if (limited) return limited;

  try {
    const payload = await parseJsonObject(request);
    if (payload.confirmation !== "delete-my-data") {
      return privateJson(
        { error: "Account deletion confirmation is required" },
        { status: 400 },
      );
    }

    const telegramId = auth.member.telegramId;
    await getD1().batch([
      getD1()
        .prepare(
          "DELETE FROM audit_events WHERE actor_telegram_id = ?1 OR target_telegram_id = ?1",
        )
        .bind(telegramId),
      getD1()
        .prepare(
          "DELETE FROM rate_limit_counters WHERE id LIKE '%:' || ?1 || ':%'",
        )
        .bind(String(telegramId)),
      getD1()
        .prepare("DELETE FROM members WHERE telegram_id = ?1 AND status = 'approved'")
        .bind(telegramId),
    ]);
    return privateJson({ deleted: true });
  } catch (error) {
    return routeError(error);
  }
}
