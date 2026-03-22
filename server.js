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

// SCHEMA
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    ia: { type: String, default: "Olá! Recebi sua mensagem." },
    totalEnviados: { type: Number, default: 0 },
    role: { type: String, default: "user" }
});
const User = mongoose.model("User", UserSchema);

mongoose.connect(MONGO_URI).then(async () => {
    console.log("✅ MongoDB Conectado");
    await User.findOneAndUpdate({ email: ADMIN_EMAIL }, { role: "admin" });
});

const clientes = {};
const qrcodes = {};

async function initWA(userId) {
    if (clientes[userId]) return;
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: { 
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        }
    });
    client.on('qr', (qr) => qrcodes[userId] = qr);
    client.on('ready', () => qrcodes[userId] = "CONECTADO");
    client.on('message', async msg => {
        if (msg.fromMe) return;
        const user = await User.findById(userId);
        if (user) {
            msg.reply(user.ia);
            await User.findByIdAndUpdate(userId, { $inc: { totalEnviados: 1 } });
        }
    });
    clientes[userId] = client;
    client.initialize().catch(() => {});
}

// ROTAS
app.post("/register", async (req, res) => {
    try {
        const { email, password } = req.body;
        await User.create({ email, password });
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

const checkToken = (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) return res.status(401).send();
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).send();
        req.userId = decoded.id;
        next();
    });
};

app.get("/status-whatsapp", checkToken, (req, res) => res.json({ status: qrcodes[req.userId] || "INICIANDO" }));

app.get("/admin/users", checkToken, async (req, res) => {
    const user = await User.findById(req.userId);
    if (user.role !== 'admin') return res.status(403).send();
    const users = await User.find({}, 'email totalEnviados');
    res.json(users.map(u => ({ ...u._doc, status: qrcodes[u._id] || "OFFLINE" })));
});

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(process.env.PORT || 8080, '0.0.0.0');
