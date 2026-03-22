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

// SCHEMA COMPLETO
const User = mongoose.model("User", new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    usuario: String,
    telefone: String,
    password: { type: String, required: true },
    ativo: { type: Boolean, default: false },
    role: { type: String, default: "user" },
    dataCadastro: { type: Date, default: Date.now },
    validade: { type: Date },
    iaResumo: { type: String, default: "Olá! Sou seu assistente virtual de vendas." }
}));

mongoose.connect(MONGO_URI).then(async () => {
    console.log("🚀 Banco de Dados Conectado");
    await User.findOneAndUpdate({ email: ADMIN_EMAIL }, { role: "admin", ativo: true });
});

const qrcodes = {};
const clientes = {};
const logsConversa = {};

// WHATSAPP COM PERSISTÊNCIA E MONITOR
async function startWA(userId) {
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
        if (!u) return;

        // REGRA DE ACESSO: Admin sempre ativo. Cliente só se estiver ativo OU dentro das 2h de teste.
        const agora = new Date();
        const tempoTeste = (agora - u.dataCadastro) < (2 * 60 * 60 * 1000); // 2 horas
        const planoValido = u.validade && agora < u.validade;

        if (u.role === 'admin' || u.ativo || tempoTeste || planoValido) {
            // Log para o Painel Flutuante
            if (!logsConversa[userId]) logsConversa[userId] = [];
            logsConversa[userId].push({ de: msg.from.split('@')[0], txt: msg.body, hora: agora.toLocaleTimeString() });
            if (logsConversa[userId].length > 20) logsConversa[userId].shift();

            // Resposta da IA treinada
            msg.reply(u.iaResumo);
            logsConversa[userId].push({ de: "IA", txt: u.iaResumo, hora: agora.toLocaleTimeString() });
        }
    });

    clientes[userId] = client;
    client.initialize().catch(() => {});
}

// ROTAS DE SISTEMA
app.post("/login", async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!user) return res.status(401).json({ error: "Credenciais incorretas" });
    startWA(user._id.toString());
    res.json({ token: jwt.sign({ id: user._id, role: user.role }, JWT_SECRET), user });
});

app.get("/status-full", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ status: qrcodes[d.id] || "OFFLINE", logs: logsConversa[d.id] || [] });
    } catch (e) { res.status(401).send(); }
});

app.post("/admin/liberar", async (req, res) => {
    const { id, dias } = req.body;
    const v = new Date(); v.setDate(v.getDate() + parseInt(dias));
    await User.findByIdAndUpdate(id, { ativo: true, validade: v });
    res.json({ ok: true });
});

app.post("/user/treinar", async (req, res) => {
    const d = jwt.verify(req.headers.authorization, JWT_SECRET);
    await User.findByIdAndUpdate(d.id, { iaResumo: req.body.texto });
    res.json({ ok: true });
});

app.get("/admin/usuarios", async (req, res) => {
    const users = await User.find({});
    res.json(users);
});

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(8080, '0.0.0.0');
