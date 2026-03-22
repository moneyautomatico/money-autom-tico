const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const bcrypt = require('bcryptjs');                                      // NOVO: hash de senhas
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js'); // NOVO: MessageMedia para imagens

const app = express();
app.use(express.json({ limit: '20mb' })); // NOVO: limite aumentado para suportar imagens base64
app.use(cors());
app.use(express.static(__dirname));

const JWT_SECRET = "chave_mestra_blindada_2026";
const MONGO_URI = "mongodb+srv://moneyautomatico_db_user:Milionario2026@moneyautomatico.5bbierw.mongodb.net/money?retryWrites=true&w=majority";

// Schemas de Dados — INALTERADOS
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

// Conexão com Banco de Dados — INALTERADA
mongoose.connect(MONGO_URI).then(() => {
    console.log("🚀 SISTEMA CONECTADO AO BANCO");
    User.find().then(users => users.forEach(u => engineWA(u._id.toString())));
}).catch(err => console.log("❌ Erro Mongo:", err));

const qrcodes = {};
const clientes = {};
const logsChat = {};
const progressoDisparo = {};

// Função Spintax — INALTERADA
function processarSpintax(texto) {
    if (!texto) return "";
    return texto.replace(/{([^{}]+)}/g, (_, escolhas) => {
        const opcoes = escolhas.split('|');
        return opcoes[Math.floor(Math.random() * opcoes.length)];
    });
}

// Motor WhatsApp — INALTERADO (exceto hora nos logs de chat)
async function engineWA(userId) {
    if (clientes[userId]) return;

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId, dataPath: './sessions' }),
        puppeteer: {
            headless: "new",
            protocolTimeout: 120000,
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
            // NOVO: hora no log para exibição na aba de Chats
            logsChat[userId].push({ de: msg.from.split('@')[0], txt: msg.body, tipo: 'recebida', hora: new Date().toLocaleTimeString('pt-BR') });

            await chat.sendStateTyping();
            setTimeout(async () => {
                try {
                    await msg.reply(respostaFinal);
                    logsChat[userId].push({ de: "IA", txt: respostaFinal, tipo: 'enviada', hora: new Date().toLocaleTimeString('pt-BR') });
                    await chat.clearState();
                } catch (e) {}
            }, u.delayResponda);
        } catch (e) { console.log("Erro no chat:", e); }
    });

    clientes[userId] = client;
    client.initialize().catch(e => console.log("Erro Init:", e));
}

// --- ROTAS ---

// ALTERADA: senha agora é hasheada com bcrypt
app.post("/register", async (req, res) => {
    try {
        const hash = await bcrypt.hash(req.body.password, 10);
        const novo = new User({ email: req.body.email, password: hash });
        await novo.save();
        res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: "E-mail já existe" }); }
});

// ALTERADA: login com bcrypt + fallback para contas antigas (texto puro)
app.post("/login", async (req, res) => {
    try {
        const u = await User.findOne({ email: req.body.email.toLowerCase() });
        if (!u) return res.status(401).json({ error: "Acesso negado" });
        const senhaCorreta = await bcrypt.compare(req.body.password, u.password).catch(() => false)
                          || u.password === req.body.password;
        if (!senhaCorreta) return res.status(401).json({ error: "Acesso negado" });
        engineWA(u._id.toString());
        res.json({ token: jwt.sign({ id: u._id }, JWT_SECRET), user: u });
    } catch (e) { res.status(500).send(); }
});

// ALTERADA: suporte a imagem, agendamento, pausar e cancelar
app.post("/disparar", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const { numeros, mensagem, intervalo, imagemBase64, imagemMime, imagemNome, agendarEm } = req.body;
        const client = clientes[d.id];

        if (!client || qrcodes[d.id] !== "READY") return res.status(400).json({ error: "WhatsApp Offline" });

        const lista = numeros.split('\n').map(n => n.trim().replace(/\D/g, '')).filter(n => n.length > 8);
        progressoDisparo[d.id] = { total: lista.length, atual: 0, status: 'agendado', pausado: false, cancelado: false };

        res.json({ msg: "Campanha em execução!" });

        (async () => {
            // NOVO: espera até o horário agendado
            if (agendarEm) {
                const alvo = new Date(agendarEm).getTime();
                const agora = Date.now();
                if (alvo > agora) {
                    progressoDisparo[d.id].status = 'agendado';
                    await new Promise(r => setTimeout(r, alvo - agora));
                }
            }

            progressoDisparo[d.id].status = 'rodando';

            for (let i = 0; i < lista.length; i++) {
                // NOVO: cancelar disparo
                if (progressoDisparo[d.id].cancelado) {
                    progressoDisparo[d.id].status = 'cancelado';
                    break;
                }
                // NOVO: pausar disparo (fica esperando retomar)
                while (progressoDisparo[d.id].pausado) {
                    await new Promise(r => setTimeout(r, 1000));
                }

                try {
                    const msgVariada = processarSpintax(mensagem);
                    // NOVO: envio com imagem se fornecida
                    if (imagemBase64) {
                        const media = new MessageMedia(imagemMime || 'image/jpeg', imagemBase64, imagemNome || 'imagem.jpg');
                        await client.sendMessage(`${lista[i]}@c.us`, media, { caption: msgVariada });
                    } else {
                        await client.sendMessage(`${lista[i]}@c.us`, msgVariada);
                    }
                    await new LogEnvio({ userId: d.id, numero: lista[i], status: "✅ Sucesso" }).save();
                    progressoDisparo[d.id].atual = i + 1;
                } catch (e) {
                    await new LogEnvio({ userId: d.id, numero: lista[i], status: "❌ Erro" }).save();
                }
                if (i < lista.length - 1) await new Promise(r => setTimeout(r, (intervalo || 30) * 1000));
            }
            if (!progressoDisparo[d.id].cancelado) progressoDisparo[d.id].status = 'finalizado';
        })();
    } catch (e) { res.status(401).send(); }
});

// NOVO: pausar/retomar disparo
app.post("/pausar", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        if (progressoDisparo[d.id]) {
            progressoDisparo[d.id].pausado = !progressoDisparo[d.id].pausado;
            res.json({ pausado: progressoDisparo[d.id].pausado });
        } else res.json({ pausado: false });
    } catch (e) { res.status(401).send(); }
});

// NOVO: cancelar disparo definitivamente
app.post("/cancelar", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        if (progressoDisparo[d.id]) progressoDisparo[d.id].cancelado = true;
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

// NOVO: estatísticas do usuário
app.get("/stats", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        const total = await LogEnvio.countDocuments({ userId: d.id });
        const sucesso = await LogEnvio.countDocuments({ userId: d.id, status: "✅ Sucesso" });
        const erro = await LogEnvio.countDocuments({ userId: d.id, status: "❌ Erro" });
        res.json({ total, sucesso, erro, taxa: total > 0 ? Math.round((sucesso / total) * 100) : 0 });
    } catch (e) { res.status(401).send(); }
});

// NOVO: chats completos para a aba de conversas
app.get("/chats", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json(logsChat[d.id] || []);
    } catch (e) { res.status(401).send(); }
});

// INALTERADAS
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
