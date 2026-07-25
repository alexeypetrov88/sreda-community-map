import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import { plans } from "../../../db/schema";
import {
  cleanPlace,
  isIsoDate,
  requireApprovedMember,
} from "../../../lib/server";

export async function GET(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db
    .select()
    .from(plans)
    .where(eq(plans.telegramId, auth.member.telegramId))
    .orderBy(asc(plans.startsOn));
  return Response.json({ plans: rows });
}

export async function POST(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;
  const payload = (await request.json()) as Record<string, unknown>;
  const place = cleanPlace(payload);
  const startsOn = payload.startsOn;
  const endsOn = payload.endsOn;

  if (!place || !isIsoDate(startsOn) || !isIsoDate(endsOn)) {
    return Response.json({ error: "Choose a city and valid dates" }, { status: 400 });
  }
  if (startsOn > endsOn) {
    return Response.json(
      { error: "The end date must be on or after the start date" },
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
    return Response.json(
      { error: "These dates overlap another trip. Cancel it first or choose new dates." },
      { status: 409 },
    );
  }

  const plan = {
    id: crypto.randomUUID(),
    telegramId: auth.member.telegramId,
    startsOn,
    endsOn,
    ...place,
  };
  await auth.db.insert(plans).values(plan);
  return Response.json({ plan }, { status: 201 });
}

export async function DELETE(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) {
    return Response.json({ error: "Plan id is required" }, { status: 400 });
  }

  const deleted = await auth.db
    .delete(plans)
    .where(
      and(
        eq(plans.id, id),
        eq(plans.telegramId, auth.member.telegramId),
        ne(plans.id, ""),
      ),
    )
    .returning({ id: plans.id });
  if (!deleted.length) {
    return Response.json({ error: "Plan not found" }, { status: 404 });
  }
  return Response.json({ deleted: id });
}
