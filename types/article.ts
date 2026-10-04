// Shared between the pipeline (writes content/) and the Astro site (reads it).

export const LANGS = ["en", "fr"] as const;
export type Lang = (typeof LANGS)[number];

// Same seven buckets as the original artifact; labels live in site/src/i18n.
export const CATEGORIES = ["news", "sport", "screen", "death", "viral", "evergreen", "mystery"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CONFIDENCE = ["confirmed", "likely", "hypothesis"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export interface ImageCredit {
  url: string; // sized thumbnail on upload.wikimedia.org
  width: number;
  height: number;
  file: string; // "File:Foo.jpg"
  pageUrl: string; // Commons / wiki file description page
  artist: string; // plain text
  license: string; // "CC BY-SA 4.0"
  licenseUrl?: string;
}

export interface Source {
  title: string;
  url: string;
  publisher?: string;
}

export interface Article {
  lang: Lang;
  date: string; // YYYY-MM-DD, the pageviews day
  slug: string;
  rank: number;
  title: string; // Wikipedia title, display form
  wikipediaUrl: string;
  views: number;
  series: number[]; // daily views, oldest first, ending on `date`
  spike: number; // views / median of the previous 30 days
  headline: string;
  dek: string;
  whatItIs: string;
  whyNow: string;
  body: string[]; // paragraphs
  category: Category;
  confidence: Confidence;
  sources: Source[];
  sensitive: boolean;
  image: ImageCredit | null;
  generatedBy: "claude" | "seed" | "fallback";
  model?: string;
  continuedFrom?: string; // "YYYY-MM-DD/slug" when reusing a recent story
  updatedAt: string; // ISO timestamp
}

export interface EditionEntry {
  rank: number;
  slug: string;
  title: string;
  headline: string;
  dek: string;
  category: Category;
  views: number;
  series: number[];
  image: ImageCredit | null;
}

export interface Edition {
  lang: Lang;
  date: string;
  generatedAt: string;
  entries: EditionEntry[];
}

export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "article";
}

export function toEntry(a: Article): EditionEntry {
  return {
    rank: a.rank,
    slug: a.slug,
    title: a.title,
    headline: a.headline,
    dek: a.dek,
    category: a.category,
    views: a.views,
    series: a.series,
    image: a.image,
  };
}
