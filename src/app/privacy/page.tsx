import type { Metadata } from "next";
import Link from "next/link";
import { getLocale } from "@/lib/i18n-server";

/**
 * Privacy policy — DRAFT for legal review (RFC 08 §3.3 outline). Plain
 * language on purpose: „данните ви са ваши“ beats legalese for this audience.
 * Bulgarian is the primary text; English mirrors it. Keep in sync with
 * docs/ROPA.md (the single source of truth for processors/retention) —
 * update BOTH when a vendor or retention rule changes.
 */

export const metadata: Metadata = {
  title: "Политика за поверителност · Money Assistant",
};

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "contact@example.com"; // TODO(owner): set the real contact address

function Bg() {
  return (
    <article className="space-y-5 text-sm leading-relaxed text-gray-700">
      <h1 className="text-2xl font-bold text-gray-900">Политика за поверителност</h1>
      <p className="text-xs text-gray-400">Последна промяна: 26 август 2026 г.</p>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">Накратко</h2>
        <p>
          Данните ви са ваши. Money Assistant съхранява само това, което е нужно, за да си
          водите общите разходи; не продаваме данни, не показваме реклами и нямаме достъп
          до банковите ви сметки. Можете да изтеглите или изтриете всичко сами, по всяко време.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">1. Кой отговаря за данните</h2>
        <p>
          Услугата се поддържа от нейния разработчик (администратор на данни по смисъла на
          ОРЗД/GDPR). Свържете се с нас на <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">2. Какво съхраняваме</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Акаунт:</strong> имейл, име и снимка от профила ви в Google (ако има такава).
          </li>
          <li>
            <strong>Групи и разходи:</strong> имена на групи и участници, описания, суми, дати,
            кой е платил и кой колко дължи.
          </li>
          <li>
            <strong>Сканирани бонове:</strong> търговец, артикули (включително дословния текст от
            бона), суми — и самата снимка, докато се съхранява (вижте т. 5).
          </li>
          <li>
            <strong>Дневник на активността:</strong> кой какво е направил в групата (имена, не имейли).
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">3. Защо и на какво основание</h2>
        <p>
          Обработваме данните, за да ви предоставим услугата (чл. 6, ал. 1, б. „б“ ОРЗД —
          изпълнение на договор) и за да пазим услугата от злоупотреби (легитимен интерес,
          чл. 6, ал. 1, б. „е“).
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">4. Кой друг обработва данни (обработващи)</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Vercel</strong> — хостинг на приложението.</li>
          <li><strong>Neon</strong> — база данни.</li>
          <li><strong>Google</strong> — вход в акаунта (Google Sign-In).</li>
          <li>
            <strong>OpenRouter</strong> (и избраният чрез него доставчик на AI модел) — чете
            снимката на касовия бон, за да извлече артикулите. Снимката се изпраща само когато
            вие я качите за сканиране.
          </li>
        </ul>
        <p className="mt-1">
          Прехвърляния извън ЕС се извършват при гаранциите на стандартните договорни клаузи
          (SCC) или EU-US Data Privacy Framework на съответния доставчик.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">5. Колко дълго пазим данните</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Акаунт и групи:</strong> докато не ги изтриете.</li>
          <li>
            <strong>Снимки на бонове:</strong> изтриват се автоматично след осчетоводяване
            (освен ако изберете „запази снимката“); черновите се пазят най-много 30 дни.
            Извлечените артикули остават — те са част от счетоводството на групата.
          </li>
          <li>
            <strong>Дневник на активността:</strong> докато съществува групата; при изтриване на
            акаунт името ви в него става „изтрит потребител“.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">6. Вашите права</h2>
        <p>
          От <Link className="underline" href="/settings">настройките на профила</Link> можете сами да:
          изтеглите данните си (JSON) и да изтриете акаунта си — незабавно, без въпроси. В
          споделените групи разходите остават (те са и на другите участници), но се отвързват от
          вас. Имате и право на корекция, ограничаване и възражение — пишете ни. Ако смятате, че
          нарушаваме правата ви, можете да подадете жалба до КЗЛД (<a className="underline" href="https://www.cpdp.bg" rel="noopener noreferrer" target="_blank">cpdp.bg</a>).
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">7. Бисквитки</h2>
        <p>
          Използваме само две бисквитки, и двете строго необходими: сесията за вход и избраният
          език. Няма рекламни или проследяващи бисквитки — затова няма и банер за съгласие.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">8. Възраст</h2>
        <p>Услугата е предназначена за лица на 14 или повече години.</p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">9. Промени</h2>
        <p>
          При съществени промени ще видите известие в приложението. Датата на последната промяна
          е в началото на тази страница.
        </p>
      </section>
    </article>
  );
}

function En() {
  return (
    <article className="space-y-5 text-sm leading-relaxed text-gray-700">
      <h1 className="text-2xl font-bold text-gray-900">Privacy policy</h1>
      <p className="text-xs text-gray-400">Last updated: 26 August 2026</p>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">In short</h2>
        <p>
          Your data is yours. Money Assistant stores only what is needed to track shared
          expenses; we do not sell data, show ads, or have any access to your bank accounts.
          You can export or delete everything yourself, at any time.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">1. Who is responsible</h2>
        <p>
          The service is operated by its developer (the data controller under the GDPR).
          Contact: <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">2. What we store</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Account:</strong> your email, name, and Google profile picture (if any).</li>
          <li>
            <strong>Groups and expenses:</strong> group and participant names, descriptions,
            amounts, dates, who paid and who owes what.
          </li>
          <li>
            <strong>Receipt scans:</strong> merchant, line items (including the verbatim printed
            text), amounts — and the photo itself while it is retained (see §5).
          </li>
          <li><strong>Activity log:</strong> who did what in a group (names, not emails).</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">3. Why, and on what legal basis</h2>
        <p>
          We process data to provide the service (Art. 6(1)(b) GDPR — performance of a
          contract) and to protect it from abuse (legitimate interest, Art. 6(1)(f)).
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">4. Processors</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Vercel</strong> — application hosting.</li>
          <li><strong>Neon</strong> — database.</li>
          <li><strong>Google</strong> — sign-in.</li>
          <li>
            <strong>OpenRouter</strong> (and the AI model provider selected through it) — reads
            your receipt photo to extract the line items. Photos are sent only when you upload
            one for scanning.
          </li>
        </ul>
        <p className="mt-1">
          Transfers outside the EU rely on the provider&apos;s Standard Contractual Clauses or
          EU-US Data Privacy Framework certification.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">5. Retention</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Account and groups:</strong> until you delete them.</li>
          <li>
            <strong>Receipt photos:</strong> deleted automatically once a scan is converted into
            an expense (unless you tick “keep the photo”); drafts are kept at most 30 days. The
            extracted items remain — they are part of the group&apos;s ledger.
          </li>
          <li>
            <strong>Activity log:</strong> for the life of the group; on account deletion your
            name in it becomes “deleted user”.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">6. Your rights</h2>
        <p>
          From <Link className="underline" href="/settings">account settings</Link> you can export
          your data (JSON) and delete your account — immediately, no questions asked. In shared
          groups your expenses remain (they are the other members&apos; records too) but are
          unlinked from you. You also have the rights to rectification, restriction, and
          objection — email us. You can lodge a complaint with the Bulgarian DPA, КЗЛД
          (<a className="underline" href="https://www.cpdp.bg" rel="noopener noreferrer" target="_blank">cpdp.bg</a>).
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">7. Cookies</h2>
        <p>
          We use exactly two cookies, both strictly necessary: the sign-in session and your
          language choice. No advertising or tracking cookies — which is why there is no consent
          banner.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">8. Age</h2>
        <p>The service is intended for people aged 14 or older.</p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">9. Changes</h2>
        <p>
          For material changes you will see a notice in the app. The date of the last change is
          at the top of this page.
        </p>
      </section>
    </article>
  );
}

export default async function PrivacyPage() {
  const locale = await getLocale();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      {locale === "bg" ? <Bg /> : <En />}
      <p className="mt-8 border-t border-gray-200 pt-4 text-xs text-gray-400">
        <Link className="underline" href="/">Money Assistant</Link> ·{" "}
        <Link className="underline" href="/terms">
          {locale === "bg" ? "Условия за ползване" : "Terms of service"}
        </Link>
      </p>
    </main>
  );
}
