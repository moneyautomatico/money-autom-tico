const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.json());
app.use(cors());

// CONFIGURAÇÕES MESTRE
const JWT_SECRET = "money_automatico_2026_super_key";
const MONGO_URI = "mongodb+srv://moneyautomatico_db_user:Milionario2026@moneyautomatico.5bbierw.mongodb.net/money?retryWrites=true&w=majority";
const MEU_EMAIL_ADMIN = "tiagoscosta.business@gmail.com"; // Seu acesso master

// MODELO DE USUÁRIO (Adicionado campo 'role' para Admin)
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    ia: { type: String, default: "Olá! Em breve te respondo." },
    totalEnviados: { type: Number, default: 0 },
    role: { type: String, default: "user" } // 'admin' ou 'user'
});
const User = mongoose.model("User", UserSchema);

// CONEXÃO BANCO DE DADOS
mongoose.connect(MONGO_URI).then(async () => {
    console.log("✅ MongoDB Conectado");
    // Garante que o seu e-mail sempre seja o ADMIN do sistema
    await User.findOneAndUpdate({ email: MEU_EMAIL_ADMIN }, { role: "admin" });
}).catch(err => console.error("❌ Erro MongoDB:", err));

const clientes = {};
const qrcodes = {};

// INICIALIZADOR DO WHATSAPP (Isolado por Usuário)
async function inicializarWhatsapp(userId) {
    if (clientes[userId]) return;
    
    console.log(`📱 Iniciando WhatsApp para o usuário: ${userId}`);
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId, dataPath: './sessions' }),
        puppeteer: { 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
        }
    });

    client.on('qr', (qr) => { qrcodes[userId] = qr; });
    client.on('ready', () => { 
        console.log(`✅ WhatsApp Pronto para o usuário: ${userId}`);
        qrcodes[userId] = "CONECTADO"; 
    });
    
    client.on('message', async msg => {
        if (msg.fromMe) return;
        const user = await User.findById(userId);
        if (user && user.ia) {
            const chat = await msg.getChat();
            await chat.sendStateTyping();
            setTimeout(async () => {
                await msg.reply(user.ia);
                await User.findByIdAndUpdate(userId, { $inc: { totalEnviados: 1 } });
            }, 3000);
        }
    });

    clientes[userId] = client;
    client.initialize().catch(err => console.error("Erro no WhatsApp:", err));
}

// --- ROTAS DO SISTEMA ---

// 1. REGISTRO (O que faz o botão azul funcionar)
app.post("/register", async (req, res) => {
    try {
        const { email, password } = req.body;
        const userExist = await User.findOne({ email: email.toLowerCase() });
        if (userExist) return res.status(400).json({ error: "E-mail já existe!" });
        
        await User.create({ email, password });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: "Erro ao criar conta" }); }
});

// 2. LOGIN
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase(), password });
    if (!user) return res.status(400).json({ error: "E-mail ou senha incorretos" });

    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET);
    inicializarWhatsapp(user._id.toString());
    res.json({ token, role: user.role });
});

// MIDDLEWARE DE PROTEÇÃO
const verificarToken = (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ error: "Acesso negado" });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch { res.status(401).json({ error: "Sessão expirada" }); }
};

// 3. ROTA DO ADMIN (Painel Master)
app.get("/admin/users", verificarToken, async (req, res) => {
    const admin = await User.findById(req.userId);
    if (admin.role !== 'admin') return res.status(403).json({ error: "Acesso negado" });
    
    const users = await User.find({}, '-password'); // Pega todos menos a senha
    const listaCompleta = users.map(u => ({
        ...u._doc,
        status: qrcodes[u._id] || "OFFLINE"
    }));
    res.json(listaCompleta);
});

// 4. STATUS DO WHATSAPP
app.get("/status-whatsapp", verificarToken, (req, res) => {
    res.json({ status: qrcodes[req.userId] || "INICIANDO" });
});

// 5. SALVAR IA DO USUÁRIO
app.post("/salvar-ia", verificarToken, async (req, res) => {
    await User.findByIdAndUpdate(req.userId, { ia: req.body.texto });
    res.json({ ok: true });
});

// SERVIR FRONT-END
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.resolve(__dirname, 'index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor Ativo na porta ${PORT}`);
});
