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

const JWT_SECRET = "chave_mestra_2026";
const MONGO_URI = "mongodb+srv://moneyautomatico_db_user:Milionario2026@moneyautomatico.5bbierw.mongodb.net/money?retryWrites=true&w=majority";

// Schemas Blindados
const User = mongoose.model("User", new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    iaResumo: { type: String, default: "Olá!" },
    baseAprendizado: { type: String, default: "" },
    msgFollowUp: { type: String, default: "Ainda está por aí?" },
    followUpAtivo: { type: Boolean, default: true },
    delayResponda: { type: Number, default: 3000 }
}));

const LogEnvio = mongoose.model("LogEnvio", new mongoose.Schema({
    userId: String,
    numero: String,
    status: String,
    data: { type: Date, default: Date.now }
}));

mongoose.connect(MONGO_URI).then(() => {
    console.log("🚀 SISTEMA EM MODO COMANDO ATIVADO");
    User.find().then(users => users.forEach(u => engineWA(u._id.toString())));
});

const qrcodes = {};
const clientes = {};
const logsChat = {};
const progressoDisparo = {}; // Armazena progresso em tempo real

async function engineWA(userId) {
    if (clientes[userId]) return;
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId, dataPath: './sessions' }),
        puppeteer: { headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });

    client.on('qr', qr => { qrcodes[userId] = qr; });
    client.on('ready', () => { qrcodes[userId] = "READY"; });
    client.on('disconnected', () => { qrcodes[userId] = "OFF"; delete clientes[userId]; });

    client.on('message', async msg => {
        if (msg.fromMe || msg.from.endsWith('@g.us')) return;
        const u = await User.findById(userId);
        if (!u) return;
        const respostaFinal = `${u.iaResumo}\n\n${u.baseAprendizado}`;
        if (!logsChat[userId]) logsChat[userId] = [];
        logsChat[userId].push({ de: msg.from.split('@')[0], txt: msg.body, tipo: 'recebida' });

        setTimeout(async () => {
            try { 
                await msg.reply(respostaFinal); 
                logsChat[userId].push({ de: "IA", txt: respostaFinal, tipo: 'enviada' });
            } catch (e) {}
        }, u.delayResponda);
    });

    clientes[userId] = client;
    client.initialize().catch(() => {});
}

// ROTA DE DISPARO MODERNA
app.post("/disparar", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const { numeros, mensagem, intervalo } = req.body;
        const client = clientes[d.id];
        
        if (!client || qrcodes[d.id] !== "READY") return res.status(400).json({ error: "Conecte o WhatsApp no Monitor!" });
        
        const lista = numeros.split('\n').map(n => n.trim().replace(/\D/g, '')).filter(n => n.length > 8);
        
        // Inicializa objeto de progresso para o front-end consultar
        progressoDisparo[d.id] = { total: lista.length, atual: 0, msg: "Iniciando...", status: 'rodando' };
        
        res.json({ msg: "Disparo iniciado com sucesso!" });

        (async () => {
            for (let i = 0; i < lista.length; i++) {
                const num = lista[i];
                progressoDisparo[d.id].atual = i + 1;
                progressoDisparo[d.id].msg = `Enviando para ${num}...`;

                try {
                    await client.sendMessage(`${num}@c.us`, mensagem);
                    await new LogEnvio({ userId: d.id, numero: num, status: "✅ Sucesso" }).save();
                } catch (e) {
                    await new LogEnvio({ userId: d.id, numero: num, status: "❌ Erro" }).save();
                }
                
                if (i < lista.length - 1) {
                    await new Promise(r => setTimeout(r, (intervalo || 30) * 1000));
                }
            }
            progressoDisparo[d.id].status = 'finalizado';
            progressoDisparo[d.id].msg = "Campanha finalizada!";
        })();
    } catch (e) { res.status(401).send(); }
});

app.get("/progresso", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json(progressoDisparo[d.id] || { status: 'parado' });
    } catch (e) { res.status(401).send(); }
});

// Outras rotas (Mantidas da versão anterior...)
app.get("/sync", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ status: qrcodes[d.id] || "OFF", chats: (logsChat[d.id] || []).slice(-15) });
    } catch (e) { res.status(401).send(); }
});

app.post("/login", async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!u) return res.status(401).send();
    engineWA(u._id.toString());
    res.json({ token: jwt.sign({ id: u._id }, JWT_SECRET), user: u });
});

app.get("/logs-envio", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const logs = await LogEnvio.find({ userId: d.id }).sort({ data: -1 }).limit(50);
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
app.listen(process.env.PORT || 8080);
