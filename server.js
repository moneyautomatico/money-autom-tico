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

// SCHEMA COMPLETO COM TODAS AS MELHORIAS
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    usuario: { type: String, required: true },
    telefone: { type: String, required: true },
    password: { type: String, required: true },
    ativo: { type: Boolean, default: false }, // Liberação Vitalícia (R$ 30)
    dataCadastro: { type: Date, default: Date.now }, // Controle do Teste de 2h
    ia: { type: String, default: "Olá! Recebi sua mensagem e logo te respondo." },
    totalEnviados: { type: Number, default: 0 },
    role: { type: String, default: "user" }
});
const User = mongoose.model("User", UserSchema);

mongoose.connect(MONGO_URI).then(async () => {
    console.log("✅ MongoDB Conectado");
    // Garante que o seu e-mail de admin esteja sempre liberado e ativo
    await User.findOneAndUpdate({ email: ADMIN_EMAIL.toLowerCase() }, { role: "admin", ativo: true });
});

const qrcodes = {};
const clientes = {};

// LÓGICA DE TESTE GRÁTIS (2 HORAS)
function checarAcesso(user) {
    if (user.role === 'admin' || user.ativo) return { pode: true };
    const duasHoras = 2 * 60 * 60 * 1000;
    const expirado = (new Date() - user.dataCadastro) > duasHoras;
    return { pode: !expirado, expirado };
}

// INICIALIZADOR WHATSAPP COM FILTROS DE ACESSO
async function initWA(userId) {
    if (clientes[userId]) return;
    const user = await User.findById(userId);
    const acesso = checarAcesso(user);
    if (!acesso.pode) return;

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: { 
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] 
        }
    });

    client.on('qr', (qr) => qrcodes[userId] = qr);
    client.on('ready', () => { qrcodes[userId] = "CONECTADO"; });
    client.on('disconnected', () => { delete clientes[userId]; delete qrcodes[userId]; });

    client.on('message', async msg => {
        if (msg.fromMe) return;
        const u = await User.findById(userId);
        const acc = checarAcesso(u);
        if (u && acc.pode) {
            msg.reply(u.ia);
            await User.findByIdAndUpdate(userId, { $inc: { totalEnviados: 1 } });
        } else {
            client.destroy(); // Desconecta se o tempo acabar durante o uso
        }
    });

    clientes[userId] = client;
    client.initialize().catch(() => {});
}

// ROTAS DE OPERAÇÃO
app.post("/register", async (req, res) => {
    try {
        const { email, usuario, telefone, password, confirmPassword } = req.body;
        if (password !== confirmPassword) return res.status(400).json({ error: "Senhas não conferem" });
        await User.create({ email: email.toLowerCase(), usuario, telefone, password });
        res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: "E-mail já cadastrado" }); }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase(), password });
    if (!user) return res.status(400).json({ error: "Dados inválidos" });
    
    const acesso = checarAcesso(user);
    if (!acesso.pode) return res.status(403).json({ error: "EXPIRADO", email: user.email });

    const token = jwt.sign({ id: user._id, role: user.role, email: user.email }, JWT_SECRET);
    initWA(user._id.toString());
    res.json({ token, role: user.role, dataCadastro: user.dataCadastro, ativo: user.ativo });
});

app.post("/buscar-grupos", async (req, res) => {
    try {
        jwt.verify(req.headers.authorization, JWT_SECRET);
        const { categoria } = req.body;
        const links = [
            { nome: `Grupo de ${categoria} 01`, link: "https://chat.whatsapp.com/L1" },
            { nome: `Networking ${categoria}`, link: "https://chat.whatsapp.com/L2" }
        ];
        res.json({ ok: true, grupos: links });
    } catch (e) { res.status(401).send(); }
});

app.post("/enviar-massa", async (req, res) => {
    try {
        const decoded = jwt.verify(req.headers.authorization, JWT_SECRET);
        const { lista, mensagem, intervalo } = req.body;
        const cliente = clientes[decoded.id];
        if (!cliente || qrcodes[decoded.id] !== "CONECTADO") return res.status(400).json({ error: "WhatsApp Desconectado" });

        const numeros = lista.split(/[\s,]+/).filter(n => n.trim().length > 8);
        res.json({ ok: true, total: numeros.length });

        for (const num of numeros) {
            try {
                const clean = num.replace(/\D/g, "");
                const id = await cliente.getNumberId(clean); // FILTRO DE NÚMERO VÁLIDO
                if (id) {
                    await cliente.sendMessage(id._serialized, mensagem);
                    await User.findByIdAndUpdate(decoded.id, { $inc: { totalEnviados: 1 } });
                }
                await new Promise(r => setTimeout(r, (intervalo || 15) * 1000));
            } catch (err) { console.log("Erro no envio"); }
        }
    } catch (e) { res.status(401).send(); }
});

app.get("/status-whatsapp", async (req, res) => {
    try {
        const decoded = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ status: qrcodes[decoded.id] || "INICIANDO" });
    } catch (e) { res.status(401).send(); }
});

// ADMIN: ATIVAÇÃO MANUAL
app.get("/admin/users", async (req, res) => {
    try {
        const decoded = jwt.verify(req.headers.authorization, JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).send();
        const users = await User.find({}, 'email usuario ativo totalEnviados dataCadastro');
        res.json(users);
    } catch (e) { res.status(401).send(); }
});

app.post("/admin/toggle", async (req, res) => {
    try {
        const decoded = jwt.verify(req.headers.authorization, JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).send();
        await User.findByIdAndUpdate(req.body.id, { ativo: req.body.status });
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(8080, '0.0.0.0', () => console.log(`🚀 Money Partner: Versão Final On!`));
