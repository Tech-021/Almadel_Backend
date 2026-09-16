const RESEND_ENDPOINT = "https://api.resend.com/emails";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();

  if (!apiKey || !from) {
    throw new Error(
      "Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM.",
    );
  }

  return { apiKey, from };
}

async function sendPasswordResetEmail({ email, fullName, resetUrl }) {
  const { apiKey, from } = emailConfig();
  const greeting = fullName?.trim() ? `Hello ${fullName.trim()},` : "Hello,";
  const safeGreeting = escapeHtml(greeting);
  const safeResetUrl = escapeHtml(resetUrl);
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "Almadel/1.0",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Reset your Almadel password",
      text: [
        greeting,
        "",
        "We received a request to reset your Almadel password.",
        `Open this secure link within 30 minutes: ${resetUrl}`,
        "",
        "If you did not request this change, you can ignore this email.",
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:560px;margin:auto">
          <h1 style="font-size:24px">Reset your Almadel password</h1>
          <p>${safeGreeting}</p>
          <p>We received a request to reset your Almadel password.</p>
          <p>
            <a href="${safeResetUrl}" style="background:#2563eb;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block">
              Choose a new password
            </a>
          </p>
          <p>This link expires in 30 minutes and can only be used once.</p>
          <p style="color:#64748b">If you did not request this change, you can safely ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend rejected the email (${response.status}): ${details}`);
  }
}

module.exports = { sendPasswordResetEmail };