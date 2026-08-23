/**
 * Invite email delivery via Resend's REST API (https://resend.com). Optional:
 * without RESEND_API_KEY nothing is sent — invites still work because they
 * appear in-app on the invitee's dashboard. Failures are swallowed on purpose:
 * the email-invite endpoint must behave identically whether or not an email
 * actually went out (anonymity) and an email outage must not break inviting.
 */
export async function sendInviteEmail(params: {
  to: string;
  groupName: string;
  inviterName: string;
  url: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.log(`[invite] RESEND_API_KEY not set; join link for ${params.to}: ${params.url}`);
    }
    return;
  }
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const groupName = escape(params.groupName);
  const inviterName = escape(params.inviterName);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "Money Assistant <onboarding@resend.dev>",
        to: [params.to],
        subject: `${params.inviterName} invited you to "${params.groupName}" on Money Assistant`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <h2 style="color:#159c80">Money Assistant</h2>
            <p><strong>${inviterName}</strong> invited you to join the group
            <strong>"${groupName}"</strong>.</p>
            <p>
              <a href="${params.url}"
                 style="display:inline-block;background:#1cc29f;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">
                Join the group
              </a>
            </p>
            <p style="color:#6b7280;font-size:13px">
              This invite expires in 7 days. If you don't have an account yet, you can sign in
              with Google using this email address. If you weren't expecting this, ignore this email.
            </p>
          </div>`,
      }),
    });
    if (!res.ok) {
      console.error(`[invite] Resend responded ${res.status}: ${await res.text()}`);
    }
  } catch (error) {
    console.error("[invite] failed to send email:", error);
  }
}
