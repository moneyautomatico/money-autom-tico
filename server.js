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

// SCHEMAS
const UserSchema = new mongoose.Schema({
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
});
const User = mongoose.model("User", UserSchema);

const TicketSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    assunto: String,
    mensagem: String,
    resposta: { type: String, default: "" },
    status: { type: String, default: "Aberto" }, // Aberto, Respondido, Fechado
    data: { type: Date, default: Date.now }
});
const Ticket = mongoose.model("Ticket", TicketSchema);

mongoose.connect(MONGO_URI).then(async () => {
    console.log("✅ Sistema de Tickets Online");
    await User.findOneAndUpdate({ email: ADMIN_EMAIL.toLowerCase() }, { role: "admin", ativo: true });
});

const qrcodes = {};
const clientes = {};

// --- ROTAS DE TICKETS ---

// Usuário cria ticket
app.post("/tickets/novo", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const u = await User.findById(d.id);
        const ticket = await Ticket.create({
            userId: u._id,
            userName: u.usuario,
            assunto: req.body.assunto,
            mensagem: req.body.mensagem
        });
        res.json({ ok: true, ticket });
    } catch (e) { res.status(401).send(); }
});

// Usuário vê seus tickets
app.get("/tickets/meus", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const tks = await Ticket.find({ userId: d.id }).sort({ data: -1 });
        res.json(tks);
    } catch (e) { res.status(401).send(); }
});

// Admin vê todos os tickets abertos
app.get("/admin/tickets", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        if (d.role !== 'admin') return res.status(403).send();
        const tks = await Ticket.find({ status: { $ne: "Fechado" } }).sort({ data: 1 });
        res.json(tks);
    } catch (e) { res.status(401).send(); }
});

// Admin responde ticket
app.post("/admin/tickets/responder", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        if (d.role !== 'admin') return res.status(403).send();
        await Ticket.findByIdAndUpdate(req.body.id, { 
            resposta: req.body.resposta, 
            status: "Respondido" 
        });
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

// --- RESTANTE DAS ROTAS (Login, Ativação, WA) ---
// [Mantenha as rotas de login, liberar-flex e initWA do código anterior]
app.post("/login", async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!user) return res.status(400).json({ error: "Dados incorretos" });
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET);
    initWA(user._id.toString());
    res.json({ token, role: user.role, user });
});

app.post("/admin/liberar-flex", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        if (d.role !== 'admin') return res.status(403).send();
        const v = new Date(); v.setDate(v.getDate() + parseInt(req.body.dias));
        const user = await User.findByIdAndUpdate(req.body.id, { ativo: true, validade: v }, { new: true });
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

app.use(express.static(__dirname));
app.listen(8080, '0.0.0.0', () => console.log("🚀 Server com Tickets ON"));
