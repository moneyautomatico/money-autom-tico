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

const User = mongoose.model("User", new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    usuario: String,
    password: { type: String, required: true },
    role: { type: String, default: "user" },
    ativo: { type: Boolean, default: false },
    validade: { type: Date },
    iaResumo: { type: String, default: "Olá! Como posso ajudar?" }
}));

mongoose.connect(MONGO_URI).then(() => console.log("🚀 Banco Conectado"));

const qrcodes = {};
const clientes = {};

async function engineWA(userId) {
    if (clientes[userId]) return;

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: {
            headless: "new",
            executablePath: process.env.CHROME_PATH || null, // ESSENCIAL PARA O RAILWAY
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        }
    });

    client.on('qr', qr => {
        console.log("QR Code Gerado para:", userId);
        qrcodes[userId] = qr;
    });

    client.on('ready', () => {
        console.log("WhatsApp Pronto:", userId);
        qrcodes[userId] = "READY";
    });

    client.on('message', async msg => {
        if (msg.fromMe) return;
        const u = await User.findById(userId);
        if (u && (u.ativo || u.role === 'admin')) msg.reply(u.iaResumo);
    });

    clientes[userId] = client;
    client.initialize().catch(e => console.log("Erro ao iniciar WA:", e));
}

app.post("/login", async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!u) return res.status(401).send();
    engineWA(u._id.toString()); // Inicia o zap assim que loga
    res.json({ token: jwt.sign({ id: u._id }, JWT_SECRET), user: u });
});

app.get("/sync", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ status: qrcodes[d.id] || "OFF" });
    } catch (e) { res.status(401).send(); }
});

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 8080);
