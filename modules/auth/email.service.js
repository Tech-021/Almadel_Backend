const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isStressMailSink() {
  return process.env.NODE_ENV === "stress" && process.env.STRESS_TEST === "true";
}

function recordStressMail(kind, durationMs) {
  try {
    const dir = path.join(__dirname, "..", "..", "stress", "runtime");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "mail-timings.jsonl"),
      `${JSON.stringify({ kind, ms: durationMs, at: new Date().toISOString() })}\n`,
    );
  } catch (error) {
    console.error("Stress mail timing was not recorded:", error.message);
  }
}

let cachedTransporter = null;

function getSmtpTransporter() {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  if (!host || !user || !pass) {
    return null;
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: false,
    },
  });

  return cachedTransporter;
}

function getFromAddress() {
  return (
    process.env.SMTP_FROM?.trim() ||
    process.env.EMAIL_FROM?.trim() ||
    `"Zero To One" <sarim@tech-021.com>`
  );
}

/**
 * Sends team credentials email to newly added staff or accountant.
 */
async function sendCredentialsEmail({
  email,
  fullName,
  role,
  password,
  businessName,
  loginUrl,
}) {
  const started = Date.now();
  const transporter = getSmtpTransporter();
  const roleTitle = role === "accountant" ? "Accountant" : "Staff Member";
  const storeName = businessName?.trim() || "Your Store";
  const url = loginUrl || `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`;
  const from = getFromAddress();

  const greeting = fullName?.trim() ? `Hello ${fullName.trim()},` : "Hello,";
  const safeGreeting = escapeHtml(greeting);
  const safeFullName = escapeHtml(fullName || "");
  const safeStore = escapeHtml(storeName);
  const safeEmail = escapeHtml(email);
  const safePassword = escapeHtml(password);
  const safeRoleTitle = escapeHtml(roleTitle);
  const safeUrl = escapeHtml(url);

  const subject = `Your Credentials for ${storeName} - Almadel Store Management`;

  const textBody = [
    greeting,
    "",
    `You have been added as an ${roleTitle} for "${storeName}" on Almadel Store Management.`,
    "",
    "Your Login Credentials:",
    `Role: ${roleTitle}`,
    `Email / Username: ${email}`,
    `Password: ${password}`,
    `Login URL: ${url}`,
    "",
    "Please sign in and keep your credentials secure.",
    "",
    "Best regards,",
    "Almadel Store Management Team",
  ].join("\n");

  const htmlBody = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(subject)}</title>
      </head>
      <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;">
        <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
          <tr>
            <td align="center">
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 10px 25px -5px rgba(0,0,0,0.06), 0 8px 10px -6px rgba(0,0,0,0.04);border:1px solid #e2e8f0;">
                
                <!-- Brand Header -->
                <tr>
                  <td style="padding:32px 32px 24px;background:linear-gradient(135deg, #00875a 0%, #006644 100%);text-align:center;">
                    <div style="display:inline-block;padding:8px 14px;background:rgba(255,255,255,0.18);border-radius:12px;font-size:18px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;margin-bottom:8px;">
                      🛍️ Almadel
                    </div>
                    <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">
                      Welcome to the Team
                    </h1>
                    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;font-weight:600;">
                      Store Management Platform
                    </p>
                  </td>
                </tr>

                <!-- Content Area -->
                <tr>
                  <td style="padding:32px;">
                    <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#0f172a;">
                      ${safeGreeting}
                    </p>
                    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#475569;">
                      You have been granted access as an <strong>${safeRoleTitle}</strong> for <strong>${safeStore}</strong>. Below are your official login credentials to access the workspace:
                    </p>

                    <!-- Credentials Box -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:16px;margin:24px 0;padding:20px;">
                      <tr>
                        <td>
                          <div style="margin-bottom:12px;">
                            <span style="display:block;font-size:11px;font-weight:800;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;">Business / Store</span>
                            <strong style="font-size:14px;color:#0f172a;">${safeStore}</strong>
                          </div>
                          <div style="margin-bottom:12px;">
                            <span style="display:block;font-size:11px;font-weight:800;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;">Assigned Role</span>
                            <span style="display:inline-block;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:800;background:#e6f4ed;color:#00875a;">
                              ${safeRoleTitle}
                            </span>
                          </div>
                          <div style="margin-bottom:12px;">
                            <span style="display:block;font-size:11px;font-weight:800;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;">Email / Username</span>
                            <strong style="font-size:14px;color:#0f172a;word-break:break-all;">${safeEmail}</strong>
                          </div>
                          <div>
                            <span style="display:block;font-size:11px;font-weight:800;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;">Password</span>
                            <div style="display:inline-block;background:#ffffff;border:1px solid #94a3b8;padding:8px 14px;border-radius:8px;font-family:Consolas,Monaco,monospace;font-size:15px;font-weight:700;color:#0f172a;letter-spacing:1px;margin-top:4px;">
                              ${safePassword}
                            </div>
                          </div>
                        </td>
                      </tr>
                    </table>

                    <!-- Login Button -->
                    <div style="text-align:center;margin:32px 0 24px;">
                      <a href="${safeUrl}" target="_blank" style="background:#00875a;color:#ffffff;padding:14px 28px;border-radius:12px;text-decoration:none;font-size:14px;font-weight:800;display:inline-block;box-shadow:0 4px 12px rgba(0,135,90,0.3);letter-spacing:0.2px;">
                        Sign In to Almadel &rarr;
                      </a>
                    </div>

                    <p style="margin:24px 0 0;font-size:12px;color:#64748b;line-height:1.5;text-align:center;border-top:1px solid #f1f5f9;padding-top:16px;">
                      🔒 <strong>Security Tip:</strong> For your security, please change your password after your first login. Do not share your password with anyone.
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
                    <p style="margin:0;font-size:11px;color:#94a3b8;font-weight:600;">
                      &copy; ${new Date().getFullYear()} Almadel Store Management Platform. All rights reserved.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  if (isStressMailSink()) {
    const durationMs = Date.now() - started;
    recordStressMail("credentials", durationMs);
    return { success: true, provider: "stress-mock", durationMs };
  }

  if (transporter) {
    const info = await transporter.sendMail({
      from,
      to: email,
      subject,
      text: textBody,
      html: htmlBody,
    });
    return { success: true, messageId: info.messageId, provider: "smtp" };
  }

  // Fallback to Resend API if configured
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (resendApiKey) {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "Almadel/1.0",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        text: textBody,
        html: htmlBody,
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Resend rejected email (${response.status}): ${details}`);
    }
    return { success: true, provider: "resend" };
  }

  throw new Error("No email provider configured. Please check SMTP or Resend settings.");
}

/**
 * Sends password reset email.
 */
async function sendPasswordResetEmail({ email, fullName, resetUrl }) {
  const transporter = getSmtpTransporter();
  const from = getFromAddress();
  const greeting = fullName?.trim() ? `Hello ${fullName.trim()},` : "Hello,";
  const safeGreeting = escapeHtml(greeting);
  const safeResetUrl = escapeHtml(resetUrl);
  const subject = "Reset your Almadel password";

  const textBody = [
    greeting,
    "",
    "We received a request to reset your Almadel password.",
    `Open this secure link within 30 minutes: ${resetUrl}`,
    "",
    "If you did not request this change, you can safely ignore this email.",
  ].join("\n");

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:560px;margin:auto;padding:20px;border:1px solid #e2e8f0;border-radius:16px;">
      <h1 style="font-size:22px;color:#00875a;font-weight:800;">Reset your Almadel password</h1>
      <p>${safeGreeting}</p>
      <p>We received a request to reset your Almadel password.</p>
      <p style="margin:24px 0;">
        <a href="${safeResetUrl}" style="background:#00875a;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:700;">
          Choose a new password &rarr;
        </a>
      </p>
      <p style="font-size:13px;color:#64748b;">This link expires in 30 minutes and can only be used once.</p>
      <p style="font-size:12px;color:#94a3b8;">If you did not request this change, you can safely ignore this email.</p>
    </div>
  `;

  if (isStressMailSink()) {
    recordStressMail("password-reset", 0);
    return { success: true, provider: "stress-mock", durationMs: 0 };
  }

  if (transporter) {
    const info = await transporter.sendMail({
      from,
      to: email,
      subject,
      text: textBody,
      html: htmlBody,
    });
    return { success: true, messageId: info.messageId, provider: "smtp" };
  }

  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (resendApiKey) {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "Almadel/1.0",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        text: textBody,
        html: htmlBody,
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Resend rejected email (${response.status}): ${details}`);
    }
    return { success: true, provider: "resend" };
  }

  throw new Error("No email provider configured. Please check SMTP or Resend settings.");
}

module.exports = {
  sendCredentialsEmail,
  sendPasswordResetEmail,
};