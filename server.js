const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');

// 🔥 WHATSAPP
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json());
app.use(cors());

// 🔐 ENV
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || "segredo";

// 🔗 CONEXÃO COM BANCO ANTIGO (SEM ALTERAR NADA)
mongoose.connect(MONGO_URI)
.then(() => console.log("✅ MongoDB conectado (antigo mantido)"))
.catch(err => console.log("❌ Erro Mongo:", err));

// 📦 MODELO (compatível com o que já existe)
const User = mongoose.model('User', new mongoose.Schema({
    email: String,
    password: String
}, { collection: 'users' })); // 🔥 força usar coleção antiga

// 🔐 LOGIN
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email, password });

        if (!user) {
            return res.status(401).json({ erro: "Usuário inválido" });
        }

        const token = jwt.sign({ id: user._id }, JWT_SECRET);

        res.json({
            token,
            userId: user._id.toString()
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({ erro: "Erro no login" });
    }
});

// 🔐 MIDDLEWARE
function auth(req, res, next) {
    const token = req.headers.authorization;

    if (!token) return res.status(401).json({ erro: "Sem token" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch {
        res.status(401).json({ erro: "Token inválido" });
    }
}

//////////////////////////////////////////////////////////////////
// 🔥 WHATSAPP (RENDER COMPATÍVEL)
//////////////////////////////////////////////////////////////////

let client;
let isReady = false;

async function iniciarWhatsApp() {
    try {
        client = new Client({
            authStrategy: new LocalAuth({
                dataPath: './session' // evita perder sessão
            }),
            puppeteer: {
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ]
            }
        });

        client.on('qr', qr => {
            console.log('📱 ESCANEIE O QR CODE:');
            qrcode.generate(qr, { small: true });
        });

        client.on('ready', () => {
            console.log('✅ WhatsApp conectado!');
            isReady = true;
        });

        client.on('disconnected', () => {
            console.log('⚠️ WhatsApp desconectado');
            isReady = false;
        });

        await client.initialize();

    } catch (err) {
        console.log("❌ Erro WhatsApp:", err);
    }
}

iniciarWhatsApp();

//////////////////////////////////////////////////////////////////
// 📤 DISPARO
//////////////////////////////////////////////////////////////////

app.post('/enviar', auth, async (req, res) => {
    const { numeros, mensagem } = req.body;

    if (!isReady) {
        return res.status(500).json({ erro: "WhatsApp não conectado ainda" });
    }

    try {
        const lista = numeros.split(',');

        for (let numero of lista) {
            numero = numero.trim();

            if (!numero.includes('@c.us')) {
                numero = numero + '@c.us';
            }

            await client.sendMessage(numero, mensagem);
        }

        res.json({ sucesso: true });

    } catch (err) {
        console.log(err);
        res.status(500).json({ erro: "Erro ao enviar" });
    }
});

//////////////////////////////////////////////////////////////////
// 🤖 IA (mantida simples como estava)
//////////////////////////////////////////////////////////////////

let IA_TEXTO = "";

app.post('/salvar-ia', auth, (req, res) => {
    IA_TEXTO = req.body.texto;
    res.json({ ok: true });
});

app.get('/carregar-ia', auth, (req, res) => {
    res.json({ texto: IA_TEXTO });
});

//////////////////////////////////////////////////////////////////
// 🤖 AUTO RESPOSTA
//////////////////////////////////////////////////////////////////

setTimeout(() => {
    if (!client) return;

    client.on('message', async msg => {
        if (IA_TEXTO) {
            msg.reply(IA_TEXTO);
        }
    });

}, 15000);

//////////////////////////////////////////////////////////////////
// 🌐 FRONTEND
//////////////////////////////////////////////////////////////////

app.use(express.static(path.join(__dirname, 'public')));

//////////////////////////////////////////////////////////////////
// 🚀 START
//////////////////////////////////////////////////////////////////

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
