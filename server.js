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

// Database Schema
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    ia: { type: String, default: "Olá! Como posso te ajudar?" },
    totalEnviados: { type: Number, default: 0 }
});
const User = mongoose.model("User", UserSchema);

mongoose.connect(MONGO_URI).then(() => console.log("✅ DB Multi-User Conectado"));

const clientes = {}; 
const qrcodes = {}; 

// Função para simular atraso humano
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function inicializarWhatsapp(userId) {
    if (clientes[userId]) return; 

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId, dataPath: './sessions' }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process', '--disable-gpu']
        }
    });

    client.on('qr', (qr) => { qrcodes[userId] = qr; });
    client.on('ready', () => { qrcodes[userId] = "CONECTADO"; });
    client.on('disconnected', () => { qrcodes[userId] = ""; delete clientes[userId]; });

    // IA Humanizada: Digitando... + Delay
    client.on('message', async msg => {
        if (msg.fromMe) return;
        const user = await User.findById(userId);
        if (user && user.ia) {
            const chat = await msg.getChat();
            await chat.sendStateTyping(); // Mostra "Digitando..."
            await sleep(3000); // Espera 3 segundos
            await msg.reply(user.ia);
            await User.findByIdAndUpdate(userId, { $inc: { totalEnviados: 1 } });
        }
    });

    clientes[userId] = client;
    client.initialize().catch(() => {});
}

// Rotas de Autenticação
app.post("/register", async (req, res) => {
    try {
        const { email, password } = req.body;
        if(await User.findOne({ email })) return res.status(400).json({ error: "E-mail já existe" });
        await User.create({ email, password });
        res.json({ ok: true, msg: "Conta criada! Faça login." });
    } catch { res.status(500).json({ error: "Erro no cadastro" }); }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase().trim(), password });
    if (!user) return res.status(400).json({ error: "Dados incorretos" });

    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    inicializarWhatsapp(user._id.toString());
    res.json({ token, user: { email: user.email, total: user.totalEnviados } });
});

function auth(req, res, next) {
    const token = req.headers.authorization;
    try {
        req.userId = jwt.verify(token, JWT_SECRET).id;
        next();
    } catch { res.status(401).json({ error: "Sessão expirada" }); }
}

// Endpoints do Painel
app.get("/status-whatsapp", auth, (req, res) => res.json({ status: qrcodes[req.userId] || "INICIANDO" }));

app.get("/user-data", auth, async (req, res) => {
    const user = await User.findById(req.userId);
    res.json({ ia: user.ia, total: user.totalEnviados });
});

app.post("/salvar-ia", auth, async (req, res) => {
    await User.findByIdAndUpdate(req.userId, { ia: req.body.texto });
    res.json({ ok: true });
});

app.post("/disparo", auth, async (req, res) => {
    const { numeros, mensagem } = req.body;
    const client = clientes[req.userId];
    if(!client || qrcodes[req.userId] !== "CONECTADO") return res.status(400).json({ error: "WhatsApp Desconectado" });

    const lista = numeros.split(',').map(n => n.trim());
    res.json({ ok: true, msg: `Iniciando envio para ${lista.length} contatos.` });

    // Loop de disparo com intervalo de segurança (Anti-Ban)
    for (let num of lista) {
        try {
            const finalNum = num.includes("@c.us") ? num : `${num}@c.us`;
            await client.sendMessage(finalNum, mensagem);
            await User.findByIdAndUpdate(req.userId, { $inc: { totalEnviados: 1 } });
            await sleep(4000); // 4 segundos entre cada mensagem
        } catch (e) { console.log("Erro no envio individual"); }
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.resolve(__dirname, 'index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Sistema rodando na porta ${PORT}`));
