import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, makeT, type Locale, type TFunc } from "./i18n";

/**
 * Pick a supported locale from an Accept-Language header. Only "bg" needs
 * detecting (everything else falls back to the default); the q-ordered parse
 * keeps it honest for e.g. "bg-BG,bg;q=0.9,en;q=0.8" vs "en,bg;q=0.5".
 */
export function negotiateLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0 };
    })
    .filter((e) => e.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { lang } of ranked) {
    if (isLocale(lang)) return lang;
  }
  return DEFAULT_LOCALE;
}

/**
 * The request's locale (server components & actions): the `locale` cookie when
 * the user has chosen a language, otherwise negotiated from Accept-Language —
 * so a Bulgarian browser lands in Bulgarian on the very first visit.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  if (isLocale(value)) return value;
  try {
    const h = await headers();
    return negotiateLocale(h.get("accept-language"));
  } catch {
    // headers() is unavailable in a few contexts (e.g. revalidation) — fall back.
    return DEFAULT_LOCALE;
  }
}

/** A translator bound to the request's locale. */
export async function getT(): Promise<TFunc> {
  return makeT(await getLocale());
}
