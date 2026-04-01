import type { VercelRequest, VercelResponse } from '@vercel/node';

interface AuditRequest {
  url: string;
  email: string;
  industry?: string;
  recaptchaToken?: string;
  visitorId?: string;
}

interface RecaptchaResponse {
  success: boolean;
  score: number;
  action: string;
  error_codes?: string[];
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url, email, industry, recaptchaToken, visitorId } = req.body as AuditRequest;

    // Validation
    if (!url || !email) {
      return res.status(400).json({ error: 'URL and email are required' });
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    // reCAPTCHA v3 verification
    if (recaptchaToken) {
      const recaptchaSecret = process.env.RECAPTCHA_SECRET_KEY;
      if (!recaptchaSecret) {
        console.error('RECAPTCHA_SECRET_KEY is not set');
        return res.status(500).json({ error: 'Server configuration error' });
      }

      const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${recaptchaSecret}&response=${recaptchaToken}`;
      const verifyResponse = await fetch(verifyUrl, { method: 'POST' });
      const verifyResult: RecaptchaResponse = await verifyResponse.json();

      if (!verifyResult.success) {
        console.error('reCAPTCHA verification failed:', verifyResult.error_codes);
        return res.status(400).json({ error: 'reCAPTCHA verification failed' });
      }

      // Score threshold: 0.5 (0.0 = bot, 1.0 = human)
      if (verifyResult.score < 0.5) {
        console.error(`reCAPTCHA score too low: ${verifyResult.score}`);
        return res.status(400).json({ error: 'Suspicious activity detected' });
      }

      console.log(`reCAPTCHA score: ${verifyResult.score}, action: ${verifyResult.action}, visitorId: ${visitorId || 'N/A'}`);
    } else {
      console.warn('No reCAPTCHA token provided');
      return res.status(400).json({ error: 'reCAPTCHA token is required' });
    }

    // Send Telegram notification
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    if (telegramToken && telegramChatId) {
      const message = `🔍 新規SEO監査リクエスト

URL: ${url}
Email: ${email}
業種: ${industry || '未選択'}

---
対応: Optimusでレポート生成 → Azumaレビュー`;

      await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: message,
        }),
      });
    }

    return res.status(200).json({
      success: true,
      message: '監査リクエストを受け付けました',
      data: { url, email, industry }
    });

  } catch (error) {
    console.error('Audit API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
