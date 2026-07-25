import { eq, lt } from "drizzle-orm";
import { citySearchCache, places } from "../../../db/schema";
import {
  configuredAppUrl,
  consumeRateLimit,
  enforceMemberRateLimit,
  privateJson,
  publicPlace,
  requireApprovedMember,
  routeError,
  runtimeConfig,
} from "../../../lib/server";

type NominatimResult = {
  name?: string;
  lat: string;
  lon: string;
  type?: string;
  addresstype?: string;
  address?: Record<string, string>;
};

type PlaceResult = ReturnType<typeof publicPlace>;

function cleanLabel(value: unknown) {
  if (typeof value !== "string") return "";
  const cleaned = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return cleaned.length <= 100 ? cleaned : "";
}

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

async function canonicalId(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function readBoundedJson(response: Response, maximumBytes: number) {
  if (!response.body) throw new Error("Empty geocoder response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maximumBytes) {
      await reader.cancel();
      throw new Error("Geocoder response is too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body)) as unknown;
}

function validCachedResults(value: unknown): value is PlaceResult[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.placeId === "string" &&
        typeof item.city === "string" &&
        typeof item.country === "string" &&
        /^[A-Z]{2}$/.test(item.countryCode),
    )
  );
}

export async function GET(request: Request) {
  const auth = await requireApprovedMember(request);
  if ("error" in auth) return auth.error;
  const memberLimit = await enforceMemberRateLimit(
    auth.member.telegramId,
    "geocode",
    10,
    60,
  );
  if (memberLimit) return memberLimit;

  try {
    const query = (new URL(request.url).searchParams.get("q") ?? "")
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ");
    if (query.length < 2 || query.length > 100) {
      return privateJson({ error: "Enter a city name" }, { status: 400 });
    }
    const cacheKey = await canonicalId(
      `query:${query.toLocaleLowerCase()}`,
    );
    const freshAfter = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const [cached] = await auth.db
      .select()
      .from(citySearchCache)
      .where(eq(citySearchCache.query, cacheKey))
      .limit(1);
    if (cached && cached.createdAt >= freshAfter) {
      try {
        const results: unknown = JSON.parse(cached.resultsJson);
        if (validCachedResults(results)) {
          return privateJson({ results, cached: true });
        }
      } catch {
        // Replace corrupt or pre-1.0 cache records below.
      }
    }

    const globalLimit = await consumeRateLimit("geocoder", "global", 1, 1);
    if (!globalLimit.allowed) {
      return privateJson(
        { error: "City search is busy. Please try again in a moment." },
        {
          status: 429,
          headers: { "retry-after": String(globalLimit.retryAfter) },
        },
      );
    }

    const config = runtimeConfig();
    const baseUrl =
      config.GEOCODER_URL ?? "https://nominatim.openstreetmap.org/search";
    const url = new URL(baseUrl);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    ) {
      throw new Error("Invalid geocoder URL");
    }
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("featuretype", "city");
    url.searchParams.set("limit", "8");

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "user-agent": `SredaCommunityMap/1.0${config.GEOCODER_CONTACT ? ` (${config.GEOCODER_CONTACT})` : ""}`,
          referer: new URL(configuredAppUrl(request)).origin,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      return privateJson(
        { error: "City search is temporarily unavailable" },
        { status: 502 },
      );
    }
    if (!response.ok) {
      return privateJson(
        { error: "City search is temporarily unavailable" },
        { status: 502 },
      );
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > 256_000) {
      throw new Error("Geocoder response is too large");
    }

    const raw = await readBoundedJson(response, 256_000);
    if (!Array.isArray(raw)) {
      throw new Error("Invalid geocoder response");
    }
    const allowed = new Set([
      "city",
      "town",
      "village",
      "municipality",
      "administrative",
    ]);
    const seen = new Set<string>();
    const results: PlaceResult[] = [];

    for (const candidate of raw.slice(0, 20) as NominatimResult[]) {
      const address = candidate.address ?? {};
      const city = cleanLabel(
        address.city ??
          address.town ??
          address.village ??
          address.municipality ??
          candidate.name,
      );
      const country = cleanLabel(address.country);
      const countryCode = cleanLabel(address.country_code).toUpperCase();
      const lat = Number(candidate.lat);
      const lng = Number(candidate.lon);
      const type = candidate.addresstype ?? candidate.type ?? "";
      if (
        !city ||
        !country ||
        !/^[A-Z]{2}$/.test(countryCode) ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180 ||
        !allowed.has(type)
      ) {
        continue;
      }

      const dedupeKey = `${normalize(city)}|${countryCode}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const canonicalKey = `${dedupeKey}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
      const id = await canonicalId(canonicalKey);
      const place = {
        id,
        canonicalKey,
        city,
        country,
        countryCode,
        lat,
        lng,
      };
      await auth.db
        .insert(places)
        .values(place)
        .onConflictDoNothing();
      results.push(publicPlace({ ...place, createdAt: new Date().toISOString() }));
      if (results.length === 8) break;
    }

    const cachedAt = new Date().toISOString();
    await auth.db
      .insert(citySearchCache)
      .values({
        query: cacheKey,
        resultsJson: JSON.stringify(results),
        createdAt: cachedAt,
      })
      .onConflictDoUpdate({
        target: citySearchCache.query,
        set: { resultsJson: JSON.stringify(results), createdAt: cachedAt },
      });
    await auth.db
      .delete(citySearchCache)
      .where(lt(citySearchCache.createdAt, freshAfter));
    return privateJson({ results, cached: false });
  } catch (error) {
    return routeError(error);
  }
}
