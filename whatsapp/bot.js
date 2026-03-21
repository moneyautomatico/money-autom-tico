const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('qr', qr => {
  console.log("📲 ESCANEIE O QR:");
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log("✅ WhatsApp conectado!");
});

client.on('message', async msg => {
  try {
    const res = await axios.post(
      "https://money-autom-tico-production.up.railway.app/ia/responder",
      {
        mensagem: msg.body
      }
    );

    msg.reply(res.data.resposta);

  } catch (err) {
    console.log("Erro:", err.message);
  }
});

client.initialize();
