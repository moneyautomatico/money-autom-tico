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

// SCHEMA COM DATA DE CADASTRO
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    usuario: { type: String, required: true },
    telefone: { type: String, required: true },
    password: { type: String, required: true },
    ativo: { type: Boolean, default: false }, // Ativo = Pagou R$ 30
    dataCadastro: { type: Date, default: Date.now }, // Para o Teste Grátis
    totalEnviados: { type: Number, default: 0 },
    role: { type: String, default: "user" }
});
const User = mongoose.model("User", UserSchema);

mongoose.connect(MONGO_URI).then(async () => {
    console.log("✅ MongoDB Conectado");
    await User.findOneAndUpdate({ email: ADMIN_EMAIL.toLowerCase() }, { role: "admin", ativo: true });
});

const qrcodes = {};
const clientes = {};

// FUNÇÃO PARA CHECAR SE O TESTE EXPIROU (2 HORAS)
function testeExpirado(user) {
    if (user.ativo || user.role === 'admin') return false;
    const duasHorasEmMs = 2 * 60 * 60 * 1000;
    const agora = new Date();
    return (agora - user.dataCadastro) > duasHorasEmMs;
}

async function initWA(userId) {
    const user = await User.findById(userId);
    if (!user || testeExpirado(user) || clientes[userId]) return;

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: { 
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        }
    });

    client.on('qr', (qr) => qrcodes[userId] = qr);
    client.on('ready', () => { qrcodes[userId] = "CONECTADO"; });
    client.on('disconnected', () => { delete clientes[userId]; delete qrcodes[userId]; });

    client.on('message', async msg => {
        if (msg.fromMe) return;
        const u = await User.findById(userId);
        // Se expirar enquanto o robô está ligado, ele para de responder
        if (u && !testeExpirado(u)) {
            msg.reply(u.ia || "Olá! Este é um teste do Money Partner.");
            await User.findByIdAndUpdate(userId, { $inc: { totalEnviados: 1 } });
        }
    });

    clientes[userId] = client;
    client.initialize().catch(() => {});
}

app.post("/register", async (req, res) => {
    try {
        const { email, usuario, telefone, password, confirmPassword } = req.body;
        if (password !== confirmPassword) return res.status(400).json({ error: "Senhas não coincidem" });
        await User.create({ email: email.toLowerCase(), usuario, telefone, password });
        res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: "E-mail já cadastrado" }); }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase(), password });
    if (!user) return res.status(400).json({ error: "Dados incorretos" });
    
    // VERIFICAÇÃO DE TESTE GRÁTIS
    if (testeExpirado(user)) {
        return res.status(403).json({ error: "EXPIRADO", email: user.email });
    }
    
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET);
    initWA(user._id.toString());
    res.json({ token, role: user.role, expiracao: user.dataCadastro });
});

app.post("/admin/toggle-user", async (req, res) => {
    try {
        const decoded = jwt.verify(req.headers.authorization, JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).send();
        const { targetId, status } = req.body;
        await User.findByIdAndUpdate(targetId, { ativo: status });
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

app.get("/status-whatsapp", async (req, res) => {
    try {
        const decoded = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ status: qrcodes[decoded.id] || "INICIANDO" });
    } catch (e) { res.status(401).send(); }
});

app.get("/admin/users", async (req, res) => {
    try {
        const decoded = jwt.verify(req.headers.authorization, JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).send();
        const users = await User.find({}, 'email usuario telefone totalEnviados role ativo dataCadastro');
        res.json(users);
    } catch (e) { res.status(401).send(); }
});

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Money Partner: Teste de 2h Ativado!`));
