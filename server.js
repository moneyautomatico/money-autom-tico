const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = "chave_mestra_2026";
const MONGO_URI = "mongodb+srv://moneyautomatico_db_user:Milionario2026@moneyautomatico.5bbierw.mongodb.net/money?retryWrites=true&w=majority";

// SCHEMA COMPLETO - NÃO REMOVER NENHUM CAMPO
const User = mongoose.model("User", new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    usuario: String,
    password: { type: String, required: true },
    role: { type: String, default: "user" },
    ativo: { type: Boolean, default: false },
    botAtivo: { type: Boolean, default: true },
    delayResponda: { type: Number, default: 3000 },
    iaResumo: { type: String, default: "Olá! Sou seu assistente." },
    baseAprendizado: { type: String, default: "" },
    dataCadastro: { type: Date, default: Date.now },
    validade: { type: Date }
}));

mongoose.connect(MONGO_URI).then(() => console.log("🚀 SISTEMA UNIFICADO CONECTADO"));

const qrcodes = {};
const clientes = {};
const logsChat = {};

async function engineWA(userId) {
    if (clientes[userId]) return;
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: {
            headless: "new",
            executablePath: '/usr/bin/google-chrome',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
    });

    client.on('qr', qr => { qrcodes[userId] = qr; });
    client.on('ready', () => { qrcodes[userId] = "READY"; });
    
    client.on('message', async msg => {
        if (msg.fromMe) return;
        const u = await User.findById(userId);
        if (!u || !u.botAtivo) return;

        // LÓGICA DE VISÃO TOTAL (CONTEXTO)
        const chat = await msg.getChat();
        const historico = await chat.fetchMessages({ limit: 15 });
        
        setTimeout(async () => {
            await msg.reply(u.iaResumo);
            if (!logsChat[userId]) logsChat[userId] = [];
            logsChat[userId].push({ de: msg.from.split('@')[0], txt: msg.body });
            if (logsChat[userId].length > 15) logsChat[userId].shift();
        }, u.delayResponda);
    });

    clientes[userId] = client;
    client.initialize().catch(() => {});
}

// ROTA DE DISPARO EM MASSA
app.post("/disparar", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const { numeros, mensagem, intervalo } = req.body;
        const client = clientes[d.id];
        if (!client || qrcodes[d.id] !== "READY") return res.status(400).json({ error: "WhatsApp Desconectado" });

        const lista = numeros.split('\n').map(n => n.trim().replace(/\D/g, ''));
        res.json({ msg: "Disparo iniciado..." });

        for (let num of lista) {
            if (num.length < 10) continue;
            await new Promise(r => setTimeout(r, intervalo * 1000));
            try { await client.sendMessage(`${num}@c.us`, mensagem); } catch (e) {}
        }
    } catch (e) { res.status(401).send(); }
});

// ROTAS DE CONFIGURAÇÃO E SYNC
app.post("/save-config", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        await User.findByIdAndUpdate(d.id, req.body);
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

app.post("/login", async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!u) return res.status(401).send();
    engineWA(u._id.toString());
    res.json({ token: jwt.sign({ id: u._id }, JWT_SECRET), user: u });
});

app.get("/sync", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ status: qrcodes[d.id] || "OFF", chats: logsChat[d.id] || [] });
    } catch (e) { res.status(401).send(); }
});

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 8080);
