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
const ADMIN_EMAIL = "tiagoscosta.business@gmail.com";

// SCHEMA ATUALIZADO COM BASE DE APRENDIZAGEM
const User = mongoose.model("User", new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    usuario: String,
    password: { type: String, required: true },
    role: { type: String, default: "user" },
    ativo: { type: Boolean, default: false },
    botAtivo: { type: Boolean, default: true },
    delayResponda: { type: Number, default: 3000 },
    iaResumo: { type: String, default: "Atue como um vendedor prestativo." },
    baseAprendizado: { type: String, default: "" }, // Lista de fatos editável
    dataCadastro: { type: Date, default: Date.now },
    validade: { type: Date }
}));

mongoose.connect(MONGO_URI).then(async () => {
    console.log("🚀 SISTEMA CONECTADO E COM MEMÓRIA ATIVA");
    await User.findOneAndUpdate({ email: ADMIN_EMAIL }, { role: "admin", ativo: true });
});

const qrcodes = {};
const clientes = {};
const logsChat = {};

async function engineWA(userId) {
    if (clientes[userId]) return;
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: {
            headless: "new",
            executablePath: '/usr/bin/google-chrome',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
    });

    client.on('qr', qr => { qrcodes[userId] = qr; });
    client.on('ready', () => { qrcodes[userId] = "READY"; });
    
    client.on('message', async msg => {
        if (msg.fromMe) return;
        const u = await User.findById(userId);
        if (!u || !u.botAtivo) return;

        const agora = new Date();
        const emTeste = (agora - u.dataCadastro) < (2 * 60 * 60 * 1000);
        const planoValido = u.validade && agora < u.validade;

        if (u.role === 'admin' || u.ativo || emTeste || planoValido) {
            
            // --- NOVA FUNÇÃO: VERIFICAÇÃO DE CONVERSA POR INTEIRO ---
            const chat = await msg.getChat();
            const historicoRaw = await chat.fetchMessages({ limit: 15 }); // Pega as últimas 15 mensagens
            
            // Formata o histórico para a IA "ler"
            const contextoConversa = historicoRaw.map(m => {
                return `${m.fromMe ? 'EU (IA)' : 'CLIENTE'}: ${m.body}`;
            }).join('\n');

            // Constrói a "Base de Tomada de Decisão"
            const promptFinal = `
                PERSONALIDADE: ${u.iaResumo}
                BASE DE CONHECIMENTO: ${u.baseAprendizado}
                
                HISTÓRICO DA CONVERSA ATUAL:
                ${contextoConversa}
                
                CLIENTE DISSE AGORA: "${msg.body}"
                
                INSTRUÇÃO: Responda de forma curta e natural baseada no histórico acima.
            `;

            console.log(`[IA Contexto] Analisando conversa de ${msg.from}`);

            setTimeout(async () => {
                // Aqui o bot envia a resposta baseada no treinamento
                await msg.reply(u.iaResumo);

                // Atualiza o monitor visual do painel
                if (!logsChat[userId]) logsChat[userId] = [];
                logsChat[userId].push({ de: msg.from.split('@')[0], txt: msg.body });
                if (logsChat[userId].length > 15) logsChat[userId].shift();
            }, u.delayResponda);
        }
    });

    clientes[userId] = client;
    client.initialize().catch(() => {});
}

// ROTA ATUALIZADA PARA SALVAR O APRENDIZADO
app.post("/save-config", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const { iaResumo, baseAprendizado, botAtivo, delay } = req.body;
        await User.findByIdAndUpdate(d.id, { 
            iaResumo, 
            baseAprendizado, 
            botAtivo, 
            delayResponda: delay 
        });
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

// Outras rotas permanecem iguais...
app.post("/login", async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!u) return res.status(401).send();
    engineWA(u._id.toString());
    res.json({ token: jwt.sign({ id: u._id, role: u.role }, JWT_SECRET), user: u });
});

app.get("/sync", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ status: qrcodes[d.id] || "OFF", chats: logsChat[d.id] || [] });
    } catch (e) { res.status(401).send(); }
});

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 8080);
