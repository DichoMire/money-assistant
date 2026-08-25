/**
 * Blog article registry (RFC 10 §3.2): plain typed TSX articles, no MDX —
 * 5-8 owner-written Bulgarian pieces don't justify a build pipeline (revisit
 * past ~15 articles). Adding an article:
 *   1. add its entry here (drives the index page and sitemap.xml);
 *   2. add its body to ARTICLE_BODIES in src/app/blog/[slug]/page.tsx.
 * Articles are Bulgarian-only on purpose — the target SERP is Bulgarian.
 *
 * The planned queue (docs/bg-market/10-growth-marketing/rfc.md §3.2):
 *   1. „Приложение за общи разходи със съквартиранти" — September
 *   2. „Splitwise на български — има ли алтернатива?" — September
 *   3. „Как да разделим сметката: най-добрите приложения" — October
 *   4. „Споделени разходи без караници" — October
 *   5. „Как да разделим разходите от почивката" — November
 *   6. „Обща каса за ски уикенда: Банско и Боровец" — late November
 */

export type BlogEntry = {
  slug: string;
  titleBg: string;
  descriptionBg: string;
  /** ISO dates for the sitemap. */
  published: string;
  updated: string;
};

export const BLOG_ENTRIES: BlogEntry[] = [
  // Empty until the first article ships — the index renders a coming-soon
  // note and the sitemap simply lists nothing extra.
];
