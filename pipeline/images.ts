import type { ImageCredit, Lang } from "../types/article.ts";
import { getJson, NotFound, stripHtml } from "./wiki.ts";

const WIDTH = 1200;

/** Credit + sized thumbnail for a file, resolved through the local wiki so local and Commons files both work. */
async function fileInfo(lang: Lang, file: string): Promise<ImageCredit | null> {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", titles: `File:${file}`,
    prop: "imageinfo", iiprop: "url|size|extmetadata|mime", iiurlwidth: String(WIDTH),
  });
  const d = await getJson(`https://${lang}.wikipedia.org/w/api.php?${params}`);
  const page = d.query?.pages?.[0];
  const ii = page?.imageinfo?.[0];
  if (!ii) return null;
  const m = ii.extmetadata ?? {};
  // Fair-use images on enwiki must not be reused outside Wikipedia.
  if (m.NonFree?.value || /fair use|non-free/i.test(m.LicenseShortName?.value ?? "")) return null;
  if (!/^image\/(jpeg|png|webp|gif)/.test(ii.mime ?? "") && !/\.(jpe?g|png|webp)$/i.test(file)) return null;
  // Commons often repeats the name in a hidden span for machine readers; drop it before flattening.
  const artistHtml = (m.Artist?.value ?? "").replace(/<(\w+)[^>]*display:\s*none[^>]*>.*?<\/\1>/gis, "");
  const artist = stripHtml(artistHtml).replace(/\s*\(talk\)$/i, "") || "Unknown author";
  return {
    url: ii.thumburl ?? ii.url,
    width: ii.thumbwidth ?? ii.width,
    height: ii.thumbheight ?? ii.height,
    file: page.title,
    pageUrl: ii.descriptionurl,
    artist: artist.slice(0, 120),
    license: stripHtml(m.LicenseShortName?.value ?? "") || "See file page",
    licenseUrl: m.LicenseUrl?.value || undefined,
  };
}

async function wikidataImage(qid: string): Promise<string | null> {
  try {
    const d = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P18&format=json`);
    return d.claims?.P18?.[0]?.mainsnak?.datavalue?.value ?? null;
  } catch (e) {
    if (e instanceof NotFound) return null;
    throw e;
  }
}

async function commonsSearch(query: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", list: "search", srnamespace: "6",
    srsearch: `${query} filetype:bitmap`, srlimit: "1",
  });
  const d = await getJson(`https://commons.wikimedia.org/w/api.php?${params}`);
  const t: string | undefined = d.query?.search?.[0]?.title;
  if (!t) return null;
  // Only accept a file whose name actually contains the subject; a loose match is how a news site ends up with the wrong face.
  const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(t).includes(norm(query)) ? t.replace(/^File:/, "") : null;
}

/** Lead image → Wikidata P18 → Commons search. Null means the site draws a typographic card. */
export async function resolveImage(
  lang: Lang,
  opts: { pageImage?: string; wikibase?: string; title: string },
): Promise<ImageCredit | null> {
  const candidates: Array<() => Promise<string | null | undefined>> = [
    async () => opts.pageImage,
    async () => (opts.wikibase ? wikidataImage(opts.wikibase) : null),
    async () => commonsSearch(opts.title.replace(/_/g, " ").replace(/\s*\(.*\)$/, "")),
  ];
  for (const next of candidates) {
    try {
      const file = await next();
      if (!file || /\.svg$/i.test(file)) continue; // logos, flags and maps make poor news photos
      const info = await fileInfo(lang, file);
      if (info && info.width >= 400) return info;
    } catch {
      // try the next source
    }
  }
  return null;
}
