// Transactional email through Brevo (https://www.brevo.com) using its HTTP API.
// Needs Node 18+ (built-in fetch). Set BREVO_API_KEY and BREVO_SENDER_EMAIL in .env.
// The sender address must be a verified sender in your Brevo account.

const APP_NAME = 'Vyro Calls';
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendMail({ to, toName, subject, html, text }) {
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    // No key: in development print the mail so flows can be tested; never in production.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('BREVO_API_KEY is not set, so the email could not be sent');
    }
    console.log(`\n[dev] BREVO_API_KEY not set. Email to ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }

  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  if (!senderEmail) throw new Error('BREVO_SENDER_EMAIL is not set');

  const res = await fetch(BREVO_URL, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: process.env.BREVO_SENDER_NAME || APP_NAME, email: senderEmail },
      to: [{ email: to, name: toName || to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo responded ${res.status}: ${body.slice(0, 300)}`);
  }
}

// Shared layout so every email looks like the app
function layout(inner) {
  return (
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f1a33">` +
    `<div style="font-size:20px;font-weight:800;color:#1b4fd8;margin-bottom:18px">${APP_NAME}</div>` +
    inner +
    `<p style="color:#8a93a6;font-size:12px;margin-top:28px">— The ${APP_NAME} team</p></div>`
  );
}

async function sendOtp({ to, name, code, purpose }) {
  const isReset = purpose === 'reset';
  const subject = isReset ? `${code} is your ${APP_NAME} password reset code` : `${code} is your ${APP_NAME} verification code`;
  const intro = isReset
    ? 'Use this code to reset your password.'
    : `Welcome to ${APP_NAME}! Use this code to verify your email address.`;

  await sendMail({
    to,
    toName: name,
    subject,
    text:
      `Hi ${name},\n\n${intro}\n\nYour code: ${code}\n\n` +
      `It expires in 10 minutes. If you didn't request it, you can ignore this email.`,
    html: layout(
      `<p>Hi ${escapeHtml(name)},</p><p>${intro}</p>` +
        `<p style="font-size:34px;font-weight:800;letter-spacing:8px;background:#eef3ff;border-radius:10px;padding:14px 0;text-align:center;color:#1b4fd8">${code}</p>` +
        `<p style="color:#5b6579;font-size:13px">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>`
    ),
  });
}

async function sendIncomingCall({ to, name, callerName, callType, link }) {
  const kind = callType === 'video' ? 'video call' : 'call';
  await sendMail({
    to,
    toName: name,
    subject: `📞 ${callerName} is calling you on ${APP_NAME}`,
    text:
      `Hi ${name},\n\n${callerName} is calling you (${kind}). Please pick up the call.\n\n` +
      `Open ${APP_NAME} to answer: ${link}`,
    html: layout(
      `<p>Hi ${escapeHtml(name)},</p>` +
        `<p style="font-size:18px"><strong>${escapeHtml(callerName)}</strong> is calling you (${kind}). <strong>Please pick up the call.</strong></p>` +
        `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 22px;background:#1b4fd8;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">Open ${APP_NAME} &amp; answer</a></p>` +
        `<p style="color:#5b6579;font-size:13px">Sign in and keep the app open to receive the ringing call.</p>`
    ),
  });
}

async function sendMissedCall({ to, name, callerName, callType, isGroup, at, link }) {
  const kind = `${isGroup ? 'group ' : ''}${callType === 'video' ? 'video call' : 'call'}`;
  const when = new Date(at).toUTCString();
  await sendMail({
    to,
    toName: name,
    subject: `Missed ${kind} from ${callerName} on ${APP_NAME}`,
    text: `Hi ${name},\n\nYou missed a ${kind} from ${callerName} (${when}).\n\nOpen ${APP_NAME} to call them back: ${link}`,
    html: layout(
      `<p>Hi ${escapeHtml(name)},</p>` +
        `<p style="font-size:18px">You <strong>missed a ${kind}</strong> from <strong>${escapeHtml(callerName)}</strong>.</p>` +
        `<p style="color:#5b6579;font-size:13px">${escapeHtml(when)}</p>` +
        `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 22px;background:#1b4fd8;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">Open ${APP_NAME} &amp; call back</a></p>`
    ),
  });
}

async function sendGroupInvite({ to, name, hostName, callType, link }) {
  const kind = callType === 'video' ? 'group video call' : 'group call';
  await sendMail({
    to,
    toName: name,
    subject: `📞 ${hostName} is inviting you to a ${kind} on ${APP_NAME}`,
    text: `Hi ${name},\n\n${hostName} is inviting you to a ${kind}. Please join now.\n\nOpen ${APP_NAME}: ${link}`,
    html: layout(
      `<p>Hi ${escapeHtml(name)},</p>` +
        `<p style="font-size:18px"><strong>${escapeHtml(hostName)}</strong> is inviting you to a ${kind}. <strong>Please join now.</strong></p>` +
        `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 22px;background:#1b4fd8;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">Open ${APP_NAME} &amp; join</a></p>` +
        `<p style="color:#5b6579;font-size:13px">Sign in and keep the app open to see the invitation.</p>`
    ),
  });
}

module.exports = { sendOtp, sendIncomingCall, sendMissedCall, sendGroupInvite, APP_NAME };
