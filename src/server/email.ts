/**
 * Transactional email. Uses Resend when RESEND_API_KEY is configured; otherwise the message is
 * written to the server log and the caller exposes the link to the admin in the UI.
 */
export async function sendEmail(msg: { to: string; subject: string; text: string; html?: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`[gear-tractor] email (not sent, no provider configured) to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
    return { delivered: false };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "Gear Tractor <no-reply@geartractor.app>",
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      }),
    });
    if (!res.ok) {
      console.error("[gear-tractor] email delivery failed", res.status);
      return { delivered: false };
    }
    return { delivered: true };
  } catch (err) {
    console.error("[gear-tractor] email delivery error", err);
    return { delivered: false };
  }
}
