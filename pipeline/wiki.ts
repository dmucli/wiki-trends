import type { Lang } from "../types/article.ts";

// Wikimedia asks every API client to identify itself with contact details.
const UA = process.env.WIKI_USER_AGENT ?? "WikiTrends/0.1 (https://github.com/; contact via repo issues)";

export class NotFound extends Error {}

// Wikimedia rate-limits bursts, so every request goes through one small global gate.
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiting: Array<() => void> = [];
async function gated<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(url: string, tries = 5): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    const res = await gated(() => fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } })).catch((e) => e as Error);
    if (res instanceof Error) {
      lastErr = res;
    } else if (res.status === 404) {
      throw new NotFound(url);
    } else if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`HTTP ${res.status} ${url}`);
      const retryAfter = Number(res.headers.get("retry-after"));
      if (retryAfter) {
        await sleep(Math.min(retryAfter, 60) * 1000);
        continue;
      }
    } else if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${url}`);
    } else {
      return res;
    }
    await sleep(1000 * 2 ** i);
  }
  throw lastErr;
}

export async function getJson<T = any>(url: string): Promise<T> {
  return (await (await request(url)).json()) as T;
}

export async function getText(url: string): Promise<string> {
  return (await request(url)).text();
}

const enc = (t: string) => encodeURIComponent(t.replace(/ /g, "_"));
const ymd = (d: string) => d.replace(/-/g, "");
const [Y, M, D] = [0, 1, 2];

export function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ---------- what's trending ---------- */

export interface TopItem {
  title: string; // underscore form
  views: number;
}

export async function topViews(lang: Lang, date: string): Promise<TopItem[]> {
  const p = date.split("-");
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${lang}.wikipedia/all-access/${p[Y]}/${p[M]}/${p[D]}`;
  const data = await getJson(url);
  return data.items[0].articles.map((a: any) => ({ title: a.article, views: a.views }));
}

/** Featured feed for D+1 carries `mostread` for D (bot-filtered by Wikimedia) and "In the news". */
export async function featuredFeed(lang: Lang, date: string) {
  const next = shiftDate(date, 1).split("-");
  try {
    const data = await getJson(`https://${lang}.wikipedia.org/api/rest_v1/feed/featured/${next[Y]}/${next[M]}/${next[D]}`);
    const mostread: TopItem[] = (data.mostread?.articles ?? []).map((a: any) => ({ title: a.title, views: a.views }));
    const news: string[] = (data.news ?? []).map((n: any) => stripHtml(n.story));
    return { mostread, news };
  } catch (e) {
    if (e instanceof NotFound) return { mostread: [], news: [] };
    throw e;
  }
}

/* ---------- noise filter ---------- */

const EXCLUDE_PREFIX: Record<Lang, RegExp> = {
  en: /^(Special|Wikipedia|Portal|File|Help|Template|Category|Talk|User|Draft|Module|MediaWiki|Book|TimedText):/i,
  fr: /^(Spécial|Special|Wikipédia|Wikipedia|Portail|Fichier|File|Aide|Modèle|Catégorie|Discussion|Utilisateur|Projet|Module|MediaWiki|Référence):/i,
};
const EXCLUDE_EXACT = new Set([
  "Main_Page", "Wikipédia:Accueil_principal", "-", "Undefined", "XXX", "Xxx", "Pornhub", "XHamster", "XVideos", "Cookie_(informatique)",
]);

export function isExcluded(lang: Lang, title: string): boolean {
  return EXCLUDE_EXACT.has(title) || EXCLUDE_PREFIX[lang].test(title) || /\.(php|html?|jpg|png)$/i.test(title);
}

/** topviews' heuristic: genuine human traffic is a mix of mobile and desktop. */
export async function mobileShare(lang: Lang, title: string, date: string): Promise<number | null> {
  const get = async (access: string) => {
    try {
      const d = await getJson(
        `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/${access}/user/${enc(title)}/daily/${ymd(date)}/${ymd(date)}`,
      );
      return d.items?.[0]?.views ?? 0;
    } catch (e) {
      if (e instanceof NotFound) return 0;
      throw e;
    }
  };
  const [mobile, desktop] = await Promise.all([get("mobile-web"), get("desktop")]);
  const total = mobile + desktop;
  return total ? mobile / total : null;
}

/* ---------- per-article context ---------- */

export async function viewSeries(lang: Lang, title: string, date: string, days = 30): Promise<number[]> {
  const start = shiftDate(date, -(days - 1));
  try {
    const d = await getJson(
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/all-access/user/${enc(title)}/daily/${ymd(start)}/${ymd(date)}`,
    );
    const byDay = new Map<string, number>(d.items.map((i: any) => [i.timestamp.slice(0, 8), i.views]));
    return Array.from({ length: days }, (_, i) => byDay.get(ymd(shiftDate(start, i))) ?? 0);
  } catch (e) {
    if (e instanceof NotFound) return Array(days).fill(0);
    throw e;
  }
}

export function spikeRatio(series: number[]): number {
  const prev = series.slice(0, -1).filter((v) => v > 0).sort((a, b) => a - b);
  const median = prev.length ? prev[Math.floor(prev.length / 2)] : 0;
  const last = series[series.length - 1];
  return median ? Math.round((last / median) * 10) / 10 : last > 0 ? 99 : 0;
}

export interface Summary {
  title: string; // display title
  description?: string;
  extract: string;
  wikibase?: string;
  url: string;
  pageImage?: string; // file name without "File:"
  type: string; // "standard" | "disambiguation" | ...
}

export async function summary(lang: Lang, title: string): Promise<Summary | null> {
  try {
    const s = await getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc(title)}`);
    const src: string | undefined = s.originalimage?.source;
    return {
      title: s.titles?.normalized ?? s.title,
      description: s.description,
      extract: s.extract ?? "",
      wikibase: s.wikibase_item,
      url: s.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${enc(title)}`,
      pageImage: src ? decodeURIComponent(src.split("?")[0].split("/").pop()!) : undefined,
      type: s.type,
    };
  } catch (e) {
    if (e instanceof NotFound) return null;
    throw e;
  }
}

/** Edit summaries from the last 48 h: a burst of edits usually means something happened. */
export async function recentEdits(lang: Lang, title: string, date: string): Promise<{ count: number; comments: string[] }> {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", prop: "revisions", titles: title.replace(/_/g, " "),
    rvprop: "timestamp|comment", rvlimit: "50", rvstart: shiftDate(date, 1) + "T23:59:59Z", rvend: shiftDate(date, -1) + "T00:00:00Z",
  });
  const d = await getJson(`https://${lang}.wikipedia.org/w/api.php?${params}`);
  const revs: any[] = d.query?.pages?.[0]?.revisions ?? [];
  const comments = revs.map((r) => (r.comment ?? "").trim()).filter((c) => c && !/^(Reverted|Undid|Annulation|Révocation)/i.test(c));
  return { count: revs.length, comments: [...new Set(comments)].slice(0, 15) };
}

/** English Current events portal for the day, as plain text lines. FR has no maintained equivalent. */
export async function currentEvents(lang: Lang, date: string): Promise<string[]> {
  if (lang !== "en") return [];
  const d = new Date(date + "T00:00:00Z");
  const month = d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const page = `Portal:Current_events/${d.getUTCFullYear()}_${month}_${d.getUTCDate()}`;
  try {
    const raw = await getText(`https://en.wikipedia.org/w/index.php?title=${enc(page)}&action=raw`);
    return raw
      .split("\n")
      .filter((l) => /^\*{2,}/.test(l))
      .map((l) => wikitextToPlain(l.replace(/^\*+/, "")))
      .filter((l) => l.length > 40);
  } catch (e) {
    if (e instanceof NotFound) return [];
    throw e;
  }
}

/* ---------- helpers ---------- */

export function stripHtml(s: string): string {
  return s.replace(/<!--.*?-->/gs, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function wikitextToPlain(s: string): string {
  return s
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1")
    .replace(/\[(https?:\/\/\S+) \(([^)]+)\)\]/g, "($2: $1)")
    .replace(/'''?/g, "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .trim();
}

export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
