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
    botAtivo: { type: Boolean, default: true },
    delayResponda: { type: Number, default: 3000 },
    iaResumo: { type: String, default: "Olá!" },
    baseAprendizado: { type: String, default: "" },
    dataCadastro: { type: Date, default: Date.now }
}));

mongoose.connect(MONGO_URI).then(() => console.log("🚀 SISTEMA PRONTO PARA DISPAROS"));

const qrcodes = {};
const clientes = {};

// FUNÇÃO DE CONEXÃO WHATSAPP
async function engineWA(userId) {
    if (clientes[userId]) return;
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: {
            headless: "new",
            executablePath: '/usr/bin/google-chrome',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', qr => { qrcodes[userId] = qr; });
    client.on('ready', () => { qrcodes[userId] = "READY"; console.log(`Zap Conectado: ${userId}`); });
    
    // Resposta Automática com Contexto
    client.on('message', async msg => {
        if (msg.fromMe) return;
        const u = await User.findById(userId);
        if (!u || !u.botAtivo) return;

        setTimeout(async () => {
            await msg.reply(u.iaResumo);
        }, u.delayResponda);
    });

    clientes[userId] = client;
    client.initialize().catch(() => {});
}

// ROTA DE DISPARO EM MASSA CONTROLADO
app.post("/disparar", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const { numeros, mensagem, intervalo } = req.body; // intervalo em segundos
        const client = clientes[d.id];

        if (!client || qrcodes[d.id] !== "READY") {
            return res.status(400).json({ error: "WhatsApp não conectado!" });
        }

        const lista = numeros.split('\n').map(n => n.trim().replace(/\D/g, ''));
        
        // Loop de disparo com Delay (Promessa)
        res.json({ msg: `Iniciando disparo para ${lista.length} contatos...` });

        for (let i = 0; i < lista.length; i++) {
            const num = lista[i];
            if (num.length < 10) continue;

            const chatId = num.includes('@c.us') ? num : `${num}@c.us`;
            
            // Espera o tempo definido antes de cada envio
            await new Promise(resolve => setTimeout(resolve, intervalo * 1000));
            
            try {
                await client.sendMessage(chatId, mensagem);
                console.log(`✅ Enviado para: ${num}`);
            } catch (err) {
                console.log(`❌ Erro no número: ${num}`);
            }
        }
    } catch (e) { res.status(401).send(); }
});

// Rotas Base (Login, Sync, Save) mantidas...
app.post("/login", async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!u) return res.status(401).send();
    engineWA(u._id.toString());
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
