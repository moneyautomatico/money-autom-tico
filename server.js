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

// SCHEMA DE USUÁRIO
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    ia: { type: String, default: "Olá! Recebi sua mensagem." },
    totalEnviados: { type: Number, default: 0 },
    role: { type: String, default: "user" }
});
const User = mongoose.model("User", UserSchema);

// CONEXÃO MONGO E ATIVAÇÃO DO SEU ADMIN
mongoose.connect(MONGO_URI).then(async () => {
    console.log("✅ MongoDB Conectado");
    // Garante que o seu e-mail seja o administrador do sistema
    await User.findOneAndUpdate(
        { email: ADMIN_EMAIL.toLowerCase() }, 
        { role: "admin" },
        { upsert: false } // Só altera se o usuário já existir
    );
});

const qrcodes = {};
const clientes = {};

// INICIALIZADOR DO WHATSAPP (ROBUSTO)
async function initWA(userId) {
    if (clientes[userId]) return;
    
    console.log(`🤖 Iniciando Zap para: ${userId}`);
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: { 
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-extensions'] 
        }
    });

    client.on('qr', (qr) => {
        qrcodes[userId] = qr;
        console.log(`📲 QR Code gerado para ${userId}`);
    });

    client.on('ready', () => {
        qrcodes[userId] = "CONECTADO";
        console.log(`✅ Zap conectado para ${userId}`);
    });

    client.on('message', async msg => {
        if (msg.fromMe) return;
        const user = await User.findById(userId);
        if (user) {
            msg.reply(user.ia);
            await User.findByIdAndUpdate(userId, { $inc: { totalEnviados: 1 } });
        }
    });

    clientes[userId] = client;
    client.initialize().catch(err => console.error("Erro no Zap:", err));
}

// ROTAS DE AUTENTICAÇÃO
app.post("/register", async (req, res) => {
    try {
        const { email, password } = req.body;
        const newUser = await User.create({ email: email.toLowerCase(), password });
        
        // Se for o seu e-mail, já nasce como admin
        if(email.toLowerCase() === ADMIN_EMAIL.toLowerCase()){
            newUser.role = "admin";
            await newUser.save();
        }
        
        res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: "E-mail já cadastrado" }); }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase(), password });
    
    if (!user) return res.status(400).json({ error: "Dados inválidos" });
    
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET);
    initWA(user._id.toString());
    
    res.json({ token, role: user.role });
});

// STATUS DO WHATSAPP
app.get("/status-whatsapp", async (req, res) => {
    try {
        const token = req.headers.authorization;
        const decoded = jwt.verify(token, JWT_SECRET);
        res.json({ status: qrcodes[decoded.id] || "INICIANDO" });
    } catch (e) { res.status(401).send(); }
});

// ROTA MASTER (ADMIN)
app.get("/admin/users", async (req, res) => {
    try {
        const token = req.headers.authorization;
        const decoded = jwt.verify(token, JWT_SECRET);
        
        if (decoded.role !== 'admin') return res.status(403).json({error: "Acesso Negado"});
        
        const users = await User.find({}, 'email totalEnviados role');
        res.json(users.map(u => ({ 
            ...u._doc, 
            status: qrcodes[u._id] || "OFFLINE" 
        })));
    } catch (e) { res.status(401).send(); }
});

// SERVIR FRONTEND
app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor voando na porta ${PORT}`));
