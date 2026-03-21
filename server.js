const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path'); 
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = "money_automatico_multi_2026";
const MONGO_URI = "mongodb+srv://moneyautomatico_db_user:Milionario2026@moneyautomatico.5bbierw.mongodb.net/money?retryWrites=true&w=majority";

// ==================== SCHEMA MULTI-USUÁRIO ====================
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    ia: { type: String, default: "Olá! Como posso ajudar?" }
});
const User = mongoose.model("User", UserSchema);

mongoose.connect(MONGO_URI).then(() => console.log("✅ MongoDB Multi-User Ativo"));

// ==================== GERENCIADOR DE INSTÂNCIAS ====================
const clientes = {}; 
const qrcodes = {}; 

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
    client.on('ready', () => { qrcodes[userId] = "CONECTADO"; console.log(`✅ Usuário ${userId} conectado!`); });

    client.on('message', async msg => {
        if (msg.fromMe) return;
        const user = await User.findById(userId);
        if (user && user.ia) await msg.reply(user.ia);
    });

    clientes[userId] = client;
    client.initialize().catch(err => console.log("Erro no client:", userId));
}

// ==================== ROTAS DE ACESSO ====================

app.post("/register", async (req, res) => {
    try {
        const email = (req.body.email || "").toLowerCase().trim();
        const password = (req.body.password || "").toString().trim();
        
        const userExist = await User.findOne({ email });
        if(userExist) return res.status(400).json({ error: "E-mail já cadastrado" });

        await User.create({ email, password });
        res.json({ ok: true, msg: "Conta criada com sucesso!" });
    } catch (err) { res.status(500).json({ error: "Erro ao criar conta" }); }
});

app.post("/login", async (req, res) => {
    const email = (req.body.email || "").toLowerCase().trim();
    const password = (req.body.password || "").toString().trim();
    const user = await User.findOne({ email, password });

    if (!user) return res.status(400).json({ error: "Dados incorretos" });

    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    inicializarWhatsapp(user._id.toString());
    res.json({ token, userId: user._id });
});

function auth(req, res, next) {
    const token = req.headers.authorization;
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch { res.status(401).json({ error: "Sessão expirada" }); }
}

app.get("/status-whatsapp", auth, (req, res) => {
    res.json({ status: qrcodes[req.userId] || "INICIANDO" });
});

app.post("/salvar-ia", auth, async (req, res) => {
    await User.findByIdAndUpdate(req.userId, { ia: req.body.texto });
    res.json({ ok: true });
});

app.get("/carregar-ia", auth, async (req, res) => {
    const user = await User.findById(req.userId);
    res.json({ texto: user.ia || "" });
});

app.post("/disparo", auth, async (req, res) => {
    const { numeros, mensagem } = req.body;
    const client = clientes[req.userId];
    if(!client) return res.status(400).json({ error: "WhatsApp não iniciado" });

    try {
        const lista = numeros.split(',');
        for (let n of lista) {
            let num = n.trim();
            if (!num.includes("@c.us")) num += "@c.us";
            await client.sendMessage(num, mensagem);
        }
        res.json({ ok: true });
    } catch { res.status(500).json({ error: "Erro no envio" }); }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.resolve(__dirname, 'index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Multi-User rodando na porta ${PORT}`));
