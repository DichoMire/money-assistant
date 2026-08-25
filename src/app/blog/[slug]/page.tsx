import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { BLOG_ENTRIES } from "@/lib/blog";

/**
 * Article bodies, keyed by slug (see src/lib/blog.ts for how to add one).
 * Plain server-compiled JSX: typo-checked by the compiler, styled by the
 * landing's typography, zero build tooling.
 */
const ARTICLE_BODIES: Record<string, () => ReactNode> = {
  // "prilozhenie-za-obshti-razhodi-sakvartiranti": () => (<>…</>),
};

type Params = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return BLOG_ENTRIES.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const entry = BLOG_ENTRIES.find((e) => e.slug === slug);
  if (!entry) return {};
  return {
    title: `${entry.titleBg} · Money Assistant`,
    description: entry.descriptionBg,
    alternates: { canonical: `/blog/${slug}` },
  };
}

export default async function BlogArticlePage({ params }: Params) {
  const { slug } = await params;
  const entry = BLOG_ENTRIES.find((e) => e.slug === slug);
  const Body = ARTICLE_BODIES[slug];
  if (!entry || !Body) notFound();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href="/blog" className="text-gray-400 underline hover:text-gray-600">
          ← Блог
        </Link>
      </p>
      <article className="prose-sm mt-2 leading-relaxed text-gray-700">
        <h1 className="text-2xl font-bold text-gray-900">{entry.titleBg}</h1>
        <p className="mt-1 text-xs text-gray-400">{entry.published}</p>
        <div className="mt-5 space-y-4">{Body()}</div>
      </article>
    </main>
  );
}
