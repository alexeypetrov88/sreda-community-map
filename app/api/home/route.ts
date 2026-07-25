import { eq } from "drizzle-orm";
import { members } from "../../../db/schema";
import {
  enforceMemberRateLimit,
  parseJsonObject,
  privateJson,
  publicPlace,
  requireApprovedMember,
  resolveCanonicalPlace,
  routeError,
} from "../../../lib/server";

export async function POST(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;
  const limited = await enforceMemberRateLimit(
    auth.member.telegramId,
    "home-write",
    10,
    3_600,
  );
  if (limited) return limited;

  try {
    const payload = await parseJsonObject(request);
    const place = await resolveCanonicalPlace(auth.db, payload.placeId);
    if (!place) {
      return privateJson(
        { error: "Choose a city from the search results" },
        { status: 400 },
      );
    }

    await auth.db
      .update(members)
      .set({ homePlaceId: place.id })
      .where(eq(members.telegramId, auth.member.telegramId));
    return privateJson({ home: publicPlace(place) });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;
  const limited = await enforceMemberRateLimit(
    auth.member.telegramId,
    "home-write",
    10,
    3_600,
  );
  if (limited) return limited;

  await auth.db
    .update(members)
    .set({ homePlaceId: null })
    .where(eq(members.telegramId, auth.member.telegramId));
  return privateJson({ home: null });
}
