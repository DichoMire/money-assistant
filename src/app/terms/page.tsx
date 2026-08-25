import type { Metadata } from "next";
import Link from "next/link";
import { getLocale } from "@/lib/i18n-server";

/**
 * Terms of service — DRAFT for legal review (RFC 08 §3.3 outline). The
 * load-bearing clauses: not a financial institution, records are informal,
 * AI output may be wrong. Bulgarian primary, English mirror.
 */

export const metadata: Metadata = {
  title: "Условия за ползване · Money Assistant",
};

function Bg() {
  return (
    <article className="space-y-5 text-sm leading-relaxed text-gray-700">
      <h1 className="text-2xl font-bold text-gray-900">Условия за ползване</h1>
      <p className="text-xs text-gray-400">Последна промяна: 26 август 2026 г.</p>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">1. Какво е услугата</h2>
        <p>
          Money Assistant е приложение за неформално водене на общи разходи между хора, които се
          познават — пътувания, съквартиранти, излизания. Създавате група, записвате кой какво е
          платил, а приложението смята кой на кого колко дължи.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">2. Не сме финансова институция</h2>
        <p>
          Приложението не е банка, платежна институция или кредитор. То <strong>никога не държи и
          не движи пари</strong> — само смята. Всяко реално плащане се случва изцяло извън
          приложението, между вас и другите участници.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">3. Записите са информативни</h2>
        <p>
          Балансите и „дълговете“ в приложението са неформални записи, а не правно обвързващи
          договори или доказателство за изискуеми вземания. Операторът не е страна по
          отношенията между участниците и не се намесва в спорове между тях.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">4. Сканирането на бонове е автоматично</h2>
        <p>
          Разчитането на касови бонове използва изкуствен интелект и <strong>може да греши</strong> —
          суми, артикули или дати може да бъдат разчетени неточно. Проверявайте резултата, преди
          да разчитате на него.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">5. Възраст и допустимо ползване</h2>
        <p>
          Услугата е за лица на 14 или повече години. Забранено е използването ѝ за незаконни
          цели, за тормоз на други потребители или за опити за нарушаване на сигурността ѝ.
          Можем да прекратим акаунти, които нарушават тези условия.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">6. Отговорност</h2>
        <p>
          Услугата се предоставя „както е“. Доколкото законът позволява, операторът не отговаря за
          пропуснати ползи или косвени вреди, произтичащи от използването ѝ. Нищо в тези условия
          не ограничава правата ви на потребител по задължителното законодателство.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">7. Приложимо право</h2>
        <p>Прилага се правото на Република България.</p>
      </section>
    </article>
  );
}

function En() {
  return (
    <article className="space-y-5 text-sm leading-relaxed text-gray-700">
      <h1 className="text-2xl font-bold text-gray-900">Terms of service</h1>
      <p className="text-xs text-gray-400">Last updated: 26 August 2026</p>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">1. The service</h2>
        <p>
          Money Assistant is an app for informal tracking of shared expenses between people who
          know each other — trips, flatmates, nights out. You create a group, record who paid
          what, and the app computes who owes whom.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">2. Not a financial institution</h2>
        <p>
          The app is not a bank, payment institution, or lender. It <strong>never holds or moves
          money</strong> — it only does the math. Any actual payment happens entirely outside the
          app, between you and the other participants.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">3. Records are informational</h2>
        <p>
          Balances and “debts” shown in the app are informal records, not legally binding
          contracts or evidence of enforceable claims. The operator is not a party to disputes
          between users.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">4. Receipt scanning is automated</h2>
        <p>
          Receipt reading uses AI and <strong>may be wrong</strong> — amounts, items, or dates can
          be misread. Verify the result before relying on it.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">5. Age and acceptable use</h2>
        <p>
          The service is for people aged 14 or older. Using it for unlawful purposes, to harass
          other users, or to attempt to breach its security is prohibited. Accounts violating
          these terms may be terminated.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">6. Liability</h2>
        <p>
          The service is provided “as is”. To the extent the law allows, the operator is not
          liable for lost profits or indirect damages arising from its use. Nothing in these
          terms limits your mandatory consumer rights.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-semibold text-gray-900">7. Governing law</h2>
        <p>The law of the Republic of Bulgaria applies.</p>
      </section>
    </article>
  );
}

export default async function TermsPage() {
  const locale = await getLocale();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      {locale === "bg" ? <Bg /> : <En />}
      <p className="mt-8 border-t border-gray-200 pt-4 text-xs text-gray-400">
        <Link className="underline" href="/">Money Assistant</Link> ·{" "}
        <Link className="underline" href="/privacy">
          {locale === "bg" ? "Политика за поверителност" : "Privacy policy"}
        </Link>
      </p>
    </main>
  );
}
