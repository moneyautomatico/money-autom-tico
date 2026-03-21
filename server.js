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

// 🔗 CONEXÃO COM MONGO
mongoose.connect(MONGO_URI)
.then(() => console.log("✅ MongoDB conectado"))
.catch(err => console.log(err));

// 📦 MODELO USUÁRIO
const User = mongoose.model('User', {
    email: String,
    password: String
});

// 🔐 LOGIN
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    const user = await User.findOne({ email, password });

    if (!user) {
        return res.status(401).json({ erro: "Usuário inválido" });
    }

    const token = jwt.sign({ id: user._id }, JWT_SECRET);

    res.json({ token, userId: user._id });
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

// 🔥 WHATSAPP CONFIG
let client;

function iniciarWhatsApp() {
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', qr => {
        console.log('📱 ESCANEIE O QR CODE:');
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
        console.log('✅ WhatsApp conectado!');
    });

    client.initialize();
}

iniciarWhatsApp();

// 📤 DISPARO
app.post('/enviar', auth, async (req, res) => {
    const { numeros, mensagem } = req.body;

    if (!client) {
        return res.status(500).json({ erro: "WhatsApp não conectado" });
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

// 🤖 SALVAR IA
let IA_TEXTO = "";

app.post('/salvar-ia', auth, (req, res) => {
    IA_TEXTO = req.body.texto;
    res.json({ ok: true });
});

// 🤖 CARREGAR IA
app.get('/carregar-ia', auth, (req, res) => {
    res.json({ texto: IA_TEXTO });
});

// 📡 RESPOSTA AUTOMÁTICA
function iniciarIA() {
    if (!client) return;

    client.on('message', async msg => {
        if (IA_TEXTO) {
            msg.reply(IA_TEXTO);
        }
    });
}

// ⏱️ GARANTE QUE IA INICIA
setTimeout(iniciarIA, 10000);

// 🌐 SERVIR FRONTEND
app.use(express.static(path.join(__dirname, 'public')));

// 🚀 START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
