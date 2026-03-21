const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');

// WHATSAPP
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json());
app.use(cors());

// ENV
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || "segredo";

// CONEXÃO BANCO (mantém antigo)
mongoose.connect(MONGO_URI)
.then(() => console.log("✅ MongoDB conectado"))
.catch(err => console.log(err));

// MODEL (força coleção antiga)
const User = mongoose.model('User', new mongoose.Schema({
    email: String,
    password: String
}, { collection: 'users' }));

// LOGIN
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
        res.status(500).json({ erro: "Erro no login" });
    }
});

// AUTH
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

// WHATSAPP
let client;
let ready = false;

async function startWhatsApp() {
    client = new Client({
        authStrategy: new LocalAuth({
            dataPath: './session'
        }),
        puppeteer: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        }
    });

    client.on('qr', qr => {
        console.log('📱 ESCANEIE O QR CODE:');
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
        console.log('✅ WhatsApp pronto!');
        ready = true;
    });

    client.on('disconnected', () => {
        console.log('❌ WhatsApp desconectado');
        ready = false;
    });

    await client.initialize();
}

startWhatsApp();

// DISPARO
app.post('/enviar', auth, async (req, res) => {
    if (!ready) {
        return res.status(500).json({ erro: "WhatsApp não conectado" });
    }

    try {
        const { numeros, mensagem } = req.body;

        const lista = numeros.split(',');

        for (let numero of lista) {
            numero = numero.trim();

            if (!numero.includes('@c.us')) {
                numero += '@c.us';
            }

            await client.sendMessage(numero, mensagem);
        }

        res.json({ sucesso: true });

    } catch (err) {
        res.status(500).json({ erro: "Erro envio" });
    }
});

// IA
let IA = "";

app.post('/salvar-ia', auth, (req, res) => {
    IA = req.body.texto;
    res.json({ ok: true });
});

app.get('/carregar-ia', auth, (req, res) => {
    res.json({ texto: IA });
});

// AUTO RESPOSTA
setTimeout(() => {
    if (!client) return;

    client.on('message', msg => {
        if (IA) msg.reply(IA);
    });

}, 15000);

// FRONT
app.use(express.static(path.join(__dirname, 'public')));

// START
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("🚀 Rodando na porta", PORT);
});
