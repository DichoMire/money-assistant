import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { JoinCard } from "@/components/JoinCard";
import { loadInvitePreview } from "@/lib/group-data";
import { getT } from "@/lib/i18n-server";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/join/${token}`)}`);
  }
  const preview = await loadInvitePreview(token, session.user.id);
  if (preview.state === "member") redirect(`/groups/${preview.groupId}`);

  if (preview.state !== "ok") {
    const t = await getT();
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
