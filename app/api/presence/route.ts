import { and, eq, gte, lte } from "drizzle-orm";
import { members, plans } from "../../../db/schema";
import { isIsoDate, requireApprovedMember } from "../../../lib/server";

function eachDate(from: string, to: string) {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end && dates.length <= 366) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export async function GET(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;
  const params = new URL(request.url).searchParams;
  const city = (params.get("city") ?? "").trim();
  const countryCode = (params.get("countryCode") ?? "").trim().toUpperCase();
  const from = params.get("from");
  const to = params.get("to");

  if (
    !city ||
    !/^[A-Z]{2}$/.test(countryCode) ||
    !isIsoDate(from) ||
    !isIsoDate(to) ||
    from > to
  ) {
    return Response.json({ error: "Choose a city and valid date range" }, { status: 400 });
  }
  const dates = eachDate(from, to);
  if (!dates.length || dates.length > 366) {
    return Response.json(
      { error: "Date range must be one year or less" },
      { status: 400 },
    );
  }

  const approved = await auth.db
    .select()
    .from(members)
    .where(eq(members.status, "approved"));
  const relevantPlans = await auth.db
    .select()
    .from(plans)
    .where(and(lte(plans.startsOn, to), gte(plans.endsOn, from)));
  const plansByMember = new Map<number, typeof relevantPlans>();
  for (const plan of relevantPlans) {
    const current = plansByMember.get(plan.telegramId) ?? [];
    current.push(plan);
    plansByMember.set(plan.telegramId, current);
  }

  const targetCity = city.toLocaleLowerCase();
  const people = approved.flatMap((member) => {
    const memberPlans = plansByMember.get(member.telegramId) ?? [];
    const matches = dates.filter((date) => {
      const active = memberPlans.find(
        (plan) => plan.startsOn <= date && plan.endsOn >= date,
      );
      if (active) {
        return (
          active.countryCode === countryCode &&
          active.city.toLocaleLowerCase() === targetCity
        );
      }
      return (
        member.homeCountryCode === countryCode &&
        member.homeCity?.toLocaleLowerCase() === targetCity
      );
    });
    if (!matches.length) return [];
    const travelling = memberPlans.some(
      (plan) =>
        plan.countryCode === countryCode &&
        plan.city.toLocaleLowerCase() === targetCity &&
        plan.startsOn <= to &&
        plan.endsOn >= from,
    );
    return [
      {
        name: [member.firstName, member.lastName].filter(Boolean).join(" "),
        username: member.username,
        mode: travelling ? "travelling" : "home",
        firstMatchingDate: matches[0],
        lastMatchingDate: matches[matches.length - 1],
      },
    ];
  });

  people.sort((a, b) =>
    a.mode === b.mode ? a.name.localeCompare(b.name) : a.mode === "travelling" ? -1 : 1,
  );
  return Response.json({ city, countryCode, from, to, people });
}
