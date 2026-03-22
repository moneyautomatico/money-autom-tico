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
    email: { type: String, required: true, unique: true },
    usuario: String,
    password: { type: String, required: true },
    iaResumo: { type: String, default: "Olá! Como posso ajudar?" }
}));

mongoose.connect(MONGO_URI).then(() => console.log("✅ MongoDB Conectado"));

const qrcodes = {};
const clientes = {};

async function initWA(userId) {
    if (clientes[userId]) return;
    
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: { 
            headless: "new", 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-extensions'] 
        }
    });

    client.on('qr', qr => {
        qrcodes[userId] = qr;
        console.log(`[QR] Novo código gerado para: ${userId}`);
    });

    client.on('ready', () => {
        qrcodes[userId] = "CONECTADO";
        console.log(`[WA] Cliente ${userId} pronto!`);
    });

    client.on('disconnected', () => {
        delete qrcodes[userId];
        delete clientes[userId];
    });

    clientes[userId] = client;
    client.initialize().catch(err => console.error("Erro WA:", err));
}

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase(), password });
    if (!user) return res.status(401).json({ error: "Credenciais inválidas" });
    
    initWA(user._id.toString());
    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    res.json({ token, user });
});

app.get("/status-wa", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const decoded = jwt.verify(authHeader, JWT_SECRET);
        res.json({ status: qrcodes[decoded.id] || "AGUARDANDO" });
    } catch (e) { res.status(401).send(); }
});

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(8080, '0.0.0.0', () => console.log("🚀 Servidor em 8080"));
