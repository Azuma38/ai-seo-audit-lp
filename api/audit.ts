import type { VercelRequest, VercelResponse } from '@vercel/node';

interface AuditRequest {
  url: string;
  email: string;
  industry?: string;
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
    const { url, email, industry } = req.body as AuditRequest;

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
