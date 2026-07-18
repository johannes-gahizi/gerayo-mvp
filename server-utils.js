const crypto = require('crypto');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

function hashPassword(password) {
  return `pbkdf2$${crypto.pbkdf2Sync(password, 'gerayo-salt', 100000, 64, 'sha512').toString('hex')}`;
}

function verifyPassword(inputPassword, storedPassword) {
  if (!storedPassword) return false;
  if (storedPassword === inputPassword) return true;
  if (storedPassword.startsWith('pbkdf2$')) {
    return hashPassword(inputPassword) === storedPassword;
  }
  return false;
}

function buildPasswordResetMail({ to, resetUrl, appName = 'Gerayo' }) {
  return {
    from: `"${appName}" <no-reply@gerayo.app>`,
    to,
    subject: `Reset your ${appName} password`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px;">
        <h2 style="margin-bottom: 8px; color: #0f172a;">Reset your password</h2>
        <p style="color: #475569; line-height: 1.6;">We received a request to reset your Gerayo password. Click the button below to choose a new one.</p>
        <p style="margin: 24px 0;"><a href="${resetUrl}" style="display: inline-block; background: #16a34a; color: white; text-decoration: none; padding: 12px 18px; border-radius: 999px; font-weight: 700;">Reset password</a></p>
        <p style="color: #64748b; font-size: 0.9rem;">If you did not request this, you can safely ignore this email.</p>
      </div>
    `
  };
}

async function sendPasswordResetEmail({ to, resetUrl, appName = 'Gerayo', smtpConfig = {} }) {
  const host = smtpConfig.host || process.env.SMTP_HOST;
  const port = Number(smtpConfig.port || process.env.SMTP_PORT || 587);
  const secure = smtpConfig.secure ?? process.env.SMTP_SECURE === 'true';
  const user = smtpConfig.user || process.env.SMTP_USER;
  const pass = smtpConfig.pass || process.env.SMTP_PASS;
  const from = smtpConfig.from || process.env.MAIL_FROM || `"${appName}" <no-reply@gerayo.app>`;

  if (!host || !user || !pass) {
    throw new Error('SMTP credentials are not configured');
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });

  await transport.sendMail({
    ...buildPasswordResetMail({ to, resetUrl, appName }),
    from
  });

  return true;
}

async function buildTicketResponse(booking, bus, company) {
  const qr = await QRCode.toDataURL(`TICKET-${booking.id}`);

  return {
    id: booking.id,
    booking_id: booking.id,
    passenger_name: booking.name || booking.passenger_name || 'Guest',
    name: booking.name || booking.passenger_name || 'Guest',
    company_name: company?.name || company?.company_name || 'Gerayo',
    from_city: bus?.from_city || null,
    to_city: bus?.to_city || null,
    time: bus?.time || null,
    price: bus?.price || null,
    status: booking.status || 'PENDING',
    payment_status: booking.payment_status || 'PENDING',
    payment_reference: booking.payment_reference || null,
    seat_number: booking.seat_number || null,
    qr,
    created_at: booking.created_at || null
  };
}

module.exports = {
  buildTicketResponse,
  hashPassword,
  verifyPassword,
  buildPasswordResetMail,
  sendPasswordResetEmail
};
