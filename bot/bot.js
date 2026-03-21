const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

function iniciar(user_id) {

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: user_id }),
    puppeteer: {
      headless: true,
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
          mensagem: msg.body,
          user_id: user_id
        }
      );

      msg.reply(res.data.resposta);

    } catch (err) {
      console.log("Erro:", err.message);
    }
  });

  client.initialize();
}

// 🔥 COLE SEU USER_ID AQUI
iniciar("SEU_USER_ID_AQUI");
