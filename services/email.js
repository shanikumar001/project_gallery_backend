import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn('Email: SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS). Emails will not be sent.');
    return null;
  }
  transporter = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: Number(port) === 465,
    auth: { user, pass },
  });
  return transporter;
}

export async function sendEmail({ to, subject, text, html }) {
  const transport = getTransporter();
  if (!transport) return { sent: false, reason: 'SMTP not configured' };

  const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@example.com';

  try {
    await transport.sendMail({
      from,
      to,
      subject,
      text: text || (html && html.replace(/<[^>]*>/g, '')),
      html: html || undefined,
    });
    return { sent: true };
  } catch (err) {
    console.error('Email send error:', err);
    return { sent: false, error: err.message };
  }
}

export async function sendNewMessageEmail({ toEmail, toName, fromName, messagePreview }) {
  return sendEmail({
    to: toEmail,
    subject: `${fromName} sent you a message`,
    text: `You have a new message from ${fromName}:\n\n"${messagePreview}"\n\nLog in to Project Gallery to reply.`,
    html: `
      <p>You have a new message from <strong>${fromName}</strong>.</p>
      <p>"${messagePreview}"</p>
      <p>Log in to Project Gallery to reply.</p>
    `,
  });
}

export async function sendFollowRequestEmail({ toEmail, toName, fromName }) {
  return sendEmail({
    to: toEmail,
    subject: `${fromName} wants to follow you`,
    text: `${fromName} has sent you a follow request on Project Gallery. Log in to accept or decline.`,
    html: `
      <p><strong>${fromName}</strong> has sent you a follow request on Project Gallery.</p>
      <p>Log in to accept or decline.</p>
    `,
  });
}

export async function sendOtpEmail({ toEmail, otp }) {
  return sendEmail({
    to: toEmail,
    subject: 'Your verification code - Project Gallery',
    text: `Your verification code is: ${otp}. It expires in 10 minutes.`,
    html: `
      <p>Your verification code is: <strong>${otp}</strong></p>
      <p>It expires in 10 minutes.</p>
      <p>If you didn't request this, you can ignore this email.</p>
    `,
  });
}
