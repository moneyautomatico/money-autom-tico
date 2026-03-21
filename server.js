const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path'); 
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = "money_automatico_super_2026";
const MONGO_URI = "mongodb+srv://moneyautomatico_db_user:Milionario2026@moneyautomatico.5bbierw.mongodb.net/money?retryWrites=true&w=majority";
const EMAIL_ADMIN = "tiagoscosta.business@gmail.com";

// Schema com Role (Papel do usuário)
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    ia: { type: String, default: "Olá! Como posso te ajudar?" },
    totalEnviados: { type: Number, default: 0 },
    role: { type: String, default: "user" } // 'user' ou 'admin'
});
const User = mongoose.model("User", UserSchema);

mongoose.connect(MONGO_URI).then(async () => {
    console.log("✅ DB Conectado");
    // Garante que o seu e-mail sempre seja ADMIN
    await User.findOneAndUpdate({ email: EMAIL_ADMIN }, { role: "admin" });
});

const clientes = {}; 
const qrcodes = {}; 
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function inicializarWhatsapp(userId) {
    if (clientes[userId]) return; 
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId, dataPath: './sessions' }),
        puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });
    client.on('qr', (qr) => { qrcodes[userId] = qr; });
    client.on('ready', () => { qrcodes[userId] = "CONECTADO"; });
    client.on('message', async msg => {
        if (msg.fromMe) return;
        const user = await User.findById(userId);
        if (user && user.ia) {
            const chat = await msg.getChat();
            await chat.sendStateTyping();
            await sleep(2000);
            await msg.reply(user.ia);
            await User.findByIdAndUpdate(userId, { $inc: { totalEnviados: 1 } });
        }
    });
    clientes[userId] = client;
    client.initialize().catch(() => {});
}

// Middlewares
function auth(req, res, next) {
    try {
        const token = req.headers.authorization;
        req.userId = jwt.verify(token, JWT_SECRET).id;
        next();
    } catch { res.status(401).json({ error: "Sessão expirada" }); }
}

async function adminOnly(req, res, next) {
    const user = await User.findById(req.userId);
    if (user && user.role === "admin") next();
    else res.status(403).json({ error: "Acesso negado" });
}

// --- ROTAS ADMIN ---
app.get("/admin/users", auth, adminOnly, async (req, res) => {
    const users = await User.find({}, '-password');
    const data = users.map(u => ({
        ...u._doc,
        status: qrcodes[u._id] || "OFFLINE"
    }));
    res.json(data);
});

app.post("/admin/edit-user", auth, adminOnly, async (req, res) => {
    const { id, email, ia } = req.body;
    await User.findByIdAndUpdate(id, { email, ia });
    res.json({ ok: true });
});

// --- ROTAS PADRÃO ---
app.post("/register", async (req, res) => {
    const { email, password } = req.body;
    if(await User.findOne({ email })) return res.status(400).json({ error: "E-mail já existe" });
    await User.create({ email, password });
    res.json({ ok: true });
});

app.post("/login", async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!user) return res.status(400).json({ error: "Incorreto" });
    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    inicializarWhatsapp(user._id.toString());
    res.json({ token, role: user.role });
});

app.get("/status-whatsapp", auth, (req, res) => res.json({ status: qrcodes[req.userId] || "INICIANDO" }));

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.resolve(__dirname, 'index.html')));

app.listen(8080, '0.0.0.0', () => console.log("🚀 Multi-User Master Online"));
