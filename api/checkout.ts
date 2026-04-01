import type { VercelRequest, VercelResponse } from '@vercel/node';

interface CheckoutRequest {
  plan: string;
  url: string;
  email: string;
  industry?: string;
  recaptchaToken?: string;
  visitorId?: string;
  payjpToken?: string;
}

interface RecaptchaResponse {
  success: boolean;
  score: number;
  action: string;
  error_codes?: string[];
}

const PLAN_PRICES: Record<string, number> = {
  trial: 4980,
  standard: 9800,
  business: 79800
};

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
    const { plan, url, email, industry, recaptchaToken, visitorId, payjpToken } = req.body as CheckoutRequest;

    // Validation
    if (!plan || !url || !email) {
      return res.status(400).json({ error: 'Plan, URL and email are required' });
    }

    if (!payjpToken) {
      return res.status(400).json({ error: 'Payment token is required' });
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

    // Validate plan
    const amount = PLAN_PRICES[plan];
    if (!amount) {
      return res.status(400).json({ error: 'Invalid plan' });
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

      if (verifyResult.score < 0.5) {
        console.error(`reCAPTCHA score too low: ${verifyResult.score}`);
        return res.status(400).json({ error: 'Suspicious activity detected' });
      }

      console.log(`reCAPTCHA score: ${verifyResult.score}, action: ${verifyResult.action}, visitorId: ${visitorId || 'N/A'}`);
    }

    // PAY.JP決済処理
    const payjpSecretKey = process.env.PAYJP_SECRET_KEY;
    if (!payjpSecretKey) {
      console.error('PAYJP_SECRET_KEY is not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const chargeResponse = await fetch('https://api.pay.jp/v1/charges', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(payjpSecretKey + ':').toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        amount: amount.toString(),
        currency: 'jpy',
        card: payjpToken,
        capture: 'true',
        'metadata[plan]': plan,
        'metadata[email]': email,
        'metadata[url]': url
      }).toString()
    });

    const chargeResult = await chargeResponse.json();

    if (!chargeResponse.ok) {
      console.error('PAY.JP charge failed:', chargeResult);
      return res.status(400).json({ error: chargeResult.error?.message || 'Payment failed' });
    }

    console.log('PAY.JP charge success:', chargeResult.id);

    // Send Telegram notification
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    if (telegramToken && telegramChatId) {
      const planNames: Record<string, string> = {
        trial: 'お試し',
        standard: 'スタンダード',
        business: 'ビジネス'
      };

      const message = `💳 有料プラン申込み

プラン: ${planNames[plan]}（¥${amount.toLocaleString()}）
URL: ${url}
Email: ${email}
業種: ${industry || '未選択'}
決済ID: ${chargeResult.id}

---
対応: Optimusでレポート生成 → Azumaレビュー → Gmail送信`;

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
      message: '決済が完了しました',
      chargeId: chargeResult.id,
      data: { plan, url, email, industry, amount }
    });

  } catch (error) {
    console.error('Checkout API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
