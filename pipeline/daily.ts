// Daily run: npm run daily -- [--date YYYY-MM-DD] [--lang en|fr] [--limit 25] [--dry]
// --dry skips Claude and publishes Wikipedia-only cards (also the behaviour when no API key is configured).
import { parseArgs } from "node:util";
import { LANGS, slugify, type Article, type Lang } from "../types/article.ts";
import { resolveImage } from "./images.ts";
import { findRecent, saveEdition } from "./store.ts";
import {
  currentEvents, featuredFeed, isExcluded, mobileShare, pool, recentEdits, shiftDate, spikeRatio, summary, topViews, viewSeries,
  type TopItem,
} from "./wiki.ts";
import { MODEL, writeArticle, type WriterInput } from "./writer.ts";

const { values: args } = parseArgs({
  options: {
    date: { type: "string" },
    lang: { type: "string" },
    limit: { type: "string", default: "25" },
    dry: { type: "boolean", default: false },
    concurrency: { type: "string", default: "4" },
  },
});

const date = args.date ?? shiftDate(new Date().toISOString().slice(0, 10), -1);
const langs: Lang[] = args.lang ? [args.lang as Lang] : [...LANGS];
const limit = Number(args.limit);
const useClaude = !args.dry && Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const log = (...m: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...m);

/** Merge raw top views with the bot-filtered mostread list, then drop obvious automated traffic. */
async function candidates(lang: Lang): Promise<{ items: TopItem[]; news: string[] }> {
  const [top, feed, events] = await Promise.all([topViews(lang, date), featuredFeed(lang, date), currentEvents(lang, date)]);
  const trusted = new Set(feed.mostread.map((m) => m.title));
  const merged = new Map<string, TopItem>();
  for (const t of [...top, ...feed.mostread]) if (!isExcluded(lang, t.title)) merged.set(t.title, merged.get(t.title) ?? t);
  const ranked = [...merged.values()].sort((a, b) => b.views - a.views).slice(0, limit * 2);

  const shares = await pool(ranked, 6, (t) => (trusted.has(t.title) ? Promise.resolve(0.5) : mobileShare(lang, t.title, date)));
  const kept = ranked.filter((t, i) => {
    const s = shares[i];
    const bot = s !== null && (s < 0.05 || s > 0.985);
    if (bot) log(`  drop ${t.title} (mobile share ${Math.round((s ?? 0) * 100)}%)`);
    return !bot;
  });
  return { items: kept.slice(0, limit), news: [...feed.news, ...events] };
}

function mentions(lines: string[], title: string): string[] {
  const needle = title.replace(/_/g, " ").replace(/\s*\(.*\)$/, "").toLowerCase();
  return lines.filter((l) => l.toLowerCase().includes(needle)).slice(0, 5);
}

const FALLBACK_WHY: Record<Lang, string> = {
  en: "We haven't yet confirmed what sent readers to this article.",
  fr: "Nous n'avons pas encore établi pourquoi les lecteurs se sont rués sur cet article.",
};

async function buildArticle(lang: Lang, item: TopItem, rank: number, news: string[]): Promise<Article | null> {
  const s = await summary(lang, item.title);
  if (!s || s.type === "disambiguation") return null;
  const [series, edits, share] = await Promise.all([
    viewSeries(lang, item.title, date),
    recentEdits(lang, item.title, date),
    mobileShare(lang, item.title, date),
  ]);
  const base = {
    lang, date, rank, title: s.title, wikipediaUrl: s.url, slug: slugify(s.title),
    views: item.views, series, spike: spikeRatio(series), updatedAt: new Date().toISOString(),
  };
  const image = await resolveImage(lang, { pageImage: s.pageImage, wikibase: s.wikibase, title: item.title });
  const related = mentions(news, item.title);
  const prev = await findRecent(lang, item.title, date);

  // Still trending for the same reason: no new edits or news, so reuse the story rather than paying for a rewrite.
  if (prev && prev.generatedBy === "claude" && edits.count <= 3 && related.length === 0) {
    log(`  ${rank}. ${s.title}: reusing ${prev.date}`);
    return { ...prev, ...base, image: image ?? prev.image, continuedFrom: `${prev.date}/${prev.slug}` };
  }

  if (useClaude) {
    const input: WriterInput = {
      lang, date, rank, title: s.title, description: s.description, extract: s.extract, views: item.views,
      series, spike: base.spike, mobileShare: share, edits, news: related,
      previous: prev ? { date: prev.date, headline: prev.headline, whyNow: prev.whyNow } : undefined,
    };
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const d = await writeArticle(input);
        log(`  ${rank}. ${s.title}: ${d.headline} [${d.category}/${d.confidence}]`);
        return {
          ...base, image, headline: d.headline, dek: d.dek, whatItIs: d.what_it_is, whyNow: d.why_now, body: d.body,
          category: d.category, confidence: d.confidence, sensitive: d.sensitive, sources: d.sources,
          generatedBy: "claude", model: MODEL,
          continuedFrom: prev ? `${prev.date}/${prev.slug}` : undefined,
        };
      } catch (e) {
        log(`  ${rank}. ${s.title}: writer attempt ${attempt} failed: ${(e as Error).message}`);
      }
    }
  }

  log(`  ${rank}. ${s.title}: Wikipedia-only card`);
  return {
    ...base, image,
    headline: s.title,
    dek: s.description ? s.description.charAt(0).toUpperCase() + s.description.slice(1) : "",
    whatItIs: s.extract.split(/(?<=\.)\s/)[0] ?? s.extract,
    whyNow: FALLBACK_WHY[lang],
    body: [s.extract],
    category: "mystery", confidence: "hypothesis", sensitive: false, sources: [],
    generatedBy: "fallback",
  };
}

for (const lang of langs) {
  log(`${lang}: ${date} (${useClaude ? `writer ${MODEL}` : "no writer, Wikipedia-only"})`);
  const { items, news } = await candidates(lang);
  const built = await pool(items, Number(args.concurrency), (item, i) => buildArticle(lang, item, i + 1, news));
  // Re-rank after dropping disambiguation pages so ranks stay contiguous.
  const articles = built.filter((a): a is Article => a !== null).map((a, i) => ({ ...a, rank: i + 1 }));
  const seen = new Set<string>();
  for (const a of articles) {
    while (seen.has(a.slug)) a.slug += "-2";
    seen.add(a.slug);
  }
  await saveEdition(lang, date, articles);
  log(`${lang}: saved ${articles.length} articles`);
}
