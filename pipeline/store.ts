import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { toEntry, type Article, type Edition, type Lang } from "../types/article.ts";

export const CONTENT_DIR = path.resolve(process.env.WT_CONTENT_DIR ?? "content");

export async function saveEdition(lang: Lang, date: string, articles: Article[]): Promise<void> {
  const dir = path.join(CONTENT_DIR, lang, date);
  await mkdir(dir, { recursive: true });
  for (const a of articles) await writeFile(path.join(dir, `${a.slug}.json`), JSON.stringify(a, null, 2) + "\n");
  const edition: Edition = {
    lang,
    date,
    generatedAt: new Date().toISOString(),
    entries: [...articles].sort((a, b) => a.rank - b.rank).map(toEntry),
  };
  await writeFile(path.join(dir, "index.json"), JSON.stringify(edition, null, 2) + "\n");
}

/** Most recent article about `title` in the `days` editions before `date`. */
export async function findRecent(lang: Lang, title: string, date: string, days = 3): Promise<Article | null> {
  let dates: string[];
  try {
    dates = (await readdir(path.join(CONTENT_DIR, lang))).filter((d) => d < date).sort().reverse().slice(0, days);
  } catch {
    return null;
  }
  for (const d of dates) {
    try {
      const ed: Edition = JSON.parse(await readFile(path.join(CONTENT_DIR, lang, d, "index.json"), "utf8"));
      const hit = ed.entries.find((e) => e.title.replace(/ /g, "_") === title.replace(/ /g, "_"));
      if (hit) return JSON.parse(await readFile(path.join(CONTENT_DIR, lang, d, `${hit.slug}.json`), "utf8"));
    } catch {
      // missing or partial edition; keep looking
    }
  }
  return null;
}
