const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

const JWT_SECRET = "chave_mestra_blindada_2026";
const MONGO_URI = "mongodb+srv://moneyautomatico_db_user:Milionario2026@moneyautomatico.5bbierw.mongodb.net/money?retryWrites=true&w=majority";

// Schemas de Dados
const User = mongoose.model("User", new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    iaResumo: { type: String, default: "Olá! Como posso ajudar?" },
    baseAprendizado: { type: String, default: "" },
    delayResponda: { type: Number, default: 3000 }
}));

const LogEnvio = mongoose.model("LogEnvio", new mongoose.Schema({
    userId: String, numero: String, status: String, data: { type: Date, default: Date.now }
}));

// Conexão com Banco de Dados
mongoose.connect(MONGO_URI).then(() => {
    console.log("🚀 SISTEMA CONECTADO AO BANCO");
    User.find().then(users => users.forEach(u => engineWA(u._id.toString())));
}).catch(err => console.log("❌ Erro Mongo:", err));

const qrcodes = {};
const clientes = {};
const logsChat = {};
const progressoDisparo = {};

// Função Spintax (Garante variação nas mensagens)
function processarSpintax(texto) {
    if (!texto) return "";
    return texto.replace(/{([^{}]+)}/g, (_, escolhas) => {
        const opcoes = escolhas.split('|');
        return opcoes[Math.floor(Math.random() * opcoes.length)];
    });
}

// Motor WhatsApp com Blindagem de Memória
async function engineWA(userId) {
    if (clientes[userId]) return;

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId, dataPath: './sessions' }),
        puppeteer: { 
            headless: "new",
            protocolTimeout: 120000, // ✅ CORREÇÃO: aumenta timeout para 120s (evita erro de timeout no Docker)
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--disable-accelerated-2d-canvas', 
                '--no-first-run', 
                '--no-zygote', 
                '--disable-gpu'
            ] 
        }
    });

    client.on('qr', qr => { qrcodes[userId] = qr; });
    client.on('ready', () => { qrcodes[userId] = "READY"; console.log(`✅ Conectado: ${userId}`); });
    client.on('disconnected', () => { qrcodes[userId] = "OFF"; delete clientes[userId]; });

    client.on('message', async msg => {
        if (msg.fromMe || msg.from.endsWith('@g.us')) return;
        try {
            const u = await User.findById(userId);
            if (!u) return;

            const chat = await msg.getChat();
            const respostaFinal = processarSpintax(`${u.iaResumo}\n\n${u.baseAprendizado}`);
            
            if (!logsChat[userId]) logsChat[userId] = [];
            logsChat[userId].push({ de: msg.from.split('@')[0], txt: msg.body, tipo: 'recebida' });

            await chat.sendStateTyping(); 
            setTimeout(async () => {
                try {
                    await msg.reply(respostaFinal); 
                    logsChat[userId].push({ de: "IA", txt: respostaFinal, tipo: 'enviada' });
                    await chat.clearState();
                } catch (e) {}
            }, u.delayResponda);
        } catch (e) { console.log("Erro no chat:", e); }
    });

    clientes[userId] = client;
    client.initialize().catch(e => console.log("Erro Init:", e));
}

// --- ROTAS BLINDADAS ---

app.post("/register", async (req, res) => {
    try {
        const novo = new User(req.body);
        await novo.save();
        res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: "E-mail já existe" }); }
});

app.post("/login", async (req, res) => {
    try {
        const u = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
        if (!u) return res.status(401).json({ error: "Acesso negado" });
        engineWA(u._id.toString());
        res.json({ token: jwt.sign({ id: u._id }, JWT_SECRET), user: u });
    } catch (e) { res.status(500).send(); }
});

app.post("/disparar", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const { numeros, mensagem, intervalo } = req.body;
        const client = clientes[d.id];

        if (!client || qrcodes[d.id] !== "READY") return res.status(400).json({ error: "WhatsApp Offline" });
        
        const lista = numeros.split('\n').map(n => n.trim().replace(/\D/g, '')).filter(n => n.length > 8);
        progressoDisparo[d.id] = { total: lista.length, atual: 0, status: 'rodando' };
        
        res.json({ msg: "Campanha em execução!" });

        (async () => {
            for (let i = 0; i < lista.length; i++) {
                try {
                    const msgVariada = processarSpintax(mensagem);
                    await client.sendMessage(`${lista[i]}@c.us`, msgVariada);
                    await new LogEnvio({ userId: d.id, numero: lista[i], status: "✅ Sucesso" }).save();
                    progressoDisparo[d.id].atual = i + 1;
                } catch (e) {
                    await new LogEnvio({ userId: d.id, numero: lista[i], status: "❌ Erro" }).save();
                }
                if (i < lista.length - 1) await new Promise(r => setTimeout(r, (intervalo || 30) * 1000));
            }
            progressoDisparo[d.id].status = 'finalizado';
        })();
    } catch (e) { res.status(401).send(); }
});

app.get("/sync", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ status: qrcodes[d.id] || "OFF", chats: (logsChat[d.id] || []).slice(-10) });
    } catch (e) { res.status(401).send(); }
});

app.get("/progresso", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json(progressoDisparo[d.id] || { status: 'parado' });
    } catch (e) { res.status(401).send(); }
});

app.get("/logs-envio", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const logs = await LogEnvio.find({ userId: d.id }).sort({ data: -1 }).limit(20);
        res.json(logs);
    } catch (e) { res.status(401).send(); }
});

app.post("/save-config", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        await User.findByIdAndUpdate(d.id, req.body);
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 SERVIDOR BLINDADO NA PORTA ${PORT}`));
