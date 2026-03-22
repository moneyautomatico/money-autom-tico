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
const ADMIN_EMAIL = "tiagoscosta.business@gmail.com";

// MODELO DE USUÁRIO
const User = mongoose.model("User", new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    usuario: String,
    password: { type: String, required: true },
    role: { type: String, default: "user" },
    ativo: { type: Boolean, default: false },
    validade: { type: Date },
    iaResumo: { type: String, default: "Olá! Como posso ajudar?" }
}));

mongoose.connect(MONGO_URI).then(async () => {
    console.log("🚀 Banco Conectado");
    await User.findOneAndUpdate({ email: ADMIN_EMAIL }, { role: "admin", ativo: true });
});

const qrcodes = {};
const clientes = {};
const logsChat = {};

async function engineWA(userId) {
    if (clientes[userId]) return;
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: { headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });

    client.on('qr', qr => {
        qrcodes[userId] = qr; // Armazena o código para o front-end
    });

    client.on('ready', () => {
        qrcodes[userId] = "READY";
        console.log(`WhatsApp Pronto: ${userId}`);
    });

    client.on('message', async msg => {
        if (msg.fromMe) return;
        const u = await User.findById(userId);
        if (!u || (!u.ativo && u.role !== 'admin')) return;

        if (!logsChat[userId]) logsChat[userId] = [];
        logsChat[userId].push({ de: msg.from.split('@')[0], txt: msg.body, hora: new Date().toLocaleTimeString() });
        
        msg.reply(u.iaResumo);
        logsChat[userId].push({ de: "IA", txt: u.iaResumo, hora: new Date().toLocaleTimeString() });
        if (logsChat[userId].length > 15) logsChat[userId].shift();
    });

    clientes[userId] = client;
    client.initialize().catch(() => {});
}

// ROTAS
app.post("/login", async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!u) return res.status(401).json({ error: "Erro" });
    engineWA(u._id.toString());
    res.json({ token: jwt.sign({ id: u._id, role: u.role }, JWT_SECRET), user: u });
});

app.get("/sync", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ 
            status: qrcodes[d.id] || "OFF", 
            chats: logsChat[d.id] || [] 
        });
    } catch (e) { res.status(401).send(); }
});

app.post("/set-ia", async (req, res) => {
    const d = jwt.verify(req.headers.authorization, JWT_SECRET);
    await User.findByIdAndUpdate(d.id, { iaResumo: req.body.txt });
    res.json({ ok: true });
});

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(8080, '0.0.0.0');
