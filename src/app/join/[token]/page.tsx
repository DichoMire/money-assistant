import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { JoinCard } from "@/components/JoinCard";
import { OpenInBrowserHint } from "@/components/OpenInBrowserHint";
import { loadInvitePreview, loadInvitePublicPreview } from "@/lib/group-data";
import { getT } from "@/lib/i18n-server";

type Params = { params: Promise<{ token: string }> };

/**
 * OG tags so an invite pasted into Viber/Messenger unfurls with the group
 * name instead of a naked URL. Uses the same public preview the page itself
 * shows any token holder; invalid/expired tokens get generic metadata only.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const t = await getT();
  const preview = await loadInvitePublicPreview(token);
  if (!preview) {
    return { title: "Money Assistant", robots: { index: false } };
  }
  const title = t("join.ogTitle", { group: preview.groupName });
  const description = t("join.ogDescription", {
    inviter: preview.inviterName,
    count: preview.peopleCount,
  });
  return {
    title,
    description,
    robots: { index: false },
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: "/og/card-bg.png", width: 1200, height: 630 }],
    },
  };
}

export default async function JoinPage({ params }: Params) {
  const { token } = await params;
  const session = await auth();
  const t = await getT();

  // Pre-auth: show WHAT the invite is before demanding a login (the Viber
  // drop-off fix — a faceless redirect to Google converts far worse).
  if (!session?.user?.id) {
    const preview = await loadInvitePublicPreview(token);
    if (!preview) {
      return (
        <main className="flex min-h-screen items-center justify-center px-4">
          <div className="card w-full max-w-sm px-6 py-8 text-center">
            <p className="text-3xl" aria-hidden>🔗</p>
            <h1 className="mt-2 text-lg font-bold text-gray-800">{t("join.unavailable")}</h1>
            <p className="mt-2 text-sm text-gray-500">{t("errors.inviteInvalid")}</p>
          </div>
        </main>
      );
    }
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4">
        <div className="w-full max-w-sm">
          <OpenInBrowserHint />
        </div>
        <JoinCard
          token={token}
          groupName={preview.groupName}
          inviterName={preview.inviterName}
          peopleCount={preview.peopleCount}
          loginHref={`/login?callbackUrl=${encodeURIComponent(`/join/${token}`)}`}
        />
      </main>
    );
  }

  const preview = await loadInvitePreview(token, session.user.id);
  if (preview.state === "member") redirect(`/groups/${preview.groupId}`);

  if (preview.state !== "ok") {
    const message =
      preview.state === "invalid" ? t("errors.inviteInvalid") : t("errors.inviteExpiredOwner");
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="card w-full max-w-sm px-6 py-8 text-center">
          <p className="text-3xl" aria-hidden>🔗</p>
          <h1 className="mt-2 text-lg font-bold text-gray-800">{t("join.unavailable")}</h1>
          <p className="mt-2 text-sm text-gray-500">{message}</p>
          <Link href="/" className="btn btn-primary mt-5">{t("join.goToGroups")}</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <JoinCard
        token={token}
        groupName={preview.groupName}
        inviterName={preview.inviterName}
        peopleCount={preview.peopleCount}
      />
    </main>
  );
}
