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
    email: { type: String, required: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    ia: { type: String, default: "Olá! Como posso ajudar?" }
});
const User = mongoose.model("User", UserSchema);

// ==================== CONEXÃO MONGODB + NOVO USUÁRIO ====================
mongoose.connect(MONGO_URI)
.then(async () => {
    console.log("✅ MongoDB conectado");
    const adminEmail = "tiagoscosta.business@gmail.com";
    const adminPass = "123456"; 

    // Limpa registros antigos e cria o seu usuário novo
    await User.deleteMany({ email: adminEmail }); 
    await User.create({ email: adminEmail, password: adminPass, ia: "IA Ativa: Olá!" });
    console.log("🚀 USUÁRIO MESTRE ATUALIZADO: " + adminEmail);
})
.catch(err => console.log("❌ Erro MongoDB:", err));

// ==================== MOTOR WHATSAPP (OTIMIZADO) ====================
let qrCodeAtual = ""; 
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './sessions' }), 
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process', '--disable-gpu']
    }
});

client.on('qr', (qr) => { qrCodeAtual = qr; });
client.on('ready', () => { qrCodeAtual = "CONECTADO"; console.log('✅ WhatsApp Conectado!'); });

// IA responde automaticamente
client.on('message', async msg => {
    if (msg.fromMe) return; 
    try {
        const user = await User.findOne({ email: "tiagoscosta.business@gmail.com" });
        if (user && user.ia) await msg.reply(user.ia);
    } catch (err) { console.log("Erro IA:", err); }
});

client.initialize().catch(err => console.log("Erro WhatsApp:", err));

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
    const email = (req.body.email || "").toLowerCase().trim();
    const password = (req.body.password || req.body.senha || "").toString().trim();
    const user = await User.findOne({ email, password });
    if (!user) return res.status(400).json({ error: "Dados incorretos" });
    
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Porta: ${PORT}`));
