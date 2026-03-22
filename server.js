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
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    usuario: { type: String, required: true },
    telefone: { type: String, required: true },
    password: { type: String, required: true },
    ativo: { type: Boolean, default: false },
    iaAtiva: { type: Boolean, default: true },
    dataCadastro: { type: Date, default: Date.now },
    validade: { type: Date },
    ia: { type: String, default: "Olá! Recebi sua mensagem e logo te respondo." },
    role: { type: String, default: "user" }
});
const User = mongoose.model("User", UserSchema);

const TicketSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    assunto: String,
    mensagem: String,
    resposta: { type: String, default: "" },
    status: { type: String, default: "Aberto" },
    data: { type: Date, default: Date.now }
});
const Ticket = mongoose.model("Ticket", TicketSchema);

mongoose.connect(MONGO_URI).then(async () => {
    console.log("✅ Sistema Online");
    await User.findOneAndUpdate({ email: ADMIN_EMAIL.toLowerCase() }, { role: "admin", ativo: true });
});

const qrcodes = {};
const clientes = {};

// FUNÇÕES AUXILIARES
function checarAcesso(user) {
    if (user.role === 'admin') return { pode: true };
    const agora = new Date();
    if (user.ativo) {
        if (!user.validade || agora > user.validade) return { pode: false, motivo: 'PLANO_EXPIRADO' };
        return { pode: true };
    }
    if ((agora - user.dataCadastro) > (2 * 60 * 60 * 1000)) return { pode: false, motivo: 'TESTE_EXPIRADO' };
    return { pode: true };
}

async function enviarEmailAtivacao(user, dias) {
    const dataFim = new Date(user.validade).toLocaleDateString('pt-BR');
    const mailOptions = {
        from: `"Money Partner 🚀" <${ADMIN_EMAIL}>`,
        to: user.email,
        subject: '✅ Sua conta foi ativada!',
        html: `<div style="font-family:sans-serif;"><h2>Olá, ${user.usuario}!</h2><p>Sua licença de <b>${dias} dias</b> está ativa até <b>${dataFim}</b>.</p></div>`
    };
    try { await transporter.sendMail(mailOptions); } catch (e) { console.log(e); }
}

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
        if (u && u.iaAtiva && checarAcesso(u).pode) msg.reply(u.ia);
    });
    clientes[userId] = client;
    client.initialize().catch(() => {});
}

// ROTAS
app.post("/register", async (req, res) => {
    try {
        const { email, usuario, telefone, password } = req.body;
        await User.create({ email: email.toLowerCase(), usuario, telefone, password });
        res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: "E-mail já cadastrado" }); }
});

app.post("/login", async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!user) return res.status(400).json({ error: "Credenciais inválidas" });
    const acc = checarAcesso(user);
    if (!acc.pode) return res.status(403).json({ error: acc.motivo });
    initWA(user._id.toString());
    res.json({ token: jwt.sign({ id: user._id, role: user.role }, JWT_SECRET), user });
});

app.get("/status-whatsapp", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ status: qrcodes[d.id] || "OFFLINE" });
    } catch (e) { res.status(401).send(); }
});

app.post("/admin/liberar-flex", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        if (d.role !== 'admin') return res.status(403).send();
        const v = new Date(); v.setDate(v.getDate() + parseInt(req.body.dias));
        const user = await User.findByIdAndUpdate(req.body.id, { ativo: true, validade: v }, { new: true });
        enviarEmailAtivacao(user, req.body.dias);
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

// ROTAS DE TICKETS
app.post("/tickets/novo", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const u = await User.findById(d.id);
        await Ticket.create({ userId: u._id, userName: u.usuario, assunto: req.body.assunto, mensagem: req.body.mensagem });
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

app.get("/tickets/meus", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const tks = await Ticket.find({ userId: d.id }).sort({ data: -1 });
        res.json(tks);
    } catch (e) { res.status(401).send(); }
});

app.get("/admin/dados", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        if (d.role !== 'admin') return res.status(403).send();
        const users = await User.find({}, 'usuario email ativo validade');
        const tickets = await Ticket.find({ status: { $ne: "Fechado" } });
        res.json({ users, tickets });
    } catch (e) { res.status(401).send(); }
});

app.post("/admin/tickets/responder", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        if (d.role !== 'admin') return res.status(403).send();
        await Ticket.findByIdAndUpdate(req.body.id, { resposta: req.body.resposta, status: "Respondido" });
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(8080, '0.0.0.0');
