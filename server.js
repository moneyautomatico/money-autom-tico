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

// Conexão Blindada
mongoose.connect(MONGO_URI).then(() => console.log("✅ BANCO CONECTADO"));

const User = mongoose.model("User", new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    iaResumo: { type: String, default: "Olá!" },
    baseAprendizado: { type: String, default: "" }
}));

const qrcodes = {};
const clientes = {};
const progressoDisparo = {};

async function engineWA(userId) {
    if (clientes[userId]) return;
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId, dataPath: './sessions' }),
        puppeteer: { headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });

    client.on('qr', qr => { qrcodes[userId] = qr; });
    client.on('ready', () => { qrcodes[userId] = "READY"; });
    client.on('disconnected', () => { qrcodes[userId] = "OFF"; delete clientes[userId]; });

    clientes[userId] = client;
    client.initialize().catch(() => {});
}

// ROTA DE DISPARO (A função que você pediu)
app.post("/disparar", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const { numeros, mensagem, intervalo } = req.body;
        const client = clientes[d.id];

        if (!client || qrcodes[d.id] !== "READY") return res.status(400).json({ error: "Zap Desconectado" });

        const lista = numeros.split('\n').map(n => n.trim().replace(/\D/g, '')).filter(n => n.length > 8);
        progressoDisparo[d.id] = { total: lista.length, atual: 0, status: 'rodando' };
        
        res.json({ msg: "Iniciado!" });

        (async () => {
            for (let i = 0; i < lista.length; i++) {
                try {
                    await client.sendMessage(`${lista[i]}@c.us`, mensagem);
                    progressoDisparo[d.id].atual = i + 1;
                } catch (e) { console.log("Erro no envio"); }
                if (i < lista.length - 1) await new Promise(r => setTimeout(r, (intervalo || 30) * 1000));
            }
            progressoDisparo[d.id].status = 'finalizado';
        })();
    } catch (e) { res.status(401).send(); }
});

app.get("/sync", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ status: qrcodes[d.id] || "OFF" });
    } catch (e) { res.status(401).send(); }
});

app.post("/login", async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!u) return res.status(401).send();
    engineWA(u._id.toString());
    res.json({ token: jwt.sign({ id: u._id }, JWT_SECRET), user: u });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 8080, "0.0.0.0");
