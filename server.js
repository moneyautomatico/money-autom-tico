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

// ==================== CONEXÃO MONGODB ====================
mongoose.connect(MONGO_URI)
.then(() => console.log("✅ MongoDB conectado com sucesso"))
.catch(err => console.log("❌ Erro ao conectar no MongoDB:", err));

// ==================== MODELO DE USUÁRIO ====================
const UserSchema = new mongoose.Schema({
    email: String,
    password: { type: String, required: true },
    ia: { type: String, default: "" }
});

const User = mongoose.model("User", UserSchema);

// ==================== MOTOR WHATSAPP (ESTÁVEL) ====================
let qrCodeAtual = ""; 

const client = new Client({
    // LocalAuth salva a sessão na pasta './sessions' para não deslogar ao reiniciar
    authStrategy: new LocalAuth({ dataPath: './sessions' }), 
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => {
    qrCodeAtual = qr; 
    console.log('📱 QR Code gerado! Acesse o painel /admin para escanear.');
});

client.on('ready', () => {
    qrCodeAtual = "CONECTADO";
    console.log('✅ WhatsApp pronto para disparos!');
});

client.on('disconnected', (reason) => {
    qrCodeAtual = "";
    console.log('❌ WhatsApp desconectado:', reason);
    client.initialize(); // Tenta reiniciar automaticamente
});

client.initialize();

// ==================== MIDDLEWARE DE AUTENTICAÇÃO ====================
function auth(req, res, next) {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ error: "Acesso negado. Sem token." });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch {
        res.status(401).json({ error: "Token inválido ou expirado." });
    }
}

// ==================== ROTAS DE API ====================

// ROTA DE LOGIN (Sincronizada com Admin e Index)
app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email, password });

        if (!user) {
            return res.status(400).json({ error: "E-mail ou senha incorretos." });
        }

        const token = jwt.sign({ id: user._id }, JWT_SECRET);
        res.json({ token, userId: user._id });
    } catch (err) {
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// STATUS DO WHATSAPP (Usado pelo admin.html)
app.get("/status-whatsapp", auth, (req, res) => {
    res.json({ status: qrCodeAtual });
});

// DADOS DO USUÁRIO
app.get("/user", auth, async (req, res) => {
    const user = await User.findById(req.userId).select("-password");
    res.json(user);
});

// SALVAR E CARREGAR CONFIGURAÇÕES DE IA
app.post("/salvar-ia", auth, async (req, res) => {
    const { texto } = req.body;
    await User.findByIdAndUpdate(req.userId, { ia: texto });
    res.json({ ok: true });
});

app.get("/carregar-ia", auth, async (req, res) => {
    const user = await User.findById(req.userId);
    res.json({ texto: user.ia || "" });
});

// SISTEMA DE DISPARO EM MASSA
app.post("/disparo", auth, async (req, res) => {
    const { numeros, mensagem } = req.body;
    if (qrCodeAtual !== "CONECTADO") {
        return res.status(400).json({ error: "WhatsApp não está conectado." });
    }

    try {
        const lista = numeros.split(',');
        for (let numero of lista) {
            let num = numero.trim();
            if (!num.includes("@c.us")) num += "@c.us";
            await client.sendMessage(num, mensagem);
        }
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: "Falha no disparo. Tente novamente." });
    }
});

// ==================== SERVIDOR DE ARQUIVOS (FRONTEND) ====================

// 1. Serve arquivos da pasta public (CSS, JS, Imagens, Admin.html)
app.use(express.static(path.join(__dirname, 'public')));

// 2. ROTA PRINCIPAL: Serve o index.html que está na RAIZ
app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'index.html'));
});

// 3. ROTA ADMIN: Serve o admin.html que está em public
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ==================== INICIALIZAÇÃO ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Sistema rodando em: http://localhost:${PORT}`);
});
