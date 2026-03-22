require('dotenv').config();

const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const qrcode     = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const puppeteer  = require('puppeteer-core');

// ─────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────
const app        = express();
const PORT       = process.env.PORT       || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'chave_secreta_troque';
const MONGO_URI  = process.env.MONGO_URI  || 'mongodb://localhost:27017/money-partner';

// Caminho do Chrome já instalado na imagem ghcr.io/puppeteer/puppeteer
const CHROME_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable';

// ─────────────────────────────────────────────────
// MIDDLEWARES
// ─────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────
// MONGODB — CONEXÃO
// ─────────────────────────────────────────────────
mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB conectado'))
  .catch(err => console.error('❌ Erro MongoDB:', err));

// ─────────────────────────────────────────────────
// MODELS
// ─────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  email:     { type: String, required: true, unique: true },
  password:  { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const User = mongoose.model('User', UserSchema);

const LeadSchema = new mongoose.Schema({
  name:      String,
  phone:     { type: String, required: true, unique: true },
  status:    { type: String, enum: ['novo', 'contatado', 'convertido'], default: 'novo' },
  createdAt: { type: Date, default: Date.now },
});
const Lead = mongoose.model('Lead', LeadSchema);

const MensagemSchema = new mongoose.Schema({
  leadId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  texto:     { type: String, required: true },
  enviada:   { type: Boolean, default: false },
  enviadaEm: { type: Date },
  createdAt: { type: Date, default: Date.now },
});
const Mensagem = mongoose.model('Mensagem', MensagemSchema);

// ─────────────────────────────────────────────────
// WHATSAPP — CLIENTE
// ─────────────────────────────────────────────────
let whatsappReady = false;
let whatsappQR    = null;

const wppClient = new Client({
  authStrategy: new LocalAuth({ dataPath: '/app/.wpp_session' }),
  puppeteer: {
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  },
});

wppClient.on('qr', qr => {
  whatsappQR = qr;
  qrcode.generate(qr, { small: true });
  console.log('📱 QR Code gerado — acesse GET /whatsapp/qr para visualizar');
});

wppClient.on('ready', () => {
  whatsappReady = true;
  whatsappQR    = null;
  console.log('✅ WhatsApp conectado!');
});

wppClient.on('disconnected', reason => {
  whatsappReady = false;
  console.warn('⚠️  WhatsApp desconectado:', reason);
  wppClient.initialize();
});

wppClient.initialize();

// ─────────────────────────────────────────────────
// MIDDLEWARE JWT
// ─────────────────────────────────────────────────
function autenticar(req, res, next) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(403).json({ error: 'Token inválido ou expirado.' });
  }
}

// ─────────────────────────────────────────────────
// ROTAS — AUTH
// ─────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Money Partner Pro 2026',
    whatsapp: whatsappReady ? 'conectado' : 'aguardando',
  });
});

// Cadastro
app.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Preencha todos os campos.' });

    if (await User.findOne({ email }))
      return res.status(409).json({ error: 'E-mail já cadastrado.' });

    const hashed = await bcrypt.hash(password, 10);
    const user   = await User.create({ name, email, password: hashed });

    return res.status(201).json({
      message: 'Usuário criado!',
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// Login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Informe e-mail e senha.' });

    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Credenciais inválidas.' });

    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, {
      expiresIn: '1d',
    });

    return res.json({
      message: 'Login realizado!',
      token,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// Perfil
app.get('/profile', autenticar, async (req, res) => {
  const user = await User.findById(req.userId).select('-password');
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  return res.json(user);
});

// ─────────────────────────────────────────────────
// ROTAS — LEADS
// ─────────────────────────────────────────────────

// Listar leads
app.get('/leads', autenticar, async (req, res) => {
  const leads = await Lead.find().sort({ createdAt: -1 });
  return res.json(leads);
});

// Criar lead
app.post('/leads', autenticar, async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Telefone obrigatório.' });

    const lead = await Lead.create({ name, phone });
    return res.status(201).json(lead);
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({ error: 'Telefone já cadastrado.' });
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// Atualizar status do lead
app.patch('/leads/:id/status', autenticar, async (req, res) => {
  const { status } = req.body;
  const lead = await Lead.findByIdAndUpdate(
    req.params.id,
    { status },
    { new: true }
  );
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
  return res.json(lead);
});

// ─────────────────────────────────────────────────
// ROTAS — WHATSAPP
// ─────────────────────────────────────────────────

// Status do WhatsApp
app.get('/whatsapp/status', autenticar, (req, res) => {
  res.json({ conectado: whatsappReady });
});

// QR Code (texto) para escanear
app.get('/whatsapp/qr', (req, res) => {
  if (whatsappReady) return res.json({ message: 'WhatsApp já está conectado.' });
  if (!whatsappQR)   return res.json({ message: 'Aguardando geração do QR...' });
  return res.json({ qr: whatsappQR });
});

// Enviar mensagem avulsa
app.post('/whatsapp/enviar', autenticar, async (req, res) => {
  const { phone, message } = req.body;

  if (!phone || !message)
    return res.status(400).json({ error: 'Informe phone e message.' });

  if (!whatsappReady)
    return res.status(503).json({ error: 'WhatsApp não está conectado.' });

  try {
    // Formato: 5511999999999@c.us
    const chatId = phone.replace(/\D/g, '') + '@c.us';
    await wppClient.sendMessage(chatId, message);

    // Salva no banco
    const lead = await Lead.findOne({ phone });
    if (lead) {
      await Mensagem.create({ leadId: lead._id, texto: message, enviada: true, enviadaEm: new Date() });
      await Lead.findByIdAndUpdate(lead._id, { status: 'contatado' });
    }

    return res.json({ success: true, message: 'Mensagem enviada!' });
  } catch (err) {
    console.error('Erro ao enviar mensagem:', err);
    return res.status(500).json({ error: 'Falha ao enviar mensagem.' });
  }
});

// Disparo em massa para todos os leads "novo"
app.post('/whatsapp/disparar', autenticar, async (req, res) => {
  const { mensagem } = req.body;

  if (!mensagem)
    return res.status(400).json({ error: 'Informe o campo mensagem.' });

  if (!whatsappReady)
    return res.status(503).json({ error: 'WhatsApp não está conectado.' });

  const leads = await Lead.find({ status: 'novo' });
  if (!leads.length)
    return res.json({ message: 'Nenhum lead novo para disparar.' });

  let enviados = 0;
  let erros    = 0;

  for (const lead of leads) {
    try {
      const chatId = lead.phone.replace(/\D/g, '') + '@c.us';
      await wppClient.sendMessage(chatId, mensagem);
      await Mensagem.create({ leadId: lead._id, texto: mensagem, enviada: true, enviadaEm: new Date() });
      await Lead.findByIdAndUpdate(lead._id, { status: 'contatado' });
      enviados++;
      // Delay entre mensagens para evitar bloqueio
      await new Promise(r => setTimeout(r, 2000));
    } catch {
      erros++;
    }
  }

  return res.json({ enviados, erros, total: leads.length });
});

// Histórico de mensagens de um lead
app.get('/leads/:id/mensagens', autenticar, async (req, res) => {
  const msgs = await Mensagem.find({ leadId: req.params.id }).sort({ createdAt: 1 });
  return res.json(msgs);
});

// ─────────────────────────────────────────────────
// ROTA — PUPPETEER (screenshot)
// ─────────────────────────────────────────────────
app.post('/screenshot', autenticar, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Informe a URL.' });

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
    return res.json({ screenshot: `data:image/png;base64,${screenshot}` });
  } catch (err) {
    console.error('Puppeteer erro:', err);
    return res.status(500).json({ error: 'Falha ao capturar screenshot.' });
  } finally {
    if (browser) await browser.close();
  }
});

// ─────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Money Partner Pro 2026 rodando na porta ${PORT}`);
});
