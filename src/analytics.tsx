import ReactGA from "react-ga4";
import { beaconVisit, postVisit, type VisitInfo } from "./api/client";

const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim() ?? "";
const CLARITY_PROJECT_ID = import.meta.env.VITE_CLARITY_PROJECT_ID?.trim() ?? "";
let gaInitialized = false;
let started = false;

type EventParams = Record<string, string | number | boolean | undefined>;
type Traits = Record<string, string | undefined>;
type Umami = {
  track?: (event: string, data?: EventParams) => void;
  identify?: (data: Record<string, string>) => void;
};
type Clarity = ((...args: unknown[]) => void) & { q?: unknown[][] };
type UmamiPayload = Record<string, unknown>;
const win = window as Window & {
  umami?: Umami;
  clarity?: Clarity;
  mitospaceUmamiBeforeSend?: (type: string, payload: UmamiPayload) => UmamiPayload | null;
};

/** What this tab did, for the visit summary sent when it is hidden or closed. */
const tally = {
  pages: new Set<string>(),
  events: {} as Record<string, number>,
  activeMs: 0,
  visibleSince: 0,
  lastSent: "",
};

export const trackPageView = (path: string, title: string) => {
  tally.pages.add(path);
  if (!gaInitialized) return;
  ReactGA.send({ hitType: "pageview", page: path, title });
};

/** Product event for GA4 and Clarity (when configured) and Umami (loaded in index.html). */
export const trackEvent = (name: string, params?: EventParams) => {
  tally.events[name] = (tally.events[name] ?? 0) + 1;
  try {
    if (gaInitialized) ReactGA.event(name, params);
    win.umami?.track?.(name, params);
    win.clarity?.("event", name);
  } catch {
    // Analytics must never break the app.
  }
};

/** Failures (uncaught errors, data that did not load) as `app_error` events. */
export const trackError = (where: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  trackEvent("app_error", { where, message: message.slice(0, 150) });
};

const initializeGA = () => {
  if (!GA_MEASUREMENT_ID || gaInitialized) return;
  // The router reports page views itself; gtag's automatic one would count every load twice.
  ReactGA.initialize(GA_MEASUREMENT_ID, { gtagOptions: { send_page_view: false } });
  gaInitialized = true;
};

/** Microsoft Clarity (session recordings, heatmaps): its official loader, minus the inline script. */
const loadClarity = () => {
  if (!/^[a-z0-9]{6,20}$/i.test(CLARITY_PROJECT_ID)) return;
  const queue: Clarity = (...args) => {
    (queue.q ??= []).push(args);
  };
  win.clarity ??= queue;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}`;
  document.head.appendChild(script);
};

const store = (kind: "localStorage" | "sessionStorage") => ({
  get(key: string) {
    try {
      return window[kind].getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window[kind].setItem(key, value);
    } catch {
      // Storage blocked (private mode, policies).
    }
  },
  remove(key: string) {
    try {
      window[kind].removeItem(key);
    } catch {
      // Storage blocked.
    }
  },
});
const browserStore = store("localStorage");
const tabStore = store("sessionStorage");

const INTERNAL_KEY = "mitospace.internal";

/** `?internal=1` once per browser keeps the team's own visits out of every tool; `?internal=0` undoes it. */
const isInternalVisit = () => {
  const url = new URL(window.location.href);
  const flag = url.searchParams.get("internal");
  if (flag === "1") {
    browserStore.set(INTERNAL_KEY, "1");
    browserStore.set("umami.disabled", "1");
  } else if (flag === "0") {
    browserStore.remove(INTERNAL_KEY);
    browserStore.remove("umami.disabled");
  }
  if (flag !== null) {
    // Drop it from the address bar so a copied link doesn't exclude whoever opens it.
    url.searchParams.delete("internal");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  return browserStore.get(INTERNAL_KEY) === "1";
};

// The explorer mirrors its view into the URL; Umami would count each change as a page view.
const IGNORED_PARAMS = ["cell", "feature", "conditions", "compare", "internal"];
let lastUmamiPage = "";

const withoutViewState = (value: string) => {
  const url = new URL(value, window.location.origin);
  for (const key of IGNORED_PARAMS) url.searchParams.delete(key);
  return /^https?:/i.test(value) ? url.href : `${url.pathname}${url.search}${url.hash}`;
};

/** Umami's `data-before-send` hook (index.html): one page view per page, not per selected cell. */
const umamiBeforeSend = (type: string, payload: UmamiPayload) => {
  try {
    if (typeof payload.url === "string") payload.url = withoutViewState(payload.url);
    if (typeof payload.referrer === "string" && payload.referrer.startsWith("/")) {
      payload.referrer = withoutViewState(payload.referrer);
    }
    if (type === "event" && !payload.name) {
      if (payload.url === lastUmamiPage) return null;
      lastUmamiPage = String(payload.url);
    }
  } catch {
    // Send it unchanged.
  }
  return payload;
};

const UTM_KEYS = ["source", "medium", "campaign", "content", "term"] as const;
type Attribution = { ref?: string; utm: Partial<Record<(typeof UTM_KEYS)[number], string>>; at: number };
const ATTRIBUTION_KEY = "mitospace.attribution";
const ATTRIBUTION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** `?ref=` (personal links) and UTM tags of this landing, else the last ones this browser arrived with. */
const readAttribution = (): Attribution => {
  const params = new URLSearchParams(window.location.search);
  const utm: Attribution["utm"] = {};
  for (const key of UTM_KEYS) {
    const value = params.get(`utm_${key}`)?.trim().slice(0, 100);
    if (value) utm[key] = value;
  }
  const ref = params.get("ref")?.replace(/[^\w.~-]/g, "").slice(0, 64) || undefined;
  if (ref || Object.keys(utm).length) {
    const fresh: Attribution = { ref, utm, at: Date.now() };
    browserStore.set(ATTRIBUTION_KEY, JSON.stringify(fresh));
    return fresh;
  }
  try {
    const saved = JSON.parse(browserStore.get(ATTRIBUTION_KEY) ?? "null") as Attribution | null;
    if (saved && Date.now() - saved.at < ATTRIBUTION_MAX_AGE_MS) return { ...saved, utm: saved.utm ?? {} };
  } catch {
    // Unreadable entry: a direct visit.
  }
  return { utm: {}, at: Date.now() };
};

/** Tags the visitor in every tool, so their sessions can be filtered, compared and replayed. */
const identifyVisitor = (traits: Traits) => {
  const known = Object.fromEntries(
    Object.entries(traits).filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
  if (!Object.keys(known).length) return;
  try {
    if (gaInitialized) {
      // GA4 user properties: names up to 24 characters, values up to 36.
      const properties = Object.entries(known).map(([key, value]) => [`visitor_${key}`, value.slice(0, 36)]);
      ReactGA.gtag("set", "user_properties", Object.fromEntries(properties));
    }
    for (const [key, value] of Object.entries(known)) win.clarity?.("set", key, value);
  } catch {
    // Analytics must never break the app.
  }
  // Umami's script is deferred and may be blocked; give it a few seconds to appear.
  const identifyInUmami = (attempts: number) => {
    if (win.umami?.identify) win.umami.identify(known);
    else if (attempts > 0) window.setTimeout(() => identifyInUmami(attempts - 1), 500);
  };
  identifyInUmami(20);
};

const SID_KEY = "mitospace.sid";
const VISITOR_KEY = "mitospace.visitor";
const VISITS_KEY = "mitospace.visits";

const newVisitId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;

const visitorTraits = (info: VisitInfo): Traits => ({
  org: info.org,
  org_type: info.org_type,
  org_domain: info.org_domain,
  traffic: info.traffic,
});

/** Where the visitor came from; our own pages (reloads, internal links) are not a source. */
const externalReferrer = () => {
  try {
    return new URL(document.referrer).origin === window.location.origin ? undefined : document.referrer;
  } catch {
    return undefined;
  }
};

/** The API's own visit log (server/visits.py), which still works when blockers stop Umami and GA. */
const startVisitLog = (attribution: Attribution) => {
  let sid = tabStore.get(SID_KEY);
  const visitNumber = Math.max(1, (Number(browserStore.get(VISITS_KEY)) || 0) + (sid ? 0 : 1));
  identifyVisitor({
    ref: attribution.ref,
    campaign: attribution.utm.campaign,
    visit_number: String(visitNumber),
    returning: visitNumber > 1 ? "yes" : "no",
  });
  if (sid) {
    // A reload of the same tab is the same visit: re-apply what is known instead of starting again.
    try {
      identifyVisitor(visitorTraits(JSON.parse(tabStore.get(VISITOR_KEY) ?? "{}") as VisitInfo));
    } catch {
      // Unreadable entry.
    }
  } else {
    sid = newVisitId();
    tabStore.set(SID_KEY, sid);
    browserStore.set(VISITS_KEY, String(visitNumber));
    void postVisit({
      kind: "start",
      sid,
      landing: `${window.location.pathname}${window.location.search}`,
      referrer: externalReferrer(),
      ref: attribution.ref,
      utm: attribution.utm,
      screen: `${window.screen.width}x${window.screen.height}`,
      lang: navigator.language,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      visit_number: visitNumber,
    }).then((info) => {
      if (!info) return;
      tabStore.set(VISITOR_KEY, JSON.stringify(info));
      identifyVisitor(visitorTraits(info));
    });
  }

  const visitId = sid;
  const countActiveTime = () => {
    const now = performance.now();
    if (tally.visibleSince) tally.activeMs += now - tally.visibleSince;
    tally.visibleSince = document.visibilityState === "visible" ? now : 0;
  };
  const sendSummary = () => {
    countActiveTime();
    const summary = { active_s: Math.round(tally.activeMs / 1000), pages: [...tally.pages], events: tally.events };
    const digest = JSON.stringify(summary);
    if (digest === tally.lastSent) return;
    tally.lastSent = digest;
    beaconVisit({ kind: "end", sid: visitId, ...summary });
    // Umami's own visit time stops at the last event; this is the time the tab was actually visible.
    win.umami?.track?.("engagement", {
      active_s: summary.active_s,
      pages: summary.pages.length,
      cells: tally.events.select_cell ?? 0,
    });
  };
  tally.visibleSince = document.visibilityState === "visible" ? performance.now() : 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") sendSummary();
    else countActiveTime();
  });
  window.addEventListener("pagehide", sendSummary);
};

/** Clicks (and middle-clicks) on links to other sites: paper, code, model, lab. */
const trackOutboundLinks = () => {
  const onClick = (event: MouseEvent) => {
    if (event.type === "auxclick" && event.button !== 1) return;
    const link = (event.target as Element | null)?.closest?.("a[href]");
    if (!(link instanceof HTMLAnchorElement)) return;
    try {
      const url = new URL(link.href);
      if (url.origin === window.location.origin || !url.protocol.startsWith("http")) return;
      trackEvent("outbound_click", { host: url.hostname.replace(/^www\./, ""), path: url.pathname.slice(0, 100) });
    } catch {
      // Not a URL.
    }
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("auxclick", onClick, true);
};

/** Starts every tracker once, before the app renders. */
export const initializeAnalytics = () => {
  if (started) return;
  started = true;
  win.mitospaceUmamiBeforeSend = umamiBeforeSend;
  if (isInternalVisit()) return;
  initializeGA();
  loadClarity();
  startVisitLog(readAttribution());
  trackOutboundLinks();
};