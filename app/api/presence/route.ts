import { and, eq, gte, lte } from "drizzle-orm";
import { members, plans } from "../../../db/schema";
import {
  enforceMemberRateLimit,
  isIsoDate,
  privateJson,
  publicPlace,
  requireApprovedMember,
  resolveCanonicalPlace,
} from "../../../lib/server";
import { dateRangeDays, MAX_DATE_RANGE_DAYS } from "../../../lib/security";

function eachDate(from: string, to: string) {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end && dates.length <= MAX_DATE_RANGE_DAYS) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function withinPresenceHorizon(date: string) {
  const value = new Date(`${date}T00:00:00Z`).valueOf();
  return (
    value >= Date.now() - 366 * 86_400_000 &&
    value <= Date.now() + 2 * 366 * 86_400_000
  );
}

type Match = {
  date: string;
  mode: "home" | "travelling";
};

function contiguousPeriods(matches: Match[]) {
  const periods: Array<{
    from: string;
    to: string;
    mode: "home" | "travelling";
  }> = [];
  for (const match of matches) {
    const previous = periods.at(-1);
    const expected = previous
      ? new Date(`${previous.to}T00:00:00Z`)
      : null;
    expected?.setUTCDate(expected.getUTCDate() + 1);
    const isNext =
      expected?.toISOString().slice(0, 10) === match.date &&
      previous?.mode === match.mode;
    if (previous && isNext) {
      previous.to = match.date;
    } else {
      periods.push({ from: match.date, to: match.date, mode: match.mode });
    }
  }
  return periods;
}

export async function GET(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;
  const limited = await enforceMemberRateLimit(
    auth.member.telegramId,
    "presence",
    30,
    60,
  );
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const place = await resolveCanonicalPlace(auth.db, params.get("placeId"));
  const from = params.get("from");
  const to = params.get("to");
  if (
    !place ||
    !isIsoDate(from) ||
    !isIsoDate(to) ||
    from > to ||
    !withinPresenceHorizon(from) ||
    !withinPresenceHorizon(to) ||
    dateRangeDays(from, to) > MAX_DATE_RANGE_DAYS
  ) {
    return privateJson(
      { error: "Choose a city and a date range of one year or less" },
      { status: 400 },
    );
  }
  const dates = eachDate(from, to);

  const approved = await auth.db
    .select({
      telegramId: members.telegramId,
      firstName: members.firstName,
      lastName: members.lastName,
      homePlaceId: members.homePlaceId,
    })
    .from(members)
    .where(eq(members.status, "approved"));
  const relevantPlans = await auth.db
    .select({
      telegramId: plans.telegramId,
      placeId: plans.placeId,
      startsOn: plans.startsOn,
      endsOn: plans.endsOn,
    })
    .from(plans)
    .where(and(lte(plans.startsOn, to), gte(plans.endsOn, from)));
  const plansByMember = new Map<number, typeof relevantPlans>();
  for (const plan of relevantPlans) {
    const current = plansByMember.get(plan.telegramId) ?? [];
    current.push(plan);
    plansByMember.set(plan.telegramId, current);
  }

  const people = approved.flatMap((member) => {
    const memberPlans = plansByMember.get(member.telegramId) ?? [];
    const matches = dates.flatMap((date): Match[] => {
      const active = memberPlans.find(
        (plan) => plan.startsOn <= date && plan.endsOn >= date,
      );
      const mode = active ? ("travelling" as const) : ("home" as const);
      const location = active?.placeId ?? member.homePlaceId;
      return location === place.id ? [{ date, mode }] : [];
    });
    if (!matches.length) return [];
    const periods = contiguousPeriods(matches);
    return [
      {
        name: [member.firstName, member.lastName].filter(Boolean).join(" "),
        periods,
        travelling: periods.some((period) => period.mode === "travelling"),
      },
    ];
  });

  people.sort((left, right) =>
    left.travelling === right.travelling
      ? left.name.localeCompare(right.name)
      : left.travelling
        ? -1
        : 1,
  );
  return privateJson({
    place: publicPlace(place),
    from,
    to,
    people,
  });
}
