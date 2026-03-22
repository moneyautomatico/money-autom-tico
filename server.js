const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const nodemailer = require('nodemailer');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = "chave_mestra_2026";
const MONGO_URI = "mongodb+srv://moneyautomatico_db_user:Milionario2026@moneyautomatico.5bbierw.mongodb.net/money?retryWrites=true&w=majority";
const ADMIN_EMAIL = "tiagoscosta.business@gmail.com";

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: ADMIN_EMAIL, pass: 'mjqi gkyy xkkd srix' }
});

// MODELS
const User = mongoose.model("User", new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    usuario: String,
    telefone: String,
    password: { type: String, required: true },
    ativo: { type: Boolean, default: false },
    iaAtiva: { type: Boolean, default: true },
    dataCadastro: { type: Date, default: Date.now },
    validade: { type: Date },
    iaResumo: { type: String, default: "Olá! Como posso te ajudar hoje?" },
    role: { type: String, default: "user" }
}));

const Ticket = mongoose.model("Ticket", new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    userName: String,
    assunto: String,
    mensagem: String,
    resposta: { type: String, default: "" },
    status: { type: String, default: "Aberto" },
    data: { type: Date, default: Date.now }
}));

mongoose.connect(MONGO_URI).then(async () => {
    console.log("✅ MongoDB Conectado");
    await User.findOneAndUpdate({ email: ADMIN_EMAIL.toLowerCase() }, { role: "admin", ativo: true });
});

const qrcodes = {};
const clientes = {};
const logsConversa = {};

// WHATSAPP ENGINE
async function initWA(userId) {
    if (clientes[userId]) return;
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: { headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });

    client.on('qr', qr => qrcodes[userId] = qr);
    client.on('ready', () => qrcodes[userId] = "CONECTADO");
    client.on('message', async msg => {
        if (msg.fromMe) return;
        const u = await User.findById(userId);
        if (!u || !u.iaAtiva) return;

        // Log para o Monitor
        if (!logsConversa[userId]) logsConversa[userId] = [];
        logsConversa[userId].push({ de: msg.from.split('@')[0], texto: msg.body });

        // Resposta baseada no treino
        msg.reply(u.iaResumo);
        logsConversa[userId].push({ de: "IA", texto: u.iaResumo });
    });

    clientes[userId] = client;
    client.initialize().catch(() => {});
}

// ROTAS
app.post("/register", async (req, res) => {
    try {
        await User.create({ ...req.body, email: req.body.email.toLowerCase() });
        res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: "E-mail já cadastrado." }); }
});

app.post("/login", async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!user) return res.status(401).json({ error: "Dados incorretos." });
    initWA(user._id.toString());
    res.json({ token: jwt.sign({ id: user._id, role: user.role }, JWT_SECRET), user });
});

app.get("/status-wa", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ status: qrcodes[d.id] || "OFFLINE", conversas: logsConversa[d.id] || [] });
    } catch (e) { res.status(401).send(); }
});

app.post("/admin/liberar", async (req, res) => {
    const v = new Date(); v.setDate(v.getDate() + parseInt(req.body.dias));
    await User.findByIdAndUpdate(req.body.id, { ativo: true, validade: v });
    res.json({ ok: true });
});

app.post("/user/treinar", async (req, res) => {
    const d = jwt.verify(req.headers.authorization, JWT_SECRET);
    await User.findByIdAndUpdate(d.id, { iaResumo: req.body.instrucao });
    res.json({ ok: true });
});

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(8080, '0.0.0.0');
