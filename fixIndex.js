require('dotenv').config();

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState
} = require('@whiskeysockets/baileys');

const axios = require('axios');
const P = require('pino');
const qrcode = require('qrcode-terminal');

const openaiApiKey = process.env.OPENAI_API_KEY;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' })
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (!text) return;

    console.log(`📩 ${sender}: ${text}`);

    try {
      if (text.startsWith('./ai')) {
        const prompt = text.replace('./ai', '').trim();
        const response = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: 'Kamu adalah asisten WhatsApp pintar.' },
              { role: 'user', content: prompt }
            ]
          },
          {
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        const reply = response.data.choices[0].message.content.trim();
        await sock.sendMessage(sender, { text: reply });

      } else if (text.startsWith('./img')) {
        const prompt = text.replace('./img', '').trim();
        const imgResponse = await axios.post(
          'https://api.openai.com/v1/images/generations',
          {
            model: 'dall-e-3',
            prompt,
            n: 1,
            size: '1024x1024'
          },
          {
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const imageUrl = imgResponse.data.data[0].url;
        const imageRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });

        await sock.sendMessage(sender, {
          image: Buffer.from(imageRes.data),
          caption: `🖼️ Hai Bestie, ini Gambar untuk: "${prompt}"`
        });
      }

    } catch (err) {
      console.error('❌ Gagal jawab:', err.response?.data || err.message);
      await sock.sendMessage(sender, { text: '⚠️ Maaf, terjadi kesalahan saat menjawab.' });
    }
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('📷 Scan QR Code di bawah untuk login WhatsApp:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log('❌ Connection closed. Reason:', reason);
      if (reason === DisconnectReason.loggedOut) {
        console.log('❗ QR Code expired. Jalankan ulang bot.');
      } else {
        startBot();
      }
    } else if (connection === 'open') {
      console.log('✅ Bot tersambung ke WhatsApp!');
    }
  });
}

startBot();
