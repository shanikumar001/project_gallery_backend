import nodemailer from 'nodemailer';

let transporter = null;

// Initialize the transporter
function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || 'smtp-relay.sendinblue.com';
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn(
      'Email: SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS). Emails will not be sent.'
    );
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: Number(port) === 465, // true only for port 465
    logger: true,       
    debug: true, 
    auth: { user, pass },
    tls: { rejectUnauthorized: false }, // avoid SSL issues
    connectionTimeout: 10000, // 10s timeout
  });

  return transporter;
}

// Generic email sender
export async function sendEmail({ to, subject, text, html }) {
  const transport = getTransporter();
  if (!transport) return { sent: false, reason: 'SMTP not configured' };

  const from =
    process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@example.com';

  try {
    const info = await transport.sendMail({ from, to, subject, text, html });
    console.log('Email sent:', info.response || info);
    return { sent: true };
  } catch (err) {
    console.error('Email send error:', err);
    return { sent: false, error: err.message };
  }
}

// Send OTP email
export async function sendOtpEmail({ toEmail, otp }) {
  const emailResult = await sendEmail({
    to: toEmail,
    subject: 'Your verification code - Project Gallery',
    text: `Your verification code is: ${otp}. It expires in 10 minutes.`,
    html: `
      <p>Your verification code is: <strong>${otp}</strong></p>
      <p>It expires in 10 minutes.</p>
      <p>If you didn't request this, you can ignore this email.</p>
    `,
  });

  if (!emailResult.sent) {
    console.error('OTP email failed:', emailResult);
    throw new Error('Unable to send OTP. Please try again later.');
  }

  return emailResult;
}

// Send follow request email
export async function sendFollowRequestEmail({ toEmail, fromName }) {
  const emailResult = await sendEmail({
    to: toEmail,
    subject: `${fromName} wants to follow you`,
    text: `${fromName} has sent you a follow request on Project Gallery. Log in to accept or decline.`,
    html: `
      <p><strong>${fromName}</strong> has sent you a follow request on Project Gallery.</p>
      <p>Log in to accept or decline.</p>
    `,
  });

  if (!emailResult.sent) console.error('Follow request email failed:', emailResult);
  return emailResult;
}

// Send new message email
export async function sendNewMessageEmail({ toEmail, fromName, messagePreview }) {
  const emailResult = await sendEmail({
    to: toEmail,
    subject: `${fromName} sent you a message`,
    text: `You have a new message from ${fromName}:\n\n"${messagePreview}"\n\nLog in to Project Gallery to reply.`,
    html: `
      <p>You have a new message from <strong>${fromName}</strong>.</p>
      <p>"${messagePreview}"</p>
      <p>Log in to Project Gallery to reply.</p>
    `,
  });

  if (!emailResult.sent) console.error('Message email failed:', emailResult);
  return emailResult;
}
