const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.json());
app.use(cors());

// CONFIGURAÇÕES MESTRAS
const JWT_SECRET = "chave_mestra_2026";
const MONGO_URI = "mongodb+srv://moneyautomatico_db_user:Milionario2026@moneyautomatico.5bbierw.mongodb.net/money?retryWrites=true&w=majority";
const ADMIN_EMAIL = "tiagoscosta.business@gmail.com";

// MODELO DE DADOS
const User = mongoose.model("User", new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    usuario: String,
    password: { type: String, required: true },
    role: { type: String, default: "user" },
    ativo: { type: Boolean, default: false },
    dataCadastro: { type: Date, default: Date.now },
    validade: { type: Date },
    iaResumo: { type: String, default: "Olá! Sou sua IA de atendimento automático. Como posso ajudar?" }
}));

// CONEXÃO BANCO
mongoose.connect(MONGO_URI).then(async () => {
    console.log("🚀 BANCO DE DADOS CONECTADO");
    // Garante que seu e-mail sempre seja Admin
    await User.findOneAndUpdate({ email: ADMIN_EMAIL }, { role: "admin", ativo: true });
});

const qrcodes = {};
const clientes = {};
const logsChat = {};

// MOTOR WHATSAPP (ADAPTADO PARA DOCKER)
async function engineWA(userId) {
    if (clientes[userId]) return;

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: {
            headless: "new",
            // NO DOCKER O CAMINHO É FIXO NESTE ENDEREÇO:
            executablePath: '/usr/bin/google-chrome', 
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote'
            ]
        }
    });

    client.on('qr', qr => {
        console.log(`[QR] Novo código gerado para: ${userId}`);
        qrcodes[userId] = qr;
    });

    client.on('ready', () => {
        console.log(`[OK] WhatsApp Conectado para: ${userId}`);
        qrcodes[userId] = "READY";
    });

    client.on('message', async msg => {
        if (msg.fromMe) return;
        
        const u = await User.findById(userId);
        if (!u) return;

        // LÓGICA DE ACESSO (Admin, Ativo, ou Teste de 2h)
        const agora = new Date();
        const emTeste = (agora - u.dataCadastro) < (2 * 60 * 60 * 1000);
        const planoValido = u.validade && agora < u.validade;

        if (u.role === 'admin' || u.ativo || emTeste || planoValido) {
            if (!logsChat[userId]) logsChat[userId] = [];
            
            // Registra no monitor
            logsChat[userId].push({ de: msg.from.split('@')[0], txt: msg.body, hora: agora.toLocaleTimeString() });
            
            // Responde com a IA treinada
            msg.reply(u.iaResumo);
            
            logsChat[userId].push({ de: "IA", txt: u.iaResumo, hora: agora.toLocaleTimeString() });
            if (logsChat[userId].length > 20) logsChat[userId].shift();
        }
    });

    clientes[userId] = client;
    client.initialize().catch(err => console.error("Erro Puppeteer:", err));
}

// ROTAS API
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const u = await User.findOne({ email: email.toLowerCase(), password });
    if (!u) return res.status(401).json({ error: "Credenciais inválidas" });
    
    engineWA(u._id.toString());
    res.json({ token: jwt.sign({ id: u._id, role: u.role }, JWT_SECRET), user: u });
});

app.get("/sync", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        res.json({ 
            status: qrcodes[d.id] || "OFF", 
            chats: logsChat[d.id] || [] 
        });
    } catch (e) { res.status(401).send(); }
});

app.post("/set-ia", async (req, res) => {
    try {
        const d = jwt.verify(req.headers.authorization, JWT_SECRET);
        await User.findByIdAndUpdate(d.id, { iaResumo: req.body.txt });
        res.json({ ok: true });
    } catch (e) { res.status(401).send(); }
});

// ADMINISTRAÇÃO
app.get("/admin/users", async (req, res) => {
    const users = await User.find({});
    res.json(users);
});

app.post("/admin/liberar", async (req, res) => {
    const { id, dias } = req.body;
    const v = new Date(); v.setDate(v.getDate() + parseInt(dias));
    await User.findByIdAndUpdate(id, { ativo: true, validade: v });
    res.json({ ok: true });
});

// SERVIR FRONT-END
app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
