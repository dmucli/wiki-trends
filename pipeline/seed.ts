// One-off: import the hand-researched 2026-09-30 CSVs as the site's first edition,
// enriched with live view series and images. npm run seed
import { readFile } from "node:fs/promises";
import { slugify, type Article, type Category, type Confidence, type Lang } from "../types/article.ts";
import { resolveImage } from "./images.ts";
import { saveEdition } from "./store.ts";
import { pool, spikeRatio, summary, viewSeries } from "./wiki.ts";

const DATE = "2026-09-30";

const CATEGORY: Record<string, Category> = {
  "Current events": "news", Actualité: "news", Sport: "sport", "Film and TV": "screen", "Télé et cinéma": "screen",
  Deaths: "death", Décès: "death", "Viral moment": "viral", "Moment viral": "viral", "Always popular": "evergreen",
  "Toujours populaires": "evergreen", "Unexplained traffic": "mystery", "Trafic inexpliqué": "mystery",
};
const CONFIDENCE: Record<string, Confidence> = { Confirmed: "confirmed", Confirmé: "confirmed", Likely: "likely", Probable: "likely" };

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some(Boolean));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.replace(/^﻿/, ""), r[i] ?? ""])));
}

const firstSentence = (s: string) => s.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? s;

for (const lang of ["en", "fr"] as Lang[]) {
  const rows = parseCsv(await readFile(`wikipedia-top25-${lang}-${DATE}.csv`, "utf8"));
  const articles = await pool(rows, 4, async (r): Promise<Article> => {
    const title = decodeURIComponent(r.wikipedia_url.split("/wiki/")[1]);
    const [s, series] = await Promise.all([summary(lang, title), viewSeries(lang, title, DATE)]);
    const image = s ? await resolveImage(lang, { pageImage: s.pageImage, wikibase: s.wikibase, title }) : null;
    console.log(`${lang} ${r.rank}. ${r.article}: ${image ? image.license : "no image"}`);
    return {
      lang, date: DATE, rank: Number(r.rank), slug: slugify(r.article), title: r.article, wikipediaUrl: r.wikipedia_url,
      views: Number(r.views), series, spike: spikeRatio(series),
      headline: r.article, dek: firstSentence(r.why_now), whatItIs: r.what_it_is, whyNow: r.why_now, body: [],
      category: CATEGORY[r.category] ?? "mystery", confidence: CONFIDENCE[r.confidence] ?? "hypothesis",
      sources: r.sources.split("|").map((u) => u.trim()).filter(Boolean).map((url) => ({ title: new URL(url).hostname.replace(/^www\./, ""), url })),
      sensitive: CATEGORY[r.category] === "death", image, generatedBy: "seed", updatedAt: new Date().toISOString(),
    };
  });
  await saveEdition(lang, DATE, articles);
}
