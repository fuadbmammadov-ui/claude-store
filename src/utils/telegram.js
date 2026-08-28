const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Satis bildirisleri kimi "yaxsi olardi amma sart deyil" mesajlar ucundur -
// checkout axinini poza bilmez, ona gore xetalari udur, yuxari atmir.
async function sendTelegramMessage(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) {
      console.error('Telegram bildirisi gonderilmedi:', res.status, await res.text());
    }
  } catch (err) {
    console.error('Telegram bildirisi gonderilmedi:', err.message);
  }
}

module.exports = { sendTelegramMessage };
