const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.json());
app.use(cors());

// Serve os arquivos estáticos da sua pasta 'public' (onde deve ficar o index.html)
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = "chave_mestra_2026";
const MONGO_URI = "mongodb+srv://moneyautomatico_db_user:Milionario2026@moneyautomatico.5bbierw.mongodb.net/money?retryWrites=true&w=majority";

const User = mongoose.model("User", new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    usuario: String,
    password: { type: String, required: true },
    botAtivo: { type: Boolean, default: true },
    delayResponda: { type: Number, default: 3000 },
    iaResumo: { type: String, default: "Olá! Como posso ajudar?" },
    baseAprendizado: { type: String, default: "" },
    mensagensEnviadas: { type: Number, default: 0 },
    contatosBloqueados: [String]
}));

mongoose.connect(MONGO_URI).then(() => console.log("🚀 MONGODB CONECTADO"));

const qrcodes = {};
const clientes = {};
const logsChat = {};

async function engineWA(userId) {
    if (clientes[userId]) return;

    const client = new Client({
        authStrategy: new LocalAuth({ 
            clientId: userId,
            dataPath: './whatsapp' // Usa sua pasta /whatsapp para salvar a sessão
        }),
        puppeteer: {
            headless: "new",
            executablePath: '/usr/bin/google-chrome',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
    });

    client.on('qr', qr => { qrcodes[userId] = qr; });
    client.on('ready', () => { qrcodes[userId] = "READY"; console.log("Zap Pronto!"); });
    client.on('disconnected', () => { qrcodes[userId] = "OFF"; delete clientes[userId]; });

    client.on('message', async msg => {
        if (msg.fromMe) return;
        const u = await User.findById(userId);
        if (!u || !u.botAtivo || u.contatosBloqueados.includes(msg.from)) return;

        setTimeout(async () => {
            try {
                await msg.reply(u.iaResumo);
                await User.findByIdAndUpdate(userId, { $inc: { mensagensEnviadas: 1 } });
                
                if (!logsChat[userId]) logsChat[userId] = [];
                logsChat[userId].push({ de: msg.from.split('@')[0], txt: msg.body, hora: new Date().toLocaleTimeString() });
                if (logsChat[userId].length > 20) logsChat[userId].shift();
            } catch (e) { console.log("Erro ao responder"); }
        }, u.delayResponda);
    });

    clientes[userId] = client;
    client.initialize().catch(() => {});
}

// --- ROTAS DE AUTENTICAÇÃO ---
app.post("/register", async (req, res) => {
    try {
        const novo = new User(req.body);
        await novo.save();
        res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: "E-mail já existe" }); }
});

app.post("/login", async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!u) return res.status(401).send();
    engineWA(u._id.toString());
    res.json({ token: jwt.sign({ id: u._id }, JWT_SECRET), user: u });
});

app.post("/logout-wa", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        if (clientes[d.id]) {
            await clientes[d.id].logout();
            delete clientes[d.id];
            qrcodes[d.id] = "OFF";
        }
        res.json({ ok: true });
    } catch (e) { res.status(500).send(); }
});

app.get("/sync", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const u = await User.findById(d.id);
        res.json({ 
            status: qrcodes[d.id] || "OFF", 
            chats: logsChat[d.id] || [], 
            metricas: { total: u.mensagensEnviadas || 0, blocks: u.contatosBloqueados.length }
        });
    } catch (e) { res.status(401).send(); }
});

app.post("/save-config", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        await User.findByIdAndUpdate(d.id, req.body);
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

// --- DISPARO EM MASSA ---
app.post("/disparar", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const { numeros, mensagem, intervalo } = req.body;
        const client = clientes[d.id];
        if (!client || qrcodes[d.id] !== "READY") return res.status(400).json({ error: "WhatsApp não conectado" });

        const lista = numeros.split('\n').map(n => n.trim().replace(/\D/g, ''));
        res.json({ msg: "Iniciando disparos..." });

        for (let num of lista) {
            if (num.length < 10) continue;
            await new Promise(r => setTimeout(r, intervalo * 1000));
            try { await client.sendMessage(`${num}@c.us`, mensagem); } catch (e) {}
        }
    } catch (e) { res.status(401).send(); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(process.env.PORT || 8080);
