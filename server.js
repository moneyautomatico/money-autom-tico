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

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    iaResumo: { type: String, default: "Olá! Como posso ajudar?" },
    baseAprendizado: { type: String, default: "" }, // Onde o conhecimento fica salvo
    msgFollowUp: { type: String, default: "Ainda está por aí?" },
    followUpAtivo: { type: Boolean, default: false },
    delayResponda: { type: Number, default: 3000 },
    botAtivo: { type: Boolean, default: true }
});

const ConversaSchema = new mongoose.Schema({
    userId: String,
    contato: String,
    ultimaMensagemDeles: Date,
    respondidoPelaIA: Boolean
});

const User = mongoose.model("User", UserSchema);
const Conversas = mongoose.model("Conversas", ConversaSchema);

mongoose.connect(MONGO_URI).then(() => console.log("🚀 SISTEMA INTEGRADO E APRENDENDO"));

const qrcodes = {};
const clientes = {};
const logsChat = {};

// Lógica de Follow-up (15 min)
setInterval(async () => {
    const limite = new Date(Date.now() - 15 * 60 * 1000);
    const pendentes = await Conversas.find({ respondidoPelaIA: true, ultimaMensagemDeles: { $lt: limite } });
    for (let conv of pendentes) {
        const u = await User.findById(conv.userId);
        if (u && u.followUpAtivo && clientes[conv.userId]) {
            try {
                await clientes[conv.userId].sendMessage(conv.contato, u.msgFollowUp);
                await Conversas.findByIdAndUpdate(conv._id, { respondidoPelaIA: false });
            } catch (e) {}
        }
    }
}, 60000);

async function engineWA(userId) {
    if (clientes[userId]) return;
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId, dataPath: './session_data' }),
        puppeteer: { headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });

    client.on('qr', qr => { qrcodes[userId] = qr; });
    client.on('ready', () => { qrcodes[userId] = "READY"; });

    client.on('message', async msg => {
        if (msg.fromMe || msg.from.endsWith('@g.us')) return;

        const u = await User.findById(userId);
        if (!u || !u.botAtivo) return;

        await Conversas.findOneAndUpdate(
            { userId, contato: msg.from },
            { ultimaMensagemDeles: new Date(), respondidoPelaIA: true },
            { upsert: true }
        );

        // --- LÓGICA DE APRENDIZADO ---
        // A IA agora combina a saudação com a base de conhecimento salva
        const respostaFinal = `${u.iaResumo}\n\n*Informação adicional:* ${u.baseAprendizado}`;

        if (!logsChat[userId]) logsChat[userId] = [];
        logsChat[userId].push({ de: msg.from.split('@')[0], txt: msg.body, hora: new Date().toLocaleTimeString() });

        setTimeout(async () => {
            try {
                await msg.reply(respostaFinal);
            } catch (e) { console.log("Erro ao responder"); }
        }, u.delayResponda);
    });

    clientes[userId] = client;
    client.initialize();
}

// ROTA DE DISPARO ATIVADA
app.post("/disparar", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const { numeros, mensagem, intervalo } = req.body;
        const client = clientes[d.id];

        if (!client || qrcodes[d.id] !== "READY") {
            return res.status(400).json({ error: "WhatsApp não está pronto para disparos." });
        }

        const lista = numeros.split('\n').map(n => n.trim().replace(/\D/g, ''));
        res.json({ msg: "Disparos iniciados no servidor!" });

        for (let num of lista) {
            if (num.length < 10) continue;
            await new Promise(r => setTimeout(r, intervalo * 1000));
            try {
                await client.sendMessage(`${num}@c.us`, mensagem);
            } catch (e) { console.log("Erro no disparo para " + num); }
        }
    } catch (e) { res.status(401).send(); }
});

// ROTAS PADRÃO (Login, Sync, Save)
app.post("/login", async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!u) return res.status(401).send();
    engineWA(u._id.toString());
    res.json({ token: jwt.sign({ id: u._id }, JWT_SECRET), user: u });
});

app.post("/save-config", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        await User.findByIdAndUpdate(d.id, req.body);
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

app.get("/sync", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ status: qrcodes[d.id] || "OFF", chats: logsChat[d.id] || [] });
    } catch (e) { res.status(401).send(); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 8080);
