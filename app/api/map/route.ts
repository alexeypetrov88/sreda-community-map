import { and, eq, gte, lte } from "drizzle-orm";
import { members, plans } from "../../../db/schema";
import { isIsoDate, requireApprovedMember } from "../../../lib/server";

export async function GET(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;

  const date = new URL(request.url).searchParams.get("date");
  if (!isIsoDate(date)) {
    return Response.json({ error: "A valid date is required" }, { status: 400 });
  }

  const approved = await auth.db
    .select()
    .from(members)
    .where(eq(members.status, "approved"));
  const activePlans = await auth.db
    .select()
    .from(plans)
    .where(and(lte(plans.startsOn, date), gte(plans.endsOn, date)));
  const activeByMember = new Map(
    activePlans.map((plan) => [plan.telegramId, plan]),
  );

  const people = approved.flatMap((member) => {
    const plan = activeByMember.get(member.telegramId);
    const location = plan
      ? {
          city: plan.city,
          country: plan.country,
          countryCode: plan.countryCode,
          lat: plan.lat,
          lng: plan.lng,
          mode: "travelling" as const,
          startsOn: plan.startsOn,
          endsOn: plan.endsOn,
        }
      : member.homeCity &&
          member.homeCountry &&
          member.homeCountryCode &&
          member.homeLat !== null &&
          member.homeLng !== null
        ? {
            city: member.homeCity,
            country: member.homeCountry,
            countryCode: member.homeCountryCode,
            lat: member.homeLat,
            lng: member.homeLng,
            mode: "home" as const,
            startsOn: null,
            endsOn: null,
          }
        : null;
    if (!location) return [];
    return [
      {
        name: [member.firstName, member.lastName].filter(Boolean).join(" "),
        username: member.username,
        ...location,
      },
    ];
  });

  return Response.json({ date, people });
}
