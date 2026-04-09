import type { VercelRequest, VercelResponse } from '@vercel/node';

interface InquiryRequest {
  name: string;
  email: string;
  subject: string;
  message: string;
  recaptchaToken?: string;
}

// Prompt injection detection patterns
const INJECTION_PATTERNS = [
  /\b(ignore|disregard|forget)\s+(previous|above|all|your)\s+(instructions|rules|guidelines)/i,
  /\b(you\s+are|act\s+as|pretend\s+to\s+be|roleplay\s+as)\s+/i,
  /\b(system\s*prompt|system\s*instruction|initial\s*prompt)\b/i,
  /\b(inject|injection|jailbreak|DAN|bypass)\b/i,
  /\b(output|print|display|reveal|show)\s+(your|the|system)\s+(prompt|instructions?|rules)/i,
  /\<(system|instruction|prompt)\b/i,
  /\bNEW\s+RULE\b/i,
  /\boverride\s+(previous|all|system)\b/i,
];

const MAX_FIELD_LENGTH: Record<string, number> = {
  name: 100,
  email: 254,
  subject: 200,
  message: 2000,
};

const ALLOWED_SUBJECTS = [
  'サービスについて',
  '料金について',
  '監査レポートについて',
  '技術的なご質問',
  'その他',
];

function sanitize(text: string): string {
  // Strip HTML tags
  let clean = text.replace(/<[^>]*>/g, '');
  // Strip control characters (except newlines/tabs)
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Normalize unicode
  clean = clean.normalize('NFC');
  // Trim whitespace
  clean = clean.trim();
  return clean;
}

function detectInjection(text: string): boolean {
  return INJECTION_PATTERNS.some(pattern => pattern.test(text));
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, email, subject, message, recaptchaToken } = req.body as InquiryRequest;

    // === Input validation ===
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'すべての項目を入力してください' });
    }

    // Length checks
    const fields = { name, email, subject, message };
    for (const [key, value] of Object.entries(fields)) {
      const max = MAX_FIELD_LENGTH[key] || 1000;
      if (value.length > max) {
        return res.status(400).json({ error: `${key}が長すぎます（${max}文字以内）` });
      }
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
    }

    // Subject whitelist
    if (!ALLOWED_SUBJECTS.includes(subject)) {
      return res.status(400).json({ error: '無効なお問い合わせ種別です' });
    }

    // === Sanitize ===
    const cleanName = sanitize(name);
    const cleanEmail = sanitize(email);
    const cleanSubject = sanitize(subject);
    const cleanMessage = sanitize(message);

    // === Prompt injection detection ===
    const allText = `${cleanName} ${cleanEmail} ${cleanSubject} ${cleanMessage}`;
    if (detectInjection(allText)) {
      // Log but don't reveal detection to attacker
      console.warn('Prompt injection attempt detected:', {
        name: cleanName,
        email: cleanEmail,
        subject: cleanSubject,
        preview: cleanMessage.substring(0, 50),
      });
      return res.status(200).json({
        success: true,
        message: 'お問い合わせを受け付けました'
      });
      // Silently drop — looks successful to the sender
    }

    // === reCAPTCHA verification ===
    if (recaptchaToken) {
      const recaptchaSecret = process.env.RECAPTCHA_SECRET_KEY;
      if (recaptchaSecret) {
        const recaptchaRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `secret=${recaptchaSecret}&response=${recaptchaToken}`,
        });
        const recaptchaData = await recaptchaRes.json();
        if (!recaptchaData.success || recaptchaData.score < 0.5) {
          console.warn('reCAPTCHA failed:', recaptchaData);
          return res.status(400).json({ error: 'bot判定されました。もう一度お試しください。' });
        }
      }
    }

    // === Send Telegram notification ===
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    if (!telegramToken || !telegramChatId) {
      console.error('Telegram credentials not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const telegramMessage = `📩 お問い合わせ

お名前: ${cleanName}
Email: ${cleanEmail}
種別: ${cleanSubject}

${cleanMessage}

---
https://ai-seo-audit-lp.vercel.app/`;

    const tgResponse = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: telegramMessage,
      }),
    });

    if (!tgResponse.ok) {
      console.error('Telegram send failed:', await tgResponse.text());
      return res.status(500).json({ error: '送信に失敗しました' });
    }

    return res.status(200).json({
      success: true,
      message: 'お問い合わせを受け付けました'
    });

  } catch (error) {
    console.error('Inquiry API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
