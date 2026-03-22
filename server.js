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

const User = mongoose.model("User", new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    usuario: String,
    password: { type: String, required: true },
    role: { type: String, default: "user" },
    ativo: { type: Boolean, default: false },
    botAtivo: { type: Boolean, default: true },      // Botão On/Off
    delayResponda: { type: Number, default: 3000 },  // Tempo de envio
    dataCadastro: { type: Date, default: Date.now },
    validade: { type: Date },
    iaResumo: { type: String, default: "Olá! Sou sua IA de vendas." }
}));

mongoose.connect(MONGO_URI).then(async () => {
    console.log("🚀 BANCO CONECTADO");
    await User.findOneAndUpdate({ email: ADMIN_EMAIL }, { role: "admin", ativo: true });
});

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

        const agora = new Date();
        const emTeste = (agora - u.dataCadastro) < (2 * 60 * 60 * 1000);
        const planoValido = u.validade && agora < u.validade;

        if (u.role === 'admin' || u.ativo || emTeste || planoValido) {
            // TEMPO DE ENVIO (DELAY) IMPLEMENTADO
            setTimeout(async () => {
                await msg.reply(u.iaResumo);
                if (!logsChat[userId]) logsChat[userId] = [];
                logsChat[userId].push({ de: msg.from.split('@')[0], txt: msg.body });
                logsChat[userId].push({ de: "IA", txt: u.iaResumo });
                if (logsChat[userId].length > 20) logsChat[userId].shift();
            }, u.delayResponda);
        }
    });

    clientes[userId] = client;
    client.initialize().catch(() => {});
}

app.post("/login", async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!u) return res.status(401).send();
    engineWA(u._id.toString());
    res.json({ token: jwt.sign({ id: u._id, role: u.role }, JWT_SECRET), user: u });
});

app.get("/sync", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ status: qrcodes[d.id] || "OFF", chats: logsChat[d.id] || [] });
    } catch (e) { res.status(401).send(); }
});

app.post("/update-settings", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        await User.findByIdAndUpdate(d.id, { 
            iaResumo: req.body.txt, 
            botAtivo: req.body.botAtivo, 
            delayResponda: req.body.delay 
        });
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

app.get("/admin/users", async (req, res) => {
    const users = await User.find({});
    res.json(users);
});

app.post("/admin/liberar", async (req, res) => {
    const { id, dias } = req.body;
    const v = new Date(); v.setDate(v.getDate() + parseInt(dias));
    await User.findByIdAndUpdate(id, { ativo: true, validade: v });
    res.json({ ok: true });
});

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 8080);
