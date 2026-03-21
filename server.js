const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path'); 
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = "money_automatico_super_2026";
const MONGO_URI = "mongodb+srv://moneyautomatico_db_user:Milionario2026@moneyautomatico.5bbierw.mongodb.net/money?retryWrites=true&w=majority";
const EMAIL_ADMIN = "tiagoscosta.business@gmail.com"; // Seu e-mail oficial

// Modelo de Usuário
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    ia: { type: String, default: "Olá! Como posso te ajudar?" },
    totalEnviados: { type: Number, default: 0 },
    role: { type: String, default: "user" }
});
const User = mongoose.model("User", UserSchema);

mongoose.connect(MONGO_URI).then(async () => {
    console.log("✅ MongoDB Conectado");
    // Atualiza você como Admin automaticamente
    await User.findOneAndUpdate({ email: EMAIL_ADMIN }, { role: "admin" });
});

const clientes = {}; 
const qrcodes = {}; 

async function inicializarWhatsapp(userId) {
    if (clientes[userId]) return; 
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId, dataPath: './sessions' }),
        puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });

    client.on('qr', (qr) => { qrcodes[userId] = qr; });
    client.on('ready', () => { qrcodes[userId] = "CONECTADO"; });
    
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
    client.initialize().catch(() => {});
}

// Rotas
app.post("/register", async (req, res) => {
    try {
        const { email, password } = req.body;
        const userExist = await User.findOne({ email: email.toLowerCase() });
        if(userExist) return res.status(400).json({ error: "E-mail já cadastrado" });
        await User.create({ email, password });
        res.json({ ok: true });
    } catch { res.status(500).json({ error: "Erro no registro" }); }
});

app.post("/login", async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase(), password: req.body.password });
    if (!user) return res.status(400).json({ error: "Credenciais inválidas" });
    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    inicializarWhatsapp(user._id.toString());
    res.json({ token, role: user.role });
});

function auth(req, res, next) {
    try {
        const token = req.headers.authorization;
        req.userId = jwt.verify(token, JWT_SECRET).id;
        next();
    } catch { res.status(401).json({ error: "Sessão expirada" }); }
}

// Rota para o Admin ver todos
app.get("/admin/users", auth, async (req, res) => {
    const admin = await User.findById(req.userId);
    if(admin.role !== 'admin') return res.status(403).send("Negado");
    const users = await User.find({}, '-password');
    const list = users.map(u => ({ ...u._doc, status: qrcodes[u._id] || "OFFLINE" }));
    res.json(list);
});

app.get("/status-whatsapp", auth, (req, res) => res.json({ status: qrcodes[req.userId] || "INICIANDO" }));
app.get("/user-data", auth, async (req, res) => {
    const user = await User.findById(req.userId);
    res.json({ ia: user.ia, total: user.totalEnviados });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.resolve(__dirname, 'index.html')));

app.listen(process.env.PORT || 8080, '0.0.0.0');
