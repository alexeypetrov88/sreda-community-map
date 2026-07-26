"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready(): void;
        expand(): void;
        themeParams?: Record<string, string>;
      };
    };
  }
}

type LeafletApi = typeof import("leaflet");

type Place = {
  placeId: string;
  city: string;
  country: string;
  countryCode: string;
};

type Plan = Place & {
  id: string;
  startsOn: string;
  endsOn: string;
};

type Person = {
  city: string;
  country: string;
  countryCode: string;
  name: string;
  lat: number;
  lng: number;
  mode: "home" | "travelling";
  startsOn?: string;
  endsOn?: string;
};

type MemberData = {
  member: {
    firstName: string;
    lastName?: string | null;
    displayName: string;
    username?: string | null;
    home: Place | null;
  };
  upcomingPlans: Plan[];
};

type PresencePerson = {
  name: string;
  travelling: boolean;
  periods: Array<{
    from: string;
    to: string;
    mode: "home" | "travelling";
  }>;
};

function today() {
  const value = new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function friendlyDate(date: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: date.slice(0, 4) === today().slice(0, 4) ? undefined : "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts.at(-1)?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });
}

let leafletPromise: Promise<LeafletApi> | null = null;
function loadLeaflet() {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (leafletPromise) return leafletPromise;
  leafletPromise = import("leaflet");
  return leafletPromise;
}

function CityPicker({
  value,
  onChange,
  api,
}: {
  value: Place | null;
  onChange: (place: Place) => void;
  api: <T>(path: string, options?: RequestInit) => Promise<T>;
}) {
  const [query, setQuery] = useState(value ? `${value.city}, ${value.country}` : "");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    if (query.trim().length < 2) return;
    setSearching(true);
    setError("");
    try {
      const data = await api<{ results: Place[] }>(
        `/api/geocode?q=${encodeURIComponent(query.trim())}`,
      );
      setResults(data.results);
      if (!data.results.length) setError("No cities found. Try adding the country.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "City search failed");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div>
      <div className="city-search-row">
        <input
          className="field"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void search();
          }}
          placeholder="City, country"
          aria-label="City and country"
        />
        <button
          className="button secondary"
          type="button"
          disabled={searching}
          onClick={() => void search()}
        >
          {searching ? "Searching…" : "Find"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {results.length > 0 && (
        <div className="city-results">
          {results.map((place) => {
            const selected =
              value?.city === place.city &&
              value?.countryCode === place.countryCode;
            return (
              <button
                className={`city-result${selected ? " selected" : ""}`}
                type="button"
                key={`${place.city}-${place.countryCode}`}
                onClick={() => {
                  onChange(place);
                  setQuery(`${place.city}, ${place.country}`);
                  setResults([]);
                }}
              >
                <span>
                  <strong>{place.city}</strong>
                  <br />
                  <small>{place.country}</small>
                </span>
                <span>{selected ? "Selected" : "Choose"}</span>
              </button>
            );
          })}
        </div>
      )}
      {value && !results.length && (
        <div className="notice" style={{ marginTop: 8 }}>
          Selected: <strong>{value.city}, {value.country}</strong>
        </div>
      )}
    </div>
  );
}

function SredaMap({ people }: { people: Person[] }) {
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let map: LeafletMap | undefined;
    loadLeaflet()
      .then((L) => {
        if (disposed || !elementRef.current) return;
        map = L.map(elementRef.current, {
          zoomControl: true,
          attributionControl: true,
          worldCopyJump: true,
        }).setView([35, 10], 2);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);

        const grouped = new Map<string, Person[]>();
        for (const person of people) {
          const key = `${person.city}|${person.countryCode}|${person.lat}|${person.lng}`;
          grouped.set(key, [...(grouped.get(key) ?? []), person]);
        }
        const bounds: [number, number][] = [];
        for (const group of grouped.values()) {
          const sample = group[0];
          bounds.push([sample.lat, sample.lng]);
          const hasTravellers = group.some((person) => person.mode === "travelling");
          const icon = L.divIcon({
            className: "",
            html: `<div class="city-marker${hasTravellers ? " travel" : ""}"><span>${group.length}</span></div>`,
            iconSize: [38, 38],
            iconAnchor: [19, 38],
            popupAnchor: [0, -34],
          });
          const popup = [
            `<div class="popup-title">${escapeHtml(sample.city)}, ${escapeHtml(sample.country)}</div>`,
            ...group
              .sort((a, b) =>
                a.mode === b.mode ? a.name.localeCompare(b.name) : a.mode === "travelling" ? -1 : 1,
              )
              .map((person) => {
                const visitDates =
                  person.mode === "travelling" &&
                  person.startsOn &&
                  person.endsOn
                    ? `<div class="popup-visit-dates">${escapeHtml(friendlyDate(person.startsOn))} – ${escapeHtml(friendlyDate(person.endsOn))}</div>`
                    : "";
                return `<div class="popup-person"><div><strong>${escapeHtml(person.name)}</strong> · ${person.mode === "travelling" ? "visiting" : "home"}</div>${visitDates}</div>`;
              }),
          ].join("");
          L.marker([sample.lat, sample.lng], { icon }).addTo(map).bindPopup(popup);
        }
        if (bounds.length === 1) map.setView(bounds[0], 7);
        if (bounds.length > 1) map.fitBounds(bounds, { padding: [45, 45], maxZoom: 7 });
      })
      .catch(() => {
        if (elementRef.current) {
          elementRef.current.textContent = "The map could not load.";
        }
      });
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [people]);

  return <div ref={elementRef} className="map map-loading">Loading map…</div>;
}

export function SredaApp() {
  const [initData, setInitData] = useState("");
  const [telegramReady, setTelegramReady] = useState(false);
  const [tab, setTab] = useState<"map" | "plans" | "who">("map");
  const [memberData, setMemberData] = useState<MemberData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState("");
  const [mapDate, setMapDate] = useState(today());
  const [mapPeople, setMapPeople] = useState<Person[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [formMode, setFormMode] = useState<"home" | "current" | "future" | null>(
    null,
  );
  const [formPlace, setFormPlace] = useState<Place | null>(null);
  const [startsOn, setStartsOn] = useState(today());
  const [endsOn, setEndsOn] = useState(addDays(today(), 7));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteAccountConfirm, setDeleteAccountConfirm] = useState(false);
  const [whoPlace, setWhoPlace] = useState<Place | null>(null);
  const [whoFrom, setWhoFrom] = useState(today());
  const [whoTo, setWhoTo] = useState(today());
  const [whoPeople, setWhoPeople] = useState<PresencePerson[] | null>(null);
  const [whoLoading, setWhoLoading] = useState(false);

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    queueMicrotask(() => {
      if (webApp?.initData) {
        webApp.ready();
        webApp.expand();
        setInitData(webApp.initData);
      }
      setTelegramReady(true);
    });
  }, []);

  const api = useCallback(
    async <T,>(path: string, options: RequestInit = {}) => {
      const response = await fetch(path, {
        ...options,
        headers: {
          "content-type": "application/json",
          "x-telegram-init-data": initData,
          ...(options.headers ?? {}),
        },
      });
      const data = (await response.json()) as T & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Something went wrong");
      return data;
    },
    [initData],
  );

  const loadMember = useCallback(async () => {
    if (!initData) return;
    setLoading(true);
    try {
      const data = await api<MemberData>("/api/me");
      setMemberData(data);
      setDisplayNameDraft(data.member.displayName);
      setWhoPlace((currentPlace) => {
        if (currentPlace) return currentPlace;
        const current = data.upcomingPlans.find(
          (plan) => plan.startsOn <= today() && plan.endsOn >= today(),
        );
        return current ?? data.member.home;
      });
      setFatalError("");
    } catch (reason) {
      setFatalError(reason instanceof Error ? reason.message : "Could not open Sreda");
    } finally {
      setLoading(false);
    }
  }, [api, initData]);

  useEffect(() => {
    void Promise.resolve().then(loadMember);
  }, [loadMember]);

  useEffect(() => {
    if (!initData || tab !== "map") return;
    void Promise.resolve().then(() => {
      setMapLoading(true);
      return api<{ people: Person[] }>(`/api/map?date=${mapDate}`)
        .then((data) => setMapPeople(data.people))
        .catch((reason) =>
          setFatalError(reason instanceof Error ? reason.message : "Map failed"),
        )
        .finally(() => setMapLoading(false));
    });
  }, [api, initData, mapDate, tab]);

  const displayName = memberData?.member.displayName ?? "";

  const currentLocation = useMemo(() => {
    const active = memberData?.upcomingPlans.find(
      (plan) => plan.startsOn <= today() && plan.endsOn >= today(),
    );
    return active ?? memberData?.member.home ?? null;
  }, [memberData]);

  function openForm(mode: "home" | "current" | "future") {
    setFormMode(mode);
    setFormError("");
    setFormPlace(mode === "home" ? memberData?.member.home ?? null : null);
    setStartsOn(mode === "current" ? today() : addDays(today(), 1));
    setEndsOn(mode === "current" ? addDays(today(), 7) : addDays(today(), 8));
  }

  async function saveForm(event: FormEvent) {
    event.preventDefault();
    if (!formMode || !formPlace) {
      setFormError("Choose a city first.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      if (formMode === "home") {
        await api("/api/home", {
          method: "POST",
          body: JSON.stringify({ placeId: formPlace.placeId }),
        });
      } else {
        await api("/api/plans", {
          method: "POST",
          body: JSON.stringify({
            placeId: formPlace.placeId,
            startsOn,
            endsOn,
          }),
        });
      }
      setFormMode(null);
      await loadMember();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function removeHome() {
    try {
      await api("/api/home", { method: "DELETE" });
      await loadMember();
    } catch (reason) {
      setFormError(
        reason instanceof Error ? reason.message : "Could not remove home city",
      );
    }
  }

  async function saveDisplayName(event: FormEvent) {
    event.preventDefault();
    setProfileSaving(true);
    setProfileError("");
    try {
      const data = await api<{ displayName: string }>("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ displayName: displayNameDraft }),
      });
      setDisplayNameDraft(data.displayName);
      setMemberData((current) =>
        current
          ? {
              ...current,
              member: { ...current.member, displayName: data.displayName },
            }
          : current,
      );
    } catch (reason) {
      setProfileError(
        reason instanceof Error ? reason.message : "Could not save your name",
      );
    } finally {
      setProfileSaving(false);
    }
  }

  async function deleteAccount() {
    if (!deleteAccountConfirm) {
      setDeleteAccountConfirm(true);
      return;
    }
    try {
      await api("/api/me", {
        method: "DELETE",
        body: JSON.stringify({ confirmation: "delete-my-data" }),
      });
      setMemberData(null);
      setFatalError(
        "Your Sreda profile, home city and trips have been permanently deleted.",
      );
    } catch (reason) {
      setFormError(
        reason instanceof Error ? reason.message : "Could not delete your data",
      );
    }
  }

  async function deletePlan(id: string) {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id);
      return;
    }
    try {
      await api(`/api/plans?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setDeleteConfirm("");
      await loadMember();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Could not cancel trip");
    }
  }

  async function findPeople(useToday = false) {
    if (!whoPlace) return;
    const from = useToday ? today() : whoFrom;
    const to = useToday ? today() : whoTo;
    if (useToday) {
      setWhoFrom(from);
      setWhoTo(to);
    }
    setWhoLoading(true);
    setWhoPeople(null);
    try {
      const params = new URLSearchParams({
        placeId: whoPlace.placeId,
        from,
        to,
      });
      const data = await api<{ people: PresencePerson[] }>(
        `/api/presence?${params}`,
      );
      setWhoPeople(data.people);
    } catch (reason) {
      setFatalError(reason instanceof Error ? reason.message : "Search failed");
    } finally {
      setWhoLoading(false);
    }
  }

  if (!telegramReady || (initData && loading && !memberData)) {
    return (
      <main className="outside">
        <div className="outside-card card">
          <div className="brand-mark" aria-hidden="true" />
          <h1>Sreda</h1>
          <p>Opening the private community map…</p>
        </div>
      </main>
    );
  }

  if (!initData) {
    return (
      <main className="outside">
        <div className="outside-card card">
          <div className="brand-mark" aria-hidden="true" />
          <h1>Sreda</h1>
          <p>
            This map is private. Open the invitation link shared inside Sreda,
            then wait for an admin to approve your membership.
          </p>
        </div>
      </main>
    );
  }

  if (fatalError && !memberData) {
    return (
      <main className="outside">
        <div className="outside-card card">
          <div className="brand-mark" aria-hidden="true" />
          <h1>Not open yet</h1>
          <p>{fatalError}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="sreda-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true" />
          Sreda
        </div>
        <div className="top-date">{friendlyDate(today())}</div>
      </header>

      {tab === "map" && (
        <>
          <section className="hero">
            <div>
              <p className="eyebrow">Sreda Community Map</p>
              <h1>Find your people, wherever you are.</h1>
              <p>
                Travellers are highlighted so a short overlap never slips past.
              </p>
            </div>
            {memberData && (
              <div className="avatar" title={displayName}>
                {initials(displayName)}
              </div>
            )}
          </section>
          {fatalError && <div className="error">{fatalError}</div>}
          {!memberData?.member.home && (
            <div className="notice" style={{ marginBottom: 12 }}>
              Add your home city under Plans to appear on the map.
            </div>
          )}
          <section className="card map-card">
            <div className="map-toolbar">
              <div className="date-stepper">
                <button
                  className="icon-button"
                  onClick={() => setMapDate(addDays(mapDate, -1))}
                  aria-label="Previous day"
                >
                  ‹
                </button>
                <input
                  className="date-input"
                  type="date"
                  value={mapDate}
                  onChange={(event) => setMapDate(event.target.value)}
                  aria-label="Map date"
                />
                <button
                  className="icon-button"
                  onClick={() => setMapDate(addDays(mapDate, 1))}
                  aria-label="Next day"
                >
                  ›
                </button>
              </div>
              <button
                className="button secondary"
                disabled={mapDate === today()}
                onClick={() => setMapDate(today())}
              >
                Today
              </button>
            </div>
            {mapLoading ? (
              <div className="map map-loading">Updating the map…</div>
            ) : (
              <SredaMap people={mapPeople} />
            )}
            <div className="map-legend">
              <span className="legend-item">
                <span className="legend-dot travel" /> Travelling
              </span>
              <span className="legend-item">
                <span className="legend-dot" /> Home
              </span>
              <span>{mapPeople.length} people shown</span>
            </div>
          </section>
          <div className="footer-note">
            City-level locations only. Map tiles © OpenStreetMap contributors.
          </div>
        </>
      )}

      {tab === "plans" && (
        <>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Your profile</p>
              <h2>Name, home & trips</h2>
              <p>Only approved Sreda members can see these.</p>
            </div>
          </div>
          <div className="stack">
            <section className="card panel">
              <div className="panel-title">
                <h3>Display name</h3>
              </div>
              <p className="muted profile-help">
                This is how other Sreda members will see you on the map.
              </p>
              <form className="profile-form" onSubmit={saveDisplayName}>
                <input
                  className="field"
                  type="text"
                  value={displayNameDraft}
                  maxLength={100}
                  autoComplete="name"
                  aria-label="Display name"
                  onChange={(event) => {
                    setDisplayNameDraft(event.target.value);
                    setProfileError("");
                  }}
                />
                <button
                  className="button secondary"
                  type="submit"
                  disabled={
                    profileSaving ||
                    !displayNameDraft.trim() ||
                    displayNameDraft.trim() === displayName
                  }
                >
                  {profileSaving ? "Saving…" : "Save"}
                </button>
              </form>
              {profileError && <div className="error profile-error">{profileError}</div>}
            </section>

            <section className="card panel">
              <div className="panel-title">
                <h3>Home city</h3>
                <div className="form-actions">
                  {memberData?.member.home && (
                    <button
                      className="button ghost"
                      onClick={() => void removeHome()}
                    >
                      Remove
                    </button>
                  )}
                  <button
                    className="button secondary"
                    onClick={() => openForm("home")}
                  >
                    {memberData?.member.home ? "Change" : "Add"}
                  </button>
                </div>
              </div>
              {memberData?.member.home ? (
                <>
                  <p className="location-name">{memberData.member.home.city}</p>
                  <p className="muted" style={{ margin: 0 }}>
                    {memberData.member.home.country}
                  </p>
                </>
              ) : (
                <p className="muted">No home city yet.</p>
              )}
            </section>

            <div className="quick-actions">
              <button className="button coral" onClick={() => openForm("current")}>
                I’m travelling now
              </button>
              <button className="button" onClick={() => openForm("future")}>
                Plan a future trip
              </button>
            </div>

            {formMode && (
              <form className="form-card" onSubmit={saveForm}>
                <h3>
                  {formMode === "home"
                    ? "Choose your home city"
                    : formMode === "current"
                      ? "Where are you now?"
                      : "Plan a future trip"}
                </h3>
                <div className="form-grid">
                  <CityPicker value={formPlace} onChange={setFormPlace} api={api} />
                  {formMode !== "home" && (
                    <div className="two-columns">
                      <label className="label">
                        From
                        <input
                          className="field"
                          type="date"
                          value={startsOn}
                          min={formMode === "future" ? today() : undefined}
                          onChange={(event) => setStartsOn(event.target.value)}
                          disabled={formMode === "current"}
                        />
                      </label>
                      <label className="label">
                        Until
                        <input
                          className="field"
                          type="date"
                          value={endsOn}
                          min={startsOn}
                          onChange={(event) => setEndsOn(event.target.value)}
                        />
                      </label>
                    </div>
                  )}
                  {formError && <div className="error">{formError}</div>}
                  <div className="form-actions">
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => setFormMode(null)}
                    >
                      Close
                    </button>
                    <button className="button" type="submit" disabled={saving}>
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              </form>
            )}

            <section className="card panel">
              <div className="panel-title">
                <h3>All trip plans</h3>
                <span className="pill">{memberData?.upcomingPlans.length ?? 0}</span>
              </div>
              {!memberData?.upcomingPlans.length ? (
                <div className="empty">No current or future trips.</div>
              ) : (
                memberData.upcomingPlans.map((plan) => (
                  <div className="plan-row" key={plan.id}>
                    <div>
                      <div className="plan-city">
                        {plan.city}, {plan.country}
                      </div>
                      <div className="plan-meta">
                        {friendlyDate(plan.startsOn)} – {friendlyDate(plan.endsOn)}
                      </div>
                    </div>
                    <button className="plan-delete" onClick={() => deletePlan(plan.id)}>
                      {deleteConfirm === plan.id ? "Confirm" : "Cancel"}
                    </button>
                  </div>
                ))
              )}
            </section>

            <section className="card panel danger-zone">
              <div>
                <h3>Delete my Sreda data</h3>
                <p className="muted">
                  Permanently removes your profile, home city, membership request,
                  and every trip. You would need a fresh invitation to rejoin.
                </p>
              </div>
              <button
                className="plan-delete"
                onClick={() => void deleteAccount()}
              >
                {deleteAccountConfirm ? "Confirm permanent deletion" : "Delete my data"}
              </button>
            </section>
          </div>
        </>
      )}

      {tab === "who" && (
        <>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Plan a meetup</p>
              <h2>Who’s here?</h2>
              <p>Search one city across today or a date range.</p>
            </div>
          </div>
          <section className="card panel stack">
            <CityPicker value={whoPlace} onChange={setWhoPlace} api={api} />
            <div className="two-columns">
              <label className="label">
                From
                <input
                  className="field"
                  type="date"
                  value={whoFrom}
                  onChange={(event) => setWhoFrom(event.target.value)}
                />
              </label>
              <label className="label">
                Until
                <input
                  className="field"
                  type="date"
                  value={whoTo}
                  min={whoFrom}
                  onChange={(event) => setWhoTo(event.target.value)}
                />
              </label>
            </div>
            <div className="quick-actions">
              <button
                className="button coral"
                disabled={!whoPlace || whoLoading}
                onClick={() => findPeople(true)}
              >
                Who is here today?
              </button>
              <button
                className="button"
                disabled={!whoPlace || whoLoading}
                onClick={() => findPeople(false)}
              >
                {whoLoading ? "Searching…" : "Search selected dates"}
              </button>
            </div>
          </section>

          {whoPeople && (
            <section className="card panel" style={{ marginTop: 12 }}>
              <div className="panel-title">
                <h3>
                  {whoPlace?.city} · {whoPeople.length} people
                </h3>
              </div>
              {!whoPeople.length ? (
                <div className="empty">Nobody is listed there on those dates.</div>
              ) : (
                whoPeople.map((person) => (
                  <div
                    className="person-row"
                    key={`${person.name}-${person.periods[0]?.from}`}
                  >
                    <div>
                      <div className="person-name">{person.name}</div>
                      {person.periods.map((period) => (
                        <div
                          className="person-meta"
                          key={`${period.from}-${period.to}-${period.mode}`}
                        >
                          {period.from === period.to
                            ? friendlyDate(period.from)
                            : `${friendlyDate(period.from)} – ${friendlyDate(period.to)}`}
                          {" · "}
                          {period.mode === "travelling" ? "visiting" : "home"}
                        </div>
                      ))}
                    </div>
                    <span
                      className={`pill${person.travelling ? " travel" : ""}`}
                    >
                      {person.travelling ? "Visiting" : "Home"}
                    </span>
                  </div>
                ))
              )}
            </section>
          )}
          {currentLocation && !whoPlace && (
            <div className="notice">
              Your current city is {currentLocation.city}. Tap Find to search it.
            </div>
          )}
        </>
      )}

      <nav className="bottom-nav" aria-label="Main navigation">
        <button
          className={`nav-button${tab === "map" ? " active" : ""}`}
          onClick={() => setTab("map")}
        >
          Map
        </button>
        <button
          className={`nav-button${tab === "plans" ? " active" : ""}`}
          onClick={() => setTab("plans")}
        >
          Home & trips
        </button>
        <button
          className={`nav-button${tab === "who" ? " active" : ""}`}
          onClick={() => setTab("who")}
        >
          Who’s here?
        </button>
      </nav>
    </main>
  );
}
