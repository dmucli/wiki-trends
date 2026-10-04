import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import en from "../i18n/en.json";
import fr from "../i18n/fr.json";
import { LANGS, type Article, type Edition, type Lang } from "../../../types/article.ts";

export { LANGS };
export type { Article, Edition, Lang };

const ROOT = path.resolve(process.env.WT_CONTENT_DIR ?? "content");
const STRINGS = { en, fr };
export const t = (lang: Lang) => STRINGS[lang];

const editionCache = new Map<string, Edition>();
const articleCache = new Map<string, Article>();

/** Edition dates for a language, newest first. */
export function editionDates(lang: Lang): string[] {
  const dir = path.join(ROOT, lang);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && existsSync(path.join(dir, d, "index.json")))
    .sort()
    .reverse();
}

export function edition(lang: Lang, date: string): Edition {
  const key = `${lang}/${date}`;
  if (!editionCache.has(key)) editionCache.set(key, JSON.parse(readFileSync(path.join(ROOT, lang, date, "index.json"), "utf8")));
  return editionCache.get(key)!;
}

export function article(lang: Lang, date: string, slug: string): Article {
  const key = `${lang}/${date}/${slug}`;
  if (!articleCache.has(key)) articleCache.set(key, JSON.parse(readFileSync(path.join(ROOT, lang, date, `${slug}.json`), "utf8")));
  return articleCache.get(key)!;
}

export function allArticles(lang: Lang): Article[] {
  return editionDates(lang).flatMap((d) => edition(lang, d).entries.map((e) => article(lang, d, e.slug)));
}

export const articleHref = (a: { lang?: Lang; date: string; slug: string }, lang: Lang = a.lang!) =>
  `/${lang}/${a.date.replace(/-/g, "/")}/${a.slug}/`;
export const editionHref = (lang: Lang, date: string) => `/${lang}/${date.replace(/-/g, "/")}/`;

export function formatDate(lang: Lang, date: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" }) {
  return new Date(date + "T12:00:00Z").toLocaleDateString(t(lang).dateLocale, { ...opts, timeZone: "UTC" });
}

export function formatViews(lang: Lang, n: number) {
  return new Intl.NumberFormat(t(lang).dateLocale, { notation: n >= 1e6 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
}
