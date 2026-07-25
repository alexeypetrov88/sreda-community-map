import { and, eq, gte, lte } from "drizzle-orm";
import { members, places, plans } from "../../../db/schema";
import {
  enforceMemberRateLimit,
  isIsoDate,
  privateJson,
  requireApprovedMember,
} from "../../../lib/server";

function dateWithinMapHorizon(date: string) {
  const selected = new Date(`${date}T00:00:00Z`).valueOf();
  const now = Date.now();
  return (
    selected >= now - 366 * 86_400_000 &&
    selected <= now + 2 * 366 * 86_400_000
  );
}

export async function GET(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;
  const limited = await enforceMemberRateLimit(
    auth.member.telegramId,
    "map",
    30,
    60,
  );
  if (limited) return limited;

  const date = new URL(request.url).searchParams.get("date");
  if (!isIsoDate(date) || !dateWithinMapHorizon(date)) {
    return privateJson(
      { error: "Choose a date within the supported map range" },
      { status: 400 },
    );
  }

  const approved = await auth.db
    .select({
      telegramId: members.telegramId,
      firstName: members.firstName,
      lastName: members.lastName,
      home: places,
    })
    .from(members)
    .leftJoin(places, eq(members.homePlaceId, places.id))
    .where(eq(members.status, "approved"));
  const activePlans = await auth.db
    .select({
      telegramId: plans.telegramId,
      place: places,
    })
    .from(plans)
    .innerJoin(places, eq(plans.placeId, places.id))
    .where(and(lte(plans.startsOn, date), gte(plans.endsOn, date)));
  const activeByMember = new Map(
    activePlans.map((plan) => [plan.telegramId, plan.place]),
  );

  const people = approved.flatMap((member) => {
    const activePlace = activeByMember.get(member.telegramId);
    const place = activePlace ?? member.home;
    if (!place) return [];
    return [
      {
        name: [member.firstName, member.lastName].filter(Boolean).join(" "),
        city: place.city,
        country: place.country,
        countryCode: place.countryCode,
        lat: place.lat,
        lng: place.lng,
        mode: activePlace ? ("travelling" as const) : ("home" as const),
      },
    ];
  });

  return privateJson({ date, people });
}
