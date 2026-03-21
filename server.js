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

// Esquema de Usuário
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    ia: { type: String, default: "Olá! Como posso te ajudar?" },
    totalEnviados: { type: Number, default: 0 }
});
const User = mongoose.model("User", UserSchema);

mongoose.connect(MONGO_URI).then(() => console.log("✅ DB Conectado"));

const clientes = {}; 
const qrcodes = {}; 
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

// NOVO: Rota de Registro de Usuário
app.post("/register", async (req, res) => {
    try {
        const { email, password } = req.body;
        if(!email || !password) return res.status(400).json({ error: "Preencha todos os campos" });
        const userExist = await User.findOne({ email: email.toLowerCase() });
        if(userExist) return res.status(400).json({ error: "E-mail já cadastrado" });
        await User.create({ email, password });
        res.json({ ok: true, msg: "Conta criada com sucesso! Agora faça login." });
    } catch (err) { res.status(500).json({ error: "Erro ao criar conta" }); }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase().trim(), password });
    if (!user) return res.status(400).json({ error: "E-mail ou senha incorretos" });
    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    inicializarWhatsapp(user._id.toString());
    res.json({ token });
});

function auth(req, res, next) {
    const token = req.headers.authorization;
    try { req.userId = jwt.verify(token, JWT_SECRET).id; next(); } 
    catch { res.status(401).json({ error: "Sessão expirada" }); }
}

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
    if(!client) return res.status(400).json({ error: "Conecte o WhatsApp primeiro" });
    const lista = numeros.split(',').map(n => n.trim());
    res.json({ ok: true, msg: "Disparos iniciados" });
    for (let num of lista) {
        try {
            await client.sendMessage(`${num}@c.us`, mensagem);
            await sleep(4000); 
        } catch (e) {}
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.resolve(__dirname, 'index
