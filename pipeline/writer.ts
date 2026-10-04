import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CATEGORIES, CONFIDENCE, type Lang } from "../types/article.ts";

export const MODEL = process.env.WT_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.WT_EFFORT ?? "medium") as "low" | "medium" | "high";

const Draft = z.object({
  headline: z.string(),
  dek: z.string(),
  what_it_is: z.string(),
  why_now: z.string(),
  body: z.array(z.string()),
  category: z.enum(CATEGORIES),
  confidence: z.enum(CONFIDENCE),
  sensitive: z.boolean(),
  sources: z.array(z.object({ title: z.string(), url: z.string(), publisher: z.string() })),
});
export type Draft = z.infer<typeof Draft>;

// Built by hand rather than with the SDK's zod helper, which flattens enums into descriptions.
function strict(node: any): any {
  if (Array.isArray(node)) return node.map(strict);
  if (!node || typeof node !== "object") return node;
  const out: any = {};
  for (const [k, v] of Object.entries(node)) if (k !== "$schema") out[k] = strict(v);
  if (out.type === "object") out.additionalProperties = false;
  return out;
}
const OUTPUT_FORMAT = { type: "json_schema", schema: strict(z.toJSONSchema(Draft)) } as const;

export interface WriterInput {
  lang: Lang;
  date: string;
  rank: number;
  title: string;
  description?: string;
  extract: string;
  views: number;
  series: number[];
  spike: number;
  mobileShare: number | null;
  edits: { count: number; comments: string[] };
  news: string[]; // Current events / In the news lines that mention the article
  previous?: { date: string; headline: string; whyNow: string };
}

const SYSTEM: Record<Lang, string> = {
  en: `You are the writer for Wiki Trends, a news site whose stories are the articles people read most on English Wikipedia each day. For each trending article you explain, in plain and lively English, what the subject is and why people were reading about it on that day.

How to work:
- Use the context provided (pageview numbers, Wikipedia lead, recent edit summaries, Current events lines), then use web search to find the actual trigger: a news event, a death, a match, a TV broadcast or release, an anniversary, a viral post. Search for news from the day before and the day of the spike.
- Never invent a cause. If you cannot find one, say so plainly, set confidence to "hypothesis", and use category "mystery" if the traffic looks unexplained or automated (for example, an almost purely desktop audience).
- confidence: "confirmed" when a reliable source ties the event to the date; "likely" when the timing fits but nothing states the link; "hypothesis" when you are guessing.
- Allegations are allegations: name who alleges what, and include denials. Be careful and factual with living people, crimes, suicides and deaths. Set sensitive=true for deaths, violent crime, sexual violence or self-harm.
- Write like a good news explainer, not a press release: concrete facts, numbers, names, dates. No hype, no clichés, no "In a world where".
- Do not mention Wikipedia pageview mechanics in the body except, if useful, one sentence about the size of the spike.

Output fields:
- headline: a news headline, at most 90 characters, sentence case, specific (who/what + the trigger).
- dek: one or two sentences standfirst that adds what the headline leaves out.
- what_it_is: one sentence on what the Wikipedia article is about, for someone who has never heard of it.
- why_now: two to four sentences on why it is trending now; this is the heart of the story.
- body: three to five short paragraphs expanding on the story with context and background. Plain text, no markdown.
- category: news (current events, politics, disasters, crime), sport, screen (TV, film, streaming, music releases), death (someone died), viral (social media moment, meme), evergreen (seasonal or perennial interest, anniversaries, homework), mystery (no clear explanation).
- sources: the two to four news pages you actually relied on, with their real URLs. Never fabricate a URL.`,
  fr: `Tu es la plume de Wiki Trends, un site d'actualité dont les sujets sont les articles les plus lus chaque jour sur Wikipédia en français. Pour chaque article en tendance, tu expliques en français clair et vivant de quoi il s'agit et pourquoi les gens l'ont lu ce jour-là.

Méthode :
- Pars du contexte fourni (vues, résumé Wikipédia, résumés de modifications récentes, lignes d'actualité), puis utilise la recherche web pour trouver le vrai déclencheur : événement, décès, match, diffusion télé, sortie, anniversaire, moment viral. Cherche l'actualité de la veille et du jour du pic, de préférence dans la presse francophone (France, Belgique, Suisse, Québec, Afrique francophone).
- N'invente jamais de cause. Si tu ne trouves rien, dis-le simplement, mets confidence à "hypothesis", et la catégorie "mystery" si le trafic semble inexpliqué ou automatique (par exemple un public presque uniquement sur ordinateur).
- confidence : "confirmed" quand une source fiable relie l'événement à la date ; "likely" quand le calendrier colle mais que rien ne l'affirme ; "hypothesis" quand c'est une supposition.
- Une accusation reste une accusation : dis qui accuse de quoi et mentionne les démentis. Sois prudent et factuel avec les personnes vivantes, les crimes, les suicides et les décès. Mets sensitive=true pour les décès, crimes violents, violences sexuelles ou automutilation.
- Écris comme un bon article explicatif, pas comme un communiqué : faits concrets, chiffres, noms, dates. Pas d'emphase ni de clichés. Typographie française (espaces avant : ; ? !, guillemets « »).
- Ne parle pas des statistiques de Wikipédia dans le corps, sauf éventuellement une phrase sur l'ampleur du pic.

Champs :
- headline : un titre de presse, 90 caractères maximum, précis (qui/quoi + le déclencheur), majuscule seulement en début de phrase.
- dek : un chapeau d'une ou deux phrases qui complète le titre.
- what_it_is : une phrase sur le sujet de l'article Wikipédia, pour quelqu'un qui n'en a jamais entendu parler.
- why_now : deux à quatre phrases sur la raison de la tendance ; c'est le cœur du sujet.
- body : trois à cinq paragraphes courts qui développent avec contexte et historique. Texte brut, sans markdown.
- category : news (actualité, politique, catastrophes, faits divers), sport, screen (télé, cinéma, streaming, sorties musicales), death (décès), viral (moment viral, réseaux sociaux), evergreen (intérêt saisonnier ou permanent, anniversaires, devoirs), mystery (pas d'explication claire).
- sources : les deux à quatre pages d'actualité réellement utilisées, avec leurs vraies URL. N'invente jamais d'URL.`,
};

function userPrompt(i: WriterInput): string {
  const lines = [
    `Wikipedia: ${i.lang}.wikipedia.org`,
    `Day of the spike: ${i.date}`,
    `Article: ${i.title.replace(/_/g, " ")}${i.description ? ` (${i.description})` : ""}`,
    `Rank that day: #${i.rank}, ${i.views.toLocaleString("en-US")} views`,
    `Views over the previous 30 days (oldest first): ${i.series.join(", ")}`,
    `Spike: ${i.spike}× the 30-day median`,
    i.mobileShare !== null ? `Share of views on mobile web: ${Math.round(i.mobileShare * 100)}%` : "",
    `Edits in the last 48 h: ${i.edits.count}`,
    i.edits.comments.length ? `Edit summaries:\n- ${i.edits.comments.join("\n- ")}` : "",
    i.news.length ? `Related lines from Wikipedia's news pages:\n- ${i.news.join("\n- ")}` : "",
    `Wikipedia lead:\n${i.extract}`,
    i.previous
      ? `We already covered this article on ${i.previous.date} ("${i.previous.headline}": ${i.previous.whyNow}). If the reason is the same, write a short follow-up that focuses on what is new; if nothing is new, say it is still trending for the same reason.`
      : "",
  ];
  return lines.filter(Boolean).join("\n\n");
}

const client = new Anthropic({ maxRetries: 3 });

/** Errors no retry will fix: missing credit, bad or revoked key. */
export function isAccountError(e: unknown): boolean {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return true;
  // Errors raised mid-stream are not always APIError instances, so match on the message too.
  return e instanceof Error && /credit balance is too low|invalid x-api-key|billing/i.test(e.message);
}

export async function writeArticle(input: WriterInput): Promise<Draft> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: userPrompt(input) }];
  for (let turn = 0; turn < 6; turn++) {
    const response = await client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 32000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT, format: OUTPUT_FORMAT },
        system: [{ type: "text", text: SYSTEM[input.lang], cache_control: { type: "ephemeral" } }],
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
        messages,
      } as any)
      .finalMessage();

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    if (response.stop_reason === "refusal") throw new Error(`refusal: ${(response as any).stop_details?.category ?? "unknown"}`);
    if (response.stop_reason === "max_tokens") throw new Error("max_tokens");

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return Draft.parse(JSON.parse(text));
  }
  throw new Error("too many pause_turn continuations");
}
