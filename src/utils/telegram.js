const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// Bir neçə nəfərə bildiriş getsin deyə vergüllə ayrılmış chat ID-lərə icazə verilir (məs. "111,222").
const CHAT_IDS = (process.env.TELEGRAM_CHAT_ID || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

// Satis bildirisleri kimi "yaxsi olardi amma sart deyil" mesajlar ucundur -
// checkout axinini poza bilmez, ona gore xetalari udur, yuxari atmir.
async function sendTelegramMessage(text) {
  if (!BOT_TOKEN || !CHAT_IDS.length) return;

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  await Promise.all(
    CHAT_IDS.map(async (chatId) => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        });
        if (!res.ok) {
          console.error('Telegram bildirisi gonderilmedi:', chatId, res.status, await res.text());
        }
      } catch (err) {
        console.error('Telegram bildirisi gonderilmedi:', chatId, err.message);
      }
    })
  );
}

module.exports = { sendTelegramMessage };
