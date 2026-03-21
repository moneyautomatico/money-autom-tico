const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = "money_2026_secret_key";
const MONGO_URI = "mongodb+srv://moneyautomatico_db_user:Milionario2026@moneyautomatico.5bbierw.mongodb.net/money?retryWrites=true&w=majority";
const ADMIN_EMAIL = "tiagoscosta.business@gmail.com";

// Modelo de Usuário
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    ia: { type: String, default: "Olá! Como posso te ajudar?" },
    totalEnviados: { type: Number, default: 0 },
    role: { type: String, default: "user" }
});
const User = mongoose.model("User", UserSchema);

// Conexão MongoDB
mongoose.connect(MONGO_URI).then(async () => {
    console.log("✅ MongoDB Conectado");
    // Garante que seu e-mail seja sempre ADMIN
    await User.findOneAndUpdate({ email: ADMIN_EMAIL }, { role: "admin" });
}).catch(err => console.error("❌ Erro DB:", err));

const clientes = {};
const qrcodes = {};

async function inicializarWhatsapp(userId) {
    if (clientes[userId]) return;
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId, dataPath: './sessions' }),
        puppeteer: { 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
        }
    });

    client.on('qr', (qr) => { qrcodes[userId] = qr; });
    client.on('ready', () => { qrcodes[userId] = "CONECTADO"; });
    client.on('message', async msg => {
        if (msg.fromMe) return;
        const user = await User.findById(userId);
        if (user && user.ia) {
            const chat = await msg.getChat();
            await chat.sendStateTyping();
            setTimeout(async () => { await msg.reply(user.ia); }, 2000);
        }
    });

    clientes[userId] = client;
    client.initialize().catch(() => {});
}

// Rotas de Autenticação
app.post("/register", async (req, res) => {
    try {
        const { email, password } = req.body;
        const exist = await User.findOne({ email: email.toLowerCase() });
        if (exist) return res.status(400).json({ error: "E-mail já cadastrado" });
        await User.create({ email, password });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: "Erro ao criar conta" }); }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase(), password });
    if (!user) return res.status(400).json({ error: "Login inválido" });
    
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET);
    inicializarWhatsapp(user._id.toString());
    res.json({ token, role: user.role });
});

// Middleware de Proteção
const auth = (req, res, next) => {
    try {
        const token = req.headers.authorization;
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch { res.status(401).json({ error: "Sessão expirada" }); }
};

// Rotas de Dados
app.get("/status-whatsapp", auth, (req, res) => res.json({ status: qrcodes[req.userId] || "INICIANDO" }));

app.get("/admin/users", auth, async (req, res) => {
    const admin = await User.findById(req.userId);
    if (admin.role !== 'admin') return res.status(403).json({ error: "Acesso negado" });
    const users = await User.find({}, '-password');
    res.json(users.map(u => ({ ...u._doc, status: qrcodes[u._id] || "OFFLINE" })));
});

// Servir Front-end
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.resolve(__dirname, 'index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor na porta ${PORT}`));
