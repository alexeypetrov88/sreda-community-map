import { eq } from "drizzle-orm";
import { citySearchCache } from "../../../db/schema";
import { requireApprovedMember, runtimeConfig } from "../../../lib/server";

type NominatimResult = {
  name?: string;
  lat: string;
  lon: string;
  type?: string;
  addresstype?: string;
  address?: Record<string, string>;
};

export async function GET(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;
  const query = (new URL(request.url).searchParams.get("q") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (query.length < 2 || query.length > 100) {
    return Response.json({ error: "Enter a city name" }, { status: 400 });
  }
  const cacheKey = query.toLocaleLowerCase();
  const [cached] = await auth.db
    .select()
    .from(citySearchCache)
    .where(eq(citySearchCache.query, cacheKey))
    .limit(1);
  if (cached) {
    return Response.json({ results: JSON.parse(cached.resultsJson), cached: true });
  }

  const config = runtimeConfig();
  const baseUrl = config.GEOCODER_URL ?? "https://nominatim.openstreetmap.org/search";
  const url = new URL(baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("featuretype", "city");
  url.searchParams.set("limit", "8");
  const response = await fetch(url, {
    headers: {
      "user-agent": `SredaCommunityMap/1.0${config.GEOCODER_CONTACT ? ` (${config.GEOCODER_CONTACT})` : ""}`,
      referer: new URL(request.url).origin,
      accept: "application/json",
    },
  });
  if (!response.ok) {
    return Response.json(
      { error: "City search is temporarily unavailable" },
      { status: 502 },
    );
  }
  const raw = (await response.json()) as NominatimResult[];
  const allowed = new Set([
    "city",
    "town",
    "village",
    "municipality",
    "administrative",
  ]);
  const seen = new Set<string>();
  const results = raw.flatMap((item) => {
    const address = item.address ?? {};
    const city =
      address.city ??
      address.town ??
      address.village ??
      address.municipality ??
      item.name;
    const country = address.country;
    const countryCode = address.country_code?.toUpperCase();
    const lat = Number(item.lat);
    const lng = Number(item.lon);
    const type = item.addresstype ?? item.type ?? "";
    if (
      !city ||
      !country ||
      !countryCode ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      !allowed.has(type)
    ) {
      return [];
    }
    const key = `${city.toLocaleLowerCase()}|${countryCode}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ city, country, countryCode, lat, lng }];
  });

  await auth.db
    .insert(citySearchCache)
    .values({ query: cacheKey, resultsJson: JSON.stringify(results) })
    .onConflictDoUpdate({
      target: citySearchCache.query,
      set: { resultsJson: JSON.stringify(results) },
    });
  return Response.json({ results, cached: false });
}
