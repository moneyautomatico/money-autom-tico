const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path'); 
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.json());
app.use(cors());

// ==================== CONFIG ====================
const JWT_SECRET = "money_automatico_2026";
const MONGO_URI = "mongodb+srv://moneyautomatico_db_user:Milionario2026@moneyautomatico.5bbierw.mongodb.net/money?retryWrites=true&w=majority";

// ==================== MONGODB ====================
mongoose.connect(MONGO_URI)
.then(() => console.log("✅ MongoDB conectado"))
.catch(err => console.log("❌ Erro MongoDB:", err));

// ==================== MODELS ====================
const UserSchema = new mongoose.Schema({
    email: String,
    password: String,
    ia: String
});

const User = mongoose.model("User", UserSchema);

// ==================== WHATSAPP (VERSÃO ESTÁVEL) ====================
let qrCodeAtual = ""; // Variável para armazenar o QR Code e enviar para o Admin

const client = new Client({
    // LocalAuth com dataPath garante que a sessão não caia ao reiniciar o servidor
    authStrategy: new LocalAuth({ dataPath: './sessions' }), 
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer'
        ]
    }
});

client.on('qr', (qr) => {
    qrCodeAtual = qr; // Salva o QR para o Frontend buscar via API
    console.log('📱 QR Code gerado. Disponível no painel admin.');
});

client.on('ready', () => {
    qrCodeAtual = "CONECTADO";
    console.log('✅ WhatsApp conectado!');
});

client.initialize();

// ==================== AUTH MIDDLEWARE ====================
function auth(req, res, next) {
    const token = req.headers.authorization;

    if (!token) return res.status(401).json({ error: "Sem token" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch {
        res.status(401).json({ error: "Token inválido" });
    }
}

// ==================== ROTAS DE API ====================

// LOGIN
app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email, password });

        if (!user) {
            return res.status(400).json({ error: "Erro no login" });
        }

        const token = jwt.sign({ id: user._id }, JWT_SECRET);

        res.json({
            token,
            userId: user._id
        });
    } catch (err) {
        res.status(500).json({ error: "Erro interno no servidor" });
    }
});

// STATUS WHATSAPP (Para o admin.html verificar conexão)
app.get("/status-whatsapp", auth, (req, res) => {
    res.json({ status: qrCodeAtual });
});

// PEGAR DADOS DO USUÁRIO
app.get("/user", auth, async (req, res) => {
    const user = await User.findById(req.userId);
    res.json(user);
});

// SALVAR IA
app.post("/salvar-ia", auth, async (req, res) => {
    const { texto } = req.body;
    await User.findByIdAndUpdate(req.userId, { ia: texto });
    res.json({ ok: true });
});

// CARREGAR IA
app.get("/carregar-ia", auth, async (req, res) => {
    const user = await User.findById(req.userId);
    res.json({ texto: user.ia || "" });
});

// DISPARO WHATSAPP
app.post("/disparo", auth, async (req, res) => {
    const { numeros, mensagem } = req.body;

    try {
        const lista = numeros.split(',');

        for (let numero of lista) {
            let num = numero.trim();

            if (!num.includes("@c.us")) {
                num = num + "@c.us";
            }

            await client.sendMessage(num, mensagem);
        }

        res.json({ ok: true });

    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Erro ao enviar mensagens. Verifique se o WhatsApp está conectado." });
    }
});

// ==================== FRONTEND (ESTÁTICO) ====================

// Servir arquivos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Rota principal para evitar "Cannot GET /"
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== SERVIDOR ====================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("🚀 Servidor de Alta Performance rodando na porta " + PORT);
});
