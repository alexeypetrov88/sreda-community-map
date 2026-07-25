import { and, asc, eq, gte } from "drizzle-orm";
import { plans } from "../../../db/schema";
import { requireApprovedMember } from "../../../lib/server";

export async function GET(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;

  const today = new Date().toISOString().slice(0, 10);
  const upcomingPlans = await auth.db
    .select()
    .from(plans)
    .where(
      and(eq(plans.telegramId, auth.member.telegramId), gte(plans.endsOn, today)),
    )
    .orderBy(asc(plans.startsOn));

  return Response.json({
    member: {
      firstName: auth.member.firstName,
      lastName: auth.member.lastName,
      username: auth.member.username,
      home: auth.member.homeCity
        ? {
            city: auth.member.homeCity,
            country: auth.member.homeCountry,
            countryCode: auth.member.homeCountryCode,
            lat: auth.member.homeLat,
            lng: auth.member.homeLng,
          }
        : null,
    },
    upcomingPlans,
  });
}
