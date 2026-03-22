const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

const JWT_SECRET = "chave_mestra_2026";
const MONGO_URI = "mongodb+srv://moneyautomatico_db_user:Milionario2026@moneyautomatico.5bbierw.mongodb.net/money?retryWrites=true&w=majority";

const User = mongoose.model("User", new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    iaResumo: { type: String, default: "Olá!" },
    baseAprendizado: { type: String, default: "" },
    msgFollowUp: { type: String, default: "Ainda está por aí?" },
    followUpAtivo: { type: Boolean, default: true },
    delayResponda: { type: Number, default: 3000 }
}));

const Conversas = mongoose.model("Conversas", new mongoose.Schema({
    userId: String,
    contato: String,
    ultimaMensagemDeles: Date,
    respondidoPelaIA: Boolean
}));

mongoose.connect(MONGO_URI).then(() => console.log("🚀 SISTEMA ONLINE"));

const qrcodes = {};
const clientes = {};
const logsChat = {};

// LÓGICA DE FOLLOW-UP (A cada 15 min de silêncio do cliente)
setInterval(async () => {
    const limite = new Date(Date.now() - 15 * 60 * 1000);
    const pendentes = await Conversas.find({ respondidoPelaIA: true, ultimaMensagemDeles: { $lt: limite } });
    for (let conv of pendentes) {
        const u = await User.findById(conv.userId);
        if (u && u.followUpAtivo && clientes[conv.userId]) {
            try {
                await clientes[conv.userId].sendMessage(conv.contato, u.msgFollowUp);
                await Conversas.findByIdAndUpdate(conv._id, { respondidoPelaIA: false });
            } catch (e) {}
        }
    }
}, 60000);

async function engineWA(userId) {
    if (clientes[userId]) return;
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId, dataPath: './session_data' }),
        puppeteer: { headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });

    client.on('qr', qr => { qrcodes[userId] = qr; });
    client.on('ready', () => { qrcodes[userId] = "READY"; });
    client.on('disconnected', () => { qrcodes[userId] = "OFF"; delete clientes[userId]; });

    client.on('message', async msg => {
        // FILTRO DE GRUPOS ATIVADO
        if (msg.fromMe || msg.from.endsWith('@g.us')) return;

        const u = await User.findById(userId);
        if (!u) return;

        // REGISTRO PARA FOLLOW-UP
        await Conversas.findOneAndUpdate(
            { userId, contato: msg.from },
            { ultimaMensagemDeles: new Date(), respondidoPelaIA: true },
            { upsert: true }
        );

        // LÓGICA DE APRENDIZADO REAL
        // A IA usa a saudação + a base de conhecimento que você salvou
        const respostaIA = `${u.iaResumo}\n\n${u.baseAprendizado}`;

        if (!logsChat[userId]) logsChat[userId] = [];
        logsChat[userId].push({ de: msg.from.split('@')[0], txt: msg.body });

        setTimeout(async () => {
            try { await msg.reply(respostaIA); } catch (e) {}
        }, u.delayResponda);
    });

    clientes[userId] = client;
    client.initialize();
}

// ROTA DE DISPARO ATIVADA
app.post("/disparar", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const { numeros, mensagem, intervalo } = req.body;
        const client = clientes[d.id];
        if (!client || qrcodes[d.id] !== "READY") return res.status(400).json({ error: "Conecte o Zap primeiro!" });

        const lista = numeros.split('\n').map(n => n.trim().replace(/\D/g, ''));
        res.json({ msg: "Disparos em fila no servidor!" });

        for (let num of lista) {
            if (num.length < 10) continue;
            await new Promise(r => setTimeout(r, intervalo * 1000));
            try { await client.sendMessage(`${num}@c.us`, mensagem); } catch (e) {}
        }
    } catch (e) { res.status(401).send(); }
});

app.post("/login", async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!u) return res.status(401).send();
    engineWA(u._id.toString());
    res.json({ token: jwt.sign({ id: u._id }, JWT_SECRET), user: u });
});

app.post("/save-config", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        await User.findByIdAndUpdate(d.id, req.body);
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

app.get("/sync", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ status: qrcodes[d.id] || "OFF", chats: logsChat[d.id] || [] });
    } catch (e) { res.status(401).send(); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 8080);
