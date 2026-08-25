import type { Metadata } from "next";
import Link from "next/link";
import { BLOG_ENTRIES } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Блог · Money Assistant",
  description: "Практични статии за споделени разходи, общи каси и разделяне на сметки.",
  alternates: { canonical: "/blog" },
};

/** Bulgarian-only blog index (RFC 10 §3.2) — driven by the typed registry. */
export default function BlogIndexPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href="/" className="text-gray-400 underline hover:text-gray-600">
          ← Money Assistant
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">Блог</h1>
      {BLOG_ENTRIES.length === 0 ? (
        <p className="mt-6 text-sm text-gray-500">
          Скоро: практични статии за споделени разходи — обща каса със съквартиранти,
          разделяне на сметките от почивка и как да не се карате за пари.
        </p>
      ) : (
        <ul className="mt-6 space-y-5">
          {BLOG_ENTRIES.map((e) => (
            <li key={e.slug}>
              <Link href={`/blog/${e.slug}`} className="font-semibold text-gray-800 underline">
                {e.titleBg}
              </Link>
              <p className="mt-1 text-sm text-gray-500">{e.descriptionBg}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
