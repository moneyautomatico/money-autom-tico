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
    service: 'gmail', auth: { user: ADMIN_EMAIL, pass: 'mjqi gkyy xkkd srix' }
});

const User = mongoose.model("User", new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    usuario: { type: String, required: true },
    telefone: { type: String, required: true },
    password: { type: String, required: true },
    ativo: { type: Boolean, default: false },
    iaAtiva: { type: Boolean, default: true },
    dataCadastro: { type: Date, default: Date.now },
    validade: { type: Date },
    ia: { type: String, default: "Olá! Recebi sua mensagem." },
    role: { type: String, default: "user" }
}));

const Ticket = mongoose.model("Ticket", new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId, userName: String, assunto: String, mensagem: String, resposta: { type: String, default: "" }, status: { type: String, default: "Aberto" }, data: { type: Date, default: Date.now }
}));

mongoose.connect(MONGO_URI).then(async () => {
    console.log("🚀 Sistema Online");
    await User.findOneAndUpdate({ email: ADMIN_EMAIL.toLowerCase() }, { role: "admin", ativo: true });
});

const qrcodes = {};
const clientes = {};

async function initWA(userId) {
    if (clientes[userId]) return;
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: { headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });
    client.on('qr', qr => qrcodes[userId] = qr);
    client.on('ready', () => { qrcodes[userId] = "CONECTADO"; });
    client.on('disconnected', () => { delete qrcodes[userId]; delete clientes[userId]; });
    client.on('message', async msg => {
        if (msg.fromMe) return;
        const u = await User.findById(userId);
        if (u && u.iaAtiva && (u.role === 'admin' || (u.ativo && new Date() < u.validade) || (new Date() - u.dataCadastro < 7200000))) {
            msg.reply(u.ia);
        }
    });
    clientes[userId] = client;
    client.initialize().catch(() => {});
}

app.post("/register", async (req, res) => {
    try { await User.create({...req.body, email: req.body.email.toLowerCase()}); res.json({ok:true}); } catch(e) { res.status(400).json({error:"E-mail já existe"}); }
});

app.post("/login", async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!user) return res.status(400).json({ error: "Dados incorretos" });
    initWA(user._id.toString());
    res.json({ token: jwt.sign({ id: user._id, role: user.role }, JWT_SECRET), user });
});

app.get("/status-whatsapp", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ status: qrcodes[d.id] || "OFFLINE" });
    } catch (e) { res.status(401).send(); }
});

app.get("/admin/dados", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        if (d.role !== 'admin') return res.status(403).send();
        const users = await User.find({});
        const tickets = await Ticket.find({ status: { $ne: "Fechado" } });
        res.json({ users, tickets });
    } catch (e) { res.status(401).send(); }
});

app.post("/admin/liberar-flex", async (req, res) => {
    const v = new Date(); v.setDate(v.getDate() + parseInt(req.body.dias));
    await User.findByIdAndUpdate(req.body.id, { ativo: true, validade: v });
    res.json({ ok: true });
});

app.post("/tickets/novo", async (req, res) => {
    const d = jwt.verify(req.headers.authorization, JWT_SECRET);
    const u = await User.findById(d.id);
    await Ticket.create({ userId: u._id, userName: u.usuario, ...req.body });
    res.json({ ok: true });
});

app.get("/tickets/meus", async (req, res) => {
    const d = jwt.verify(req.headers.authorization, JWT_SECRET);
    res.json(await Ticket.find({ userId: d.id }).sort({ data: -1 }));
});

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(8080, '0.0.0.0');
