import type { VercelRequest, VercelResponse } from '@vercel/node';

interface ContactRequest {
  plan: string;
  url: string;
  company: string;
  email: string;
  budget?: string;
  needs?: string;
}

const BUDGET_LABELS: Record<string, string> = {
  '5-10': '月5〜10万円程度',
  '10-30': '月10〜30万円程度',
  '30-50': '月30〜50万円程度',
  '50+': '月50万円以上',
  'undecided': '相談して決めたい'
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
    const { plan, url, company, email, budget, needs } = req.body as ContactRequest;

    // Validation
    if (!url || !company || !email) {
      return res.status(400).json({ error: 'URL, company name and email are required' });
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

    if (!telegramToken || !telegramChatId) {
      console.error('Telegram credentials not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const budgetLabel = budget ? (BUDGET_LABELS[budget] || budget) : '未選択';

    const message = `📋 ビジネスプランお問い合わせ

URL: ${url}
会社名: ${company}
Email: ${email}
予算感: ${budgetLabel}
ご要望: ${needs || 'なし'}

---
担当: ヒアリング → 見積もり → 契約`;

    const telegramResponse = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: message,
      }),
    });

    if (!telegramResponse.ok) {
      console.error('Telegram send failed:', await telegramResponse.text());
      return res.status(500).json({ error: 'Failed to send notification' });
    }

    return res.status(200).json({
      success: true,
      message: 'お問い合わせを受け付けました'
    });

  } catch (error) {
    console.error('Contact API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
