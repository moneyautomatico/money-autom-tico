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

// SCHEMA DE USUÁRIO
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    usuario: { type: String, required: true },
    telefone: { type: String, required: true },
    password: { type: String, required: true },
    ia: { type: String, default: "Olá! Recebi sua mensagem." },
    totalEnviados: { type: Number, default: 0 },
    role: { type: String, default: "user" }
});
const User = mongoose.model("User", UserSchema);

// CONEXÃO MONGO E ATIVAÇÃO DO ADMIN
mongoose.connect(MONGO_URI).then(async () => {
    console.log("✅ MongoDB Conectado");
    await User.findOneAndUpdate({ email: ADMIN_EMAIL.toLowerCase() }, { role: "admin" });
});

const qrcodes = {};
const clientes = {};

// INICIALIZADOR DO WHATSAPP
async function initWA(userId) {
    if (clientes[userId]) return;
    console.log(`🤖 Iniciando Zap para: ${userId}`);
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: { 
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
        }
    });

    client.on('qr', (qr) => qrcodes[userId] = qr);
    client.on('ready', () => { qrcodes[userId] = "CONECTADO"; console.log(`✅ Zap Pronto: ${userId}`); });
    
    // Auto-Resposta (IA)
    client.on('message', async msg => {
        if (msg.fromMe) return;
        const user = await User.findById(userId);
        if (user) {
            msg.reply(user.ia);
            await User.findByIdAndUpdate(userId, { $inc: { totalEnviados: 1 } });
        }
    });

    clientes[userId] = client;
    client.initialize().catch(err => console.error("❌ Erro Puppeteer:", err.message));
}

// ROTAS DE AUTENTICAÇÃO
app.post("/register", async (req, res) => {
    try {
        const { email, usuario, telefone, password, confirmPassword } = req.body;
        if (password !== confirmPassword) return res.status(400).json({ error: "Senhas não coincidem" });
        const role = (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) ? "admin" : "user";
        await User.create({ email: email.toLowerCase(), usuario, telefone, password, role });
        res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: "E-mail já cadastrado" }); }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase(), password });
    if (!user) return res.status(400).json({ error: "Dados inválidos" });
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET);
    initWA(user._id.toString());
    res.json({ token, role: user.role });
});

// STATUS E ADMIN
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
        const users = await User.find({}, 'email usuario telefone totalEnviados role');
        res.json(users.map(u => ({ ...u._doc, status: qrcodes[u._id] || "OFFLINE" })));
    } catch (e) { res.status(401).send(); }
});

// ROTA DE DISPARO EM MASSA (NOVA)
app.post("/enviar-massa", async (req, res) => {
    try {
        const decoded = jwt.verify(req.headers.authorization, JWT_SECRET);
        const { lista, mensagem, intervalo } = req.body;
        const cliente = clientes[decoded.id];
        
        if (!cliente || qrcodes[decoded.id] !== "CONECTADO") return res.status(400).json({ error: "Conecte o WhatsApp primeiro!" });

        // Divide a lista por vírgula, espaço ou quebra de linha
        const numeros = lista.split(/[\s,]+/).filter(n => n.trim().length > 8);
        
        // Inicia disparos em background
        dispararProcesso(decoded.id, cliente, numeros, mensagem, intervalo);
        res.json({ ok: true, total: numeros.length });
    } catch (e) { res.status(401).send(); }
});

async function dispararProcesso(userId, cliente, numeros, mensagem, intervalo) {
    for (const num of numeros) {
        try {
            const limpo = num.replace(/\D/g, "") + "@c.us";
            await cliente.sendMessage(limpo, mensagem);
            await User.findByIdAndUpdate(userId, { $inc: { totalEnviados: 1 } });
            await new Promise(r => setTimeout(r, intervalo * 1000));
        } catch (err) { console.log("Erro no envio individual"); }
    }
}

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor voando na porta ${PORT}`));
