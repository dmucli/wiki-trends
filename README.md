# Wiki Trends

A bilingual (EN/FR) news site built from what people read on Wikipedia. Every day a pipeline takes the previous day's most-read articles on en.wikipedia and fr.wikipedia, finds out why each one is trending, and publishes it as a news story with a freely licensed photo.

## How it works

```
pipeline/daily.ts   fetch top views → drop bots/noise → enrich → write with Claude → images → content/
site/               Astro static site that renders content/ as a newspaper
content/{lang}/{YYYY-MM-DD}/  one JSON per article + index.json per edition (committed to git)
```

**Sources**
- Wikimedia pageviews API (`metrics/pageviews/top`) plus the featured feed's bot-filtered `mostread`
- Bot filter: exclude list plus the desktop/mobile split (topviews' heuristic: under 5% or over 98.5% mobile means automated traffic)
- Context for the writer: page summary, 30-day views, edit summaries from the last 48 h, "In the news", and the EN Current events portal
- Claude (`claude-opus-5-5` by default) with web search writes the headline, standfirst, body, category, confidence and sources

**Images**: lead image of the article, then the Wikidata P18 image, then a Commons search that must match the title. Non-free (fair-use) files are rejected, and every photo carries author and licence from Commons metadata. With no free photo, the card shows the 30-day traffic curve instead.

**Cost control**: an article covered in the last 3 days with no new edits or news is reused as "still trending" instead of being rewritten.

## Commands

```bash
npm install
npm run daily                                   # yesterday, both languages, 25 each
npm run daily -- --date 2026-10-03 --lang fr --limit 5
npm run daily -- --dry                          # no Claude: Wikipedia-only cards
npm run dev                                     # http://localhost:4321
npm run build                                   # static site in dist/
```

Environment:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required for written stories (without it the run produces Wikipedia-only cards) |
| `WIKI_USER_AGENT` | Contact string Wikimedia asks for, e.g. `WikiTrends/1.0 (you@example.com)` |
| `WT_MODEL` / `WT_EFFORT` | Override the model (default `claude-opus-5-5`) and effort (default `medium`) |
| `SITE_URL` | Canonical URL used in sitemap, RSS and Open Graph tags |

## Deploy

1. Push this repo to GitHub.
2. In the repo settings, add the secret `ANTHROPIC_API_KEY` and the variable `WIKI_USER_AGENT`.
3. Cloudflare Pages → connect the repo. Build command `npm run build`, output directory `dist`, env `SITE_URL=https://your-domain`.
4. Run the **Daily edition** workflow once by hand (`workflow_dispatch`). After that it runs at 02:30 UTC, retries at 05:00, commits the new edition, and the push triggers a Pages rebuild.

The 2026-09-30 edition was imported from the hand-researched CSVs (`npm run seed`) so the site has content before the first automated run.
