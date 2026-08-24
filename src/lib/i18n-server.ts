import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, makeT, type Locale, type TFunc } from "./i18n";

/** The request's locale, from the `locale` cookie (server components & actions). */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** A translator bound to the request's locale. */
export async function getT(): Promise<TFunc> {
  return makeT(await getLocale());
}
