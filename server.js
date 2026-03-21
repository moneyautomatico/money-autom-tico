const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path'); 
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.json());
app.use(cors());

// ==================== CONFIGURAÇÕES ====================
const JWT_SECRET = "money_automatico_2026";
const MONGO_URI = "mongodb+srv://moneyautomatico_db_user:Milionario2026@moneyautomatico.5bbierw.mongodb.net/money?retryWrites=true&w=majority";

// ==================== MODELO DE USUÁRIO ====================
const UserSchema = new mongoose.Schema({
    email: String,
    password: { type: String, required: true },
    ia: { type: String, default: "" }
});
const User = mongoose.model("User", UserSchema);

// ==================== CONEXÃO MONGODB + AUTO-CREATE ====================
mongoose.connect(MONGO_URI)
.then(async () => {
    console.log("✅ MongoDB conectado");

    const adminEmail = "Presidente.business@hotmail.com";
    const adminPass = "123456"; 

    // Tenta deletar se existir algo errado e cria do zero
    await User.deleteOne({ email: adminEmail }); 
    await User.create({ 
        email: adminEmail, 
        password: adminPass, 
        ia: "IA Ativa" 
    });

    console.log("🚀 USUÁRIO MESTRE RESETADO E CRIADO: " + adminEmail);
})
.catch(err => console.log("❌ Erro MongoDB:", err));

// ==================== MOTOR WHATSAPP ====================
let qrCodeAtual = ""; 
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './sessions' }), 
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => { qrCodeAtual = qr; });
client.on('ready', () => { qrCodeAtual = "CONECTADO"; console.log('✅ WhatsApp Pronto!'); });
client.initialize();

// ==================== MIDDLEWARE AUTH ====================
function auth(req, res, next) {
    const token = req.headers.authorization;
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch { res.status(401).json({ error: "Token inválido" }); }
}

// ==================== ROTAS API ====================
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (!user) return res.status(400).json({ error: "Usuário ou senha incorretos" });
    
    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    res.json({ token, userId: user._id });
});

app.get("/status-whatsapp", auth, (req, res) => res.json({ status: qrCodeAtual }));

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

// ==================== FRONTEND ====================
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.resolve(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Rodando na porta " + PORT));
