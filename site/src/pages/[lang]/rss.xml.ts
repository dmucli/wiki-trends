import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { allArticles, articleHref, LANGS, t, type Lang } from "../../lib/content.ts";

export function getStaticPaths() {
  return LANGS.map((lang) => ({ params: { lang } }));
}

export function GET(context: APIContext) {
  const lang = context.params.lang as Lang;
  const s = t(lang);
  return rss({
    title: `${s.siteName} (${lang.toUpperCase()})`,
    description: s.description,
    site: context.site!,
    customData: `<language>${lang}</language>`,
    items: allArticles(lang)
      .slice(0, 100)
      .map((a) => ({
        title: a.headline,
        description: a.dek || a.whyNow,
        link: articleHref(a),
        pubDate: new Date(a.date + "T12:00:00Z"),
        categories: [s.categories[a.category]],
      })),
  });
}
