import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { BrandMark } from "./BrandMark";
import { LandingRefCapture } from "./LandingRefCapture";

/**
 * The public marketing landing (RFC 10 §3.1). One URL = one language =
 * deterministic canonical content: "/" is ALWAYS Bulgarian (the empty
 * Bulgarian SERP is the strategy — content negotiation would show Googlebot
 * English and forfeit it), "/en" is the English twin. Copy lives in a local
 * typed dict (deviation from the app dictionary: same completeness guarantee
 * via the Record type, without 40 marketing keys in the app's i18n).
 * Plain server-rendered JSX; the only client islands are the ref-capture
 * helper and the <details> FAQ (which needs no JS at all).
 */

const COPY: Record<
  Locale,
  {
    heroH1: string;
    heroSub: string;
    punch: string;
    ctaPrimary: string;
    ctaSecondary: string;
    howTitle: string;
    how: [string, string, string];
    features: { title: string; body: string }[];
    trustTitle: string;
    trust: { title: string; body: string }[];
    compare: string;
    faqTitle: string;
    faq: { q: string; a: string }[];
    footerPrivacy: string;
    footerTerms: string;
    footerLang: string;
    footerLangHref: string;
    madeIn: string;
  }
> = {
  bg: {
    heroH1: "Общите разходи, пресметнати. Кой на кого колко дължи — без караници.",
    heroSub:
      "Групови разходи за почивки, квартири и излизания на едно място. Money Assistant смята балансите и предлага най-малкия брой преводи.",
    punch: "Неограничени разходи. Безплатно сканиране на бонове. Без реклами.",
    ctaPrimary: "Създай група — безплатно",
    ctaSecondary: "Виж как работи",
    howTitle: "Как работи",
    how: [
      "Създавате група и добавяте участниците — с имена, без имейли.",
      "Пращате линк във Viber — останалите се включват от браузъра, без да инсталират нищо.",
      "Записвате разходите или снимате касовия бон — приложението поддържа баланса и показва кой на кого колко дължи.",
    ],
    features: [
      { title: "Неограничени записи", body: "Без дневни лимити и без „премиум“ стени пред основното." },
      { title: "Сканиране на български бонове", body: "Снимате бона от Билла или Фантастико — артикулите се разчитат и се разпределят по хора." },
      { title: "Умно разделяне", body: "Поравно, по точни суми, по проценти, по дялове или по бройки." },
      { title: "Опростяване на дълговете", body: "Алгоритъмът свежда всички задължения до минимален брой преводи." },
      { title: "Как да платя?", body: "IBAN за копиране, blink, Revolut линк или SEPA QR код — данните на получателя са под ръка." },
      { title: "Телефон и компютър", body: "Работи в браузъра навсякъде — без инсталация, с пълна поддръжка на български." },
    ],
    trustTitle: "Данните ви са ваши",
    trust: [
      { title: "Без достъп до банкови сметки", body: "Приложението само смята — не пипа пари и не иска банкови данни." },
      { title: "Изтриване по всяко време", body: "Сваляте данните си с един клик и изтривате акаунта си сами — незабавно." },
      { title: "Снимките не се пазят", body: "Снимката на бона се изтрива след осчетоводяване — остават само артикулите." },
    ],
    compare:
      "Splitwise ограничава безплатните записи и няма български език. Tricount няма сканиране на бонове. Тук и двете са безплатни.",
    faqTitle: "Често задавани въпроси",
    faq: [
      {
        q: "Безплатно ли е приложението за разделяне на сметки?",
        a: "Да. Записването на общи разходи е неограничено и безплатно, без реклами. Планираме допълнителни платени удобства, но основното остава безплатно.",
      },
      {
        q: "Трябва ли всички в групата да инсталират приложение?",
        a: "Не. Money Assistant работи в браузъра — домакинът праща линк, останалите влизат директно.",
      },
      {
        q: "Как се разделят разходите от почивка или обща квартира?",
        a: "Записвате кой какво е платил — поравно, по проценти, по дялове или по точни суми, в различни валути. Приложението поддържа общия баланс и накрая показва кой на кого колко дължи с минимален брой преводи.",
      },
      {
        q: "Имате ли достъп до банковата ми сметка?",
        a: "Не. Не искаме банкови данни и не извършваме плащания — приложението само води сметките. Плащате си както обикновено: в брой, по IBAN, с blink или Revolut.",
      },
      {
        q: "Каква е разликата със Splitwise?",
        a: "Splitwise ограничава безплатните записи (~3 на ден), държи сканирането на бонове в платения план и няма българска версия. Тук няма лимити и сканирането е безплатно.",
      },
      {
        q: "Работи ли с левове и евро?",
        a: "Да — стари записи в левове се преизчисляват по фиксирания курс 1,95583, а всичко ново е в евро. Поддържат се и още 30 валути за пътувания.",
      },
    ],
    footerPrivacy: "Политика за поверителност",
    footerTerms: "Условия за ползване",
    footerLang: "English",
    footerLangHref: "/en",
    madeIn: "Направено в България",
  },
  en: {
    heroH1: "Shared expenses, computed. Who owes whom — without the arguments.",
    heroSub:
      "Group expenses for trips, flatshares and nights out in one place. Money Assistant keeps the balances and suggests the fewest possible transfers.",
    punch: "Unlimited expenses. Free receipt scanning. No ads.",
    ctaPrimary: "Create a group — free",
    ctaSecondary: "See how it works",
    howTitle: "How it works",
    how: [
      "Create a group and add the people — names only, no emails needed.",
      "Share a link in any chat — everyone joins from the browser, nothing to install.",
      "Log expenses or photograph the receipt — the app keeps the balance and shows who owes whom.",
    ],
    features: [
      { title: "Unlimited entries", body: "No daily caps and no premium wall in front of the basics." },
      { title: "Receipt scanning", body: "Snap the receipt — line items are read out and split between people." },
      { title: "Smart splitting", body: "Equally, exact amounts, percentages, shares, or by units." },
      { title: "Debt simplification", body: "All debts reduced to the minimum number of transfers." },
      { title: "How-to-pay helpers", body: "Copyable IBAN, blink, a Revolut link or a SEPA QR — the recipient's details at hand." },
      { title: "Phone and desktop", body: "Runs in the browser everywhere — no install, fully bilingual." },
    ],
    trustTitle: "Your data is yours",
    trust: [
      { title: "No bank access", body: "The app only does the math — it never touches money or asks for bank credentials." },
      { title: "Delete any time", body: "Export your data in one click and delete your account yourself — immediately." },
      { title: "Photos aren't kept", body: "The receipt photo is deleted once converted — only the line items remain." },
    ],
    compare:
      "Splitwise caps free entries and has no Bulgarian. Tricount dropped receipt scanning. Here both are free.",
    faqTitle: "Frequently asked questions",
    faq: [
      {
        q: "Is the app free?",
        a: "Yes. Logging shared expenses is unlimited and free, with no ads. Paid conveniences are planned, but the core stays free.",
      },
      {
        q: "Does everyone need to install an app?",
        a: "No. Money Assistant runs in the browser — the organizer shares a link, everyone else just opens it.",
      },
      {
        q: "How are trip or flatshare expenses split?",
        a: "Log who paid what — equally, by percentages, shares or exact amounts, in multiple currencies. The app keeps a running balance and reduces it to the fewest transfers.",
      },
      {
        q: "Do you have access to my bank account?",
        a: "No. We never ask for bank credentials and never move money — the app only keeps score. You pay as usual: cash, IBAN transfer, blink or Revolut.",
      },
      {
        q: "How is this different from Splitwise?",
        a: "Splitwise caps free entries (~3/day), keeps receipt scanning in its paid plan, and has no Bulgarian version. Here there are no caps and scanning is free.",
      },
      {
        q: "Does it work with leva and euro?",
        a: "Yes — old lev entries are converted at the fixed 1.95583 rate, everything new is in euro, and 30+ travel currencies are supported.",
      },
    ],
    footerPrivacy: "Privacy policy",
    footerTerms: "Terms of service",
    footerLang: "Български",
    footerLangHref: "/",
    madeIn: "Made in Bulgaria",
  },
};

export function LandingPage({ locale }: { locale: Locale }) {
  const c = COPY[locale];
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: c.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <main className="min-h-screen">
      <LandingRefCapture />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* hero */}
      <section className="px-4 pt-14 pb-12 text-center" style={{ background: "var(--background)" }}>
        <div className="mx-auto max-w-2xl">
          <BrandMark />
          <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">{c.heroH1}</h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-gray-600">{c.heroSub}</p>
          <p
            className="mx-auto mt-6 inline-block rounded-full px-4 py-1.5 text-sm font-bold text-white"
            style={{ background: "var(--brand)" }}
          >
            {c.punch}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/login" className="btn btn-primary !px-6 !py-3 !text-base">
              {c.ctaPrimary}
            </Link>
            <a href="#how" className="btn btn-secondary !px-6 !py-3 !text-base">
              {c.ctaSecondary}
            </a>
          </div>
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="bg-white px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-bold text-gray-900">{c.howTitle}</h2>
          <ol className="mx-auto mt-8 grid max-w-3xl gap-6 sm:grid-cols-3">
            {c.how.map((step, i) => (
              <li key={i} className="rounded-2xl border border-gray-200 p-5">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ background: "var(--brand)" }}
                >
                  {i + 1}
                </span>
                <p className="mt-3 text-sm leading-relaxed text-gray-600">{step}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* features */}
      <section className="px-4 py-12" style={{ background: "var(--background)" }}>
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {c.features.map((f) => (
            <div key={f.title} className="card px-5 py-4">
              <p className="font-semibold text-gray-800">{f.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-gray-500">{f.body}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-gray-500">{c.compare}</p>
      </section>

      {/* trust */}
      <section className="bg-white px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-bold text-gray-900">{c.trustTitle}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {c.trust.map((tr) => (
              <div key={tr.title} className="rounded-2xl border border-gray-200 p-5">
                <p className="font-semibold text-gray-800">{tr.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-gray-500">{tr.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ — <details>, no JS */}
      <section className="px-4 py-12" style={{ background: "var(--background)" }}>
        <div className="mx-auto max-w-2xl">
          <h2 className="text-center text-2xl font-bold text-gray-900">{c.faqTitle}</h2>
          <div className="mt-6 space-y-2">
            {c.faq.map((f) => (
              <details key={f.q} className="card px-5 py-3">
                <summary className="cursor-pointer text-sm font-semibold text-gray-800">
                  {f.q}
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{f.a}</p>
              </details>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link href="/login" className="btn btn-primary !px-6 !py-3 !text-base">
              {c.ctaPrimary}
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-200 bg-white px-4 py-8 text-center text-xs text-gray-400">
        <p className="space-x-3">
          <Link className="underline hover:text-gray-600" href="/privacy">
            {c.footerPrivacy}
          </Link>
          <Link className="underline hover:text-gray-600" href="/terms">
            {c.footerTerms}
          </Link>
          <Link className="underline hover:text-gray-600" href="/blog">
            Blog
          </Link>
          <Link className="underline hover:text-gray-600" href={c.footerLangHref}>
            {c.footerLang}
          </Link>
        </p>
        <p className="mt-2">Money Assistant · {c.madeIn}</p>
      </footer>
    </main>
  );
}
