import { eq } from "drizzle-orm";
import { members } from "../../../db/schema";
import { cleanPlace, requireApprovedMember } from "../../../lib/server";

export async function POST(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;

  const payload = (await request.json()) as Record<string, unknown>;
  const place = cleanPlace(payload);
  if (!place) {
    return Response.json({ error: "Choose a valid city" }, { status: 400 });
  }

  await auth.db
    .update(members)
    .set({
      homeCity: place.city,
      homeCountry: place.country,
      homeCountryCode: place.countryCode,
      homeLat: place.lat,
      homeLng: place.lng,
    })
    .where(eq(members.telegramId, auth.member.telegramId));

  return Response.json({ home: place });
}
