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

// CONFIGURAÇÃO DO DISPARADOR DE E-MAIL (NODEMAILER)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: ADMIN_EMAIL,
        pass: 'mjqi gkyy xkkd srix' // Sua chave de app do Google
    }
});

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
    totalEnviados: { type: Number, default: 0 },
    role: { type: String, default: "user" }
});
const User = mongoose.model("User", UserSchema);

mongoose.connect(MONGO_URI).then(async () => {
    console.log("✅ Conectado ao MongoDB");
    await User.findOneAndUpdate({ email: ADMIN_EMAIL.toLowerCase() }, { role: "admin", ativo: true });
});

const qrcodes = {};
const clientes = {};

// Função para checar acesso (Teste 2h ou Plano Ativo)
function checarAcesso(user) {
    if (user.role === 'admin') return { pode: true };
    const agora = new Date();
    if (user.ativo) {
        if (!user.validade || agora > user.validade) return { pode: false, motivo: 'PLANO_EXPIRADO' };
        return { pode: true };
    }
    const duasHoras = 2 * 60 * 60 * 1000;
    if ((agora - user.dataCadastro) > duasHoras) return { pode: false, motivo: 'TESTE_EXPIRADO' };
    return { pode: true };
}

// Função de E-mail de Ativação
async function enviarEmailAtivacao(user, dias) {
    const dataFim = new Date(user.validade).toLocaleDateString('pt-BR');
    const mailOptions = {
        from: `"Money Partner 🚀" <${ADMIN_EMAIL}>`,
        to: user.email,
        subject: '✅ Sua conta Money Partner foi ATIVADA!',
        html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #22c55e;">Olá, ${user.usuario}!</h2>
                <p>Seu acesso foi liberado com sucesso.</p>
                <p><strong>Detalhes do Plano:</strong></p>
                <ul>
                    <li>Duração: ${dias} Dias</li>
                    <li>Vencimento: <b>${dataFim}</b></li>
                </ul>
                <p>Acesse seu painel e conecte seu WhatsApp agora!</p>
            </div>`
    };
    try { await transporter.sendMail(mailOptions); } catch (e) { console.log("Erro e-mail:", e); }
}

async function initWA(userId) {
    if (clientes[userId]) return;
    const user = await User.findById(userId);
    if (!user || !checarAcesso(user).pode) return;

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: { headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });

    client.on('qr', (qr) => qrcodes[userId] = qr);
    client.on('ready', () => { qrcodes[userId] = "CONECTADO"; });
    client.on('disconnected', () => { delete clientes[userId]; delete qrcodes[userId]; });

    client.on('message', async msg => {
        if (msg.fromMe) return;
        const u = await User.findById(userId);
        if (u && u.iaAtiva && checarAcesso(u).pode) {
            msg.reply(u.ia);
            await User.findByIdAndUpdate(userId, { $inc: { totalEnviados: 1 } });
        }
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
    } catch (e) { res.status(400).json({ error: "E-mail já existe" }); }
});

app.post("/login", async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!user) return res.status(400).json({ error: "Dados incorretos" });
    
    const acesso = checarAcesso(user);
    if (!acesso.pode) return res.status(403).json({ error: acesso.motivo, email: user.email });

    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET);
    initWA(user._id.toString());
    res.json({ token, role: user.role, user });
});

app.post("/admin/liberar-flex", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        if (d.role !== 'admin') return res.status(403).send();
        
        const { id, dias } = req.body;
        let v = new Date(); v.setDate(v.getDate() + parseInt(dias));
        const user = await User.findByIdAndUpdate(id, { ativo: true, validade: v }, { new: true });
        
        enviarEmailAtivacao(user, dias);
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

app.post("/config/ia", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const user = await User.findByIdAndUpdate(d.id, { iaAtiva: req.body.status }, { new: true });
        res.json({ ok: true, status: user.iaAtiva });
    } catch (e) { res.status(401).send(); }
});

app.get("/status-whatsapp", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ status: qrcodes[d.id] || "OFFLINE" });
    } catch (e) { res.status(401).send(); }
});

app.get("/admin/users", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        if (d.role !== 'admin') return res.status(403).send();
        const users = await User.find({}, 'email usuario ativo validade dataCadastro');
        res.json(users);
    } catch (e) { res.status(401).send(); }
});

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Money Partner 2026: Online na porta ${PORT}`));
