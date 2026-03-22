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

const User = mongoose.model("User", new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    usuario: String,
    password: String,
    ativo: { type: Boolean, default: false },
    iaAtiva: { type: Boolean, default: true },
    iaTreino: { type: Array, default: [] }, // Histórico para treinamento
    iaResumo: { type: String, default: "Olá! Sou o assistente inteligente." }
}));

mongoose.connect(MONGO_URI);

const qrcodes = {};
const clientes = {};
const logsConversa = {}; // Armazena mensagens temporárias para o painel

async function initWA(userId) {
    if (clientes[userId]) return;
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: { headless: "new", args: ['--no-sandbox'] }
    });

    client.on('qr', qr => qrcodes[userId] = qr);
    client.on('ready', () => qrcodes[userId] = "CONECTADO");
    
    client.on('message', async msg => {
        if (msg.fromMe) return;
        const u = await User.findById(userId);
        if (!u || !u.iaAtiva) return;

        // Lógica de Monitoramento (Envia para o Painel)
        if (!logsConversa[userId]) logsConversa[userId] = [];
        logsConversa[userId].push({ de: msg.from, texto: msg.body, data: new Date() });

        // Resposta da IA (Baseada no treino/resumo)
        msg.reply(u.iaResumo);
        logsConversa[userId].push({ de: "SISTEMA", texto: u.iaResumo, data: new Date() });
    });

    clientes[userId] = client;
    client.initialize().catch(() => {});
}

// ROTA DE STATUS E MONITOR
app.get("/monitor-wa", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ 
            status: qrcodes[d.id] || "OFFLINE",
            conversas: logsConversa[d.id] || [] 
        });
    } catch (e) { res.status(401).send(); }
});

app.post("/login", async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!user) return res.status(400).send();
    initWA(user._id.toString());
    res.json({ token: jwt.sign({ id: user._id }, JWT_SECRET), user });
});

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(8080, '0.0.0.0');
