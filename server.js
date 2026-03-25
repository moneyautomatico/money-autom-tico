require('dotenv').config();

const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const qrcode     = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const puppeteer  = require('puppeteer-core');

// ─────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────
const app        = express();
const PORT       = process.env.PORT       || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'chave_secreta_troque';
const MONGO_URI  = process.env.MONGO_URI  || 'mongodb://localhost:27017/money-partner';

const CHROME_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/usr/bin/google-chrome-stable'       ||
  '/usr/bin/google-chrome';

// ─────────────────────────────────────────────────
// MIDDLEWARES
// ─────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

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
  name:             { type: String, required: true },
  email:            { type: String, required: true, unique: true },
  password:         { type: String, required: true },
  iaResumo:         { type: String, default: '' },
  baseAprendizado:  { type: String, default: '' },
  createdAt:        { type: Date, default: Date.now },
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
// ✅ FIX PRINCIPAL: protocolTimeout 300s + args extras para containers
// ─────────────────────────────────────────────────
let whatsappReady = false;
let whatsappQR    = null;
let wppInicializado = false;

function criarCliente() {
  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: '/tmp/.wpp_session',
    }),
    puppeteer: {
      executablePath: CHROME_PATH,
      headless: true,
      // ✅ FIX: aumentado para 300s — resolve o callFunctionOn timed out
      protocolTimeout: 300000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--no-first-run',
        // ✅ FIX: essenciais para Railway/Docker com pouca RAM
        '--single-process',
        '--no-zygote',
        '--disable-accelerated-2d-canvas',
        '--disable-web-security',
        // ✅ FIX: resolve "Requesting main frame too early" em containers
        '--disable-features=site-per-process,TranslateUI',
        '--renderer-process-limit=1',
        '--disable-ipc-flooding-protection',
        '--memory-pressure-off',
        '--js-flags=--max-old-space-size=512',
      ],
    },
  });

  client.on('qr', qr => {
    whatsappQR = qr;
    qrcode.generate(qr, { small: true });
    console.log('📱 QR Code gerado — acesse GET /whatsapp/qr para visualizar');
  });

  client.on('ready', () => {
    whatsappReady = true;
    whatsappQR    = null;
    console.log('✅ WhatsApp conectado!');
  });

  client.on('disconnected', reason => {
    whatsappReady = false;
    console.warn('⚠️  WhatsApp desconectado:', reason);
    // Aguarda 5s antes de tentar reconectar
    setTimeout(() => {
      console.log('🔄 Tentando reconectar WhatsApp...');
      client.initialize().catch(e => console.error('Erro ao reinicializar:', e));
    }, 5000);
  });

  client.on('auth_failure', msg => {
    console.error('❌ Falha de autenticação WhatsApp:', msg);
    whatsappReady = false;
  });

  return client;
}

const wppClient = criarCliente();

// ✅ FIX: aguarda 10s antes de inicializar — dá tempo ao container subir completamente
setTimeout(() => {
  console.log('🔄 Iniciando WhatsApp...');
  wppClient.initialize().catch(err => {
    console.error('❌ Erro ao inicializar WhatsApp:', err.message);
  });
}, 10000);

// ─────────────────────────────────────────────────
// ESTADO EM MEMÓRIA — DISPARO
// ─────────────────────────────────────────────────
let disparo = {
  status:  'idle',
  atual:   0,
  total:   0,
  pausado: false,
  logs:    [],
  stats:   { total: 0, sucesso: 0, erro: 0, taxa: 0 },
};

// ─────────────────────────────────────────────────
// ESTADO EM MEMÓRIA — CHATS RECEBIDOS
// ─────────────────────────────────────────────────
let chatsMemoria = [];

wppClient.on('message', msg => {
  chatsMemoria.push({
    tipo: 'recebida',
    de:   msg.from.replace('@c.us', ''),
    txt:  msg.body,
    hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  });
  if (chatsMemoria.length > 200) chatsMemoria.shift();
});

// ─────────────────────────────────────────────────
// MIDDLEWARE JWT
// ─────────────────────────────────────────────────
function autenticar(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : header;
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
      user: { id: user._id, name: user.name, email: user.email, iaResumo: user.iaResumo, baseAprendizado: user.baseAprendizado },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

app.get('/profile', autenticar, async (req, res) => {
  const user = await User.findById(req.userId).select('-password');
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  return res.json(user);
});

// ─────────────────────────────────────────────────
// ROTAS — LEADS
// ─────────────────────────────────────────────────
app.get('/leads', autenticar, async (req, res) => {
  const leads = await Lead.find().sort({ createdAt: -1 });
  return res.json(leads);
});

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
app.get('/whatsapp/status', autenticar, (req, res) => {
  res.json({ conectado: whatsappReady });
});

app.get('/whatsapp/qr', (req, res) => {
  if (whatsappReady) return res.json({ message: 'WhatsApp já está conectado.' });
  if (!whatsappQR)   return res.json({ message: 'Aguardando geração do QR...' });
  return res.json({ qr: whatsappQR });
});

app.post('/whatsapp/enviar', autenticar, async (req, res) => {
  const { phone, message } = req.body;

  if (!phone || !message)
    return res.status(400).json({ error: 'Informe phone e message.' });

  if (!whatsappReady)
    return res.status(503).json({ error: 'WhatsApp não está conectado.' });

  try {
    const chatId = phone.replace(/\D/g, '') + '@c.us';
    await wppClient.sendMessage(chatId, message);

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
      await new Promise(r => setTimeout(r, 2000));
    } catch {
      erros++;
    }
  }

  return res.json({ enviados, erros, total: leads.length });
});

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
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote'],
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
// ROTAS — FRONTEND
// ─────────────────────────────────────────────────
app.get('/sync', autenticar, (req, res) => {
  if (whatsappReady)  return res.json({ status: 'READY' });
  if (whatsappQR)     return res.json({ status: whatsappQR });
  return res.json({ status: 'DISCONNECTED' });
});

app.post('/save-config', autenticar, async (req, res) => {
  const { iaResumo, baseAprendizado } = req.body;
  await User.findByIdAndUpdate(req.userId, { iaResumo, baseAprendizado });
  return res.json({ ok: true });
});

// ─────────────────────────────────────────────────
// ROTA — /disparar com retry automático
// ─────────────────────────────────────────────────
app.post('/disparar', autenticar, async (req, res) => {
  const { numeros, mensagem, intervalo, agendarEm, imagemBase64, imagemMime, imagemNome } = req.body;

  if (!numeros || !mensagem)
    return res.status(400).json({ error: 'Informe números e mensagem.' });

  if (!whatsappReady)
    return res.status(503).json({ error: 'WhatsApp ainda não está conectado. Aguarde o QR ser escaneado e tente novamente.' });

  const lista = numeros.split('\n').map(n => n.trim()).filter(Boolean);
  if (!lista.length)
    return res.status(400).json({ error: 'Nenhum número válido informado.' });

  disparo = { status: 'rodando', atual: 0, total: lista.length, pausado: false, logs: [], stats: { total: 0, sucesso: 0, erro: 0, taxa: 0 } };

  if (agendarEm) {
    const agendadoEm = new Date(agendarEm).getTime();
    const agora      = Date.now();
    if (agendadoEm > agora) {
      disparo.status = 'agendado';
      setTimeout(() => executarDisparo(lista, mensagem, intervalo, imagemBase64, imagemMime, imagemNome), agendadoEm - agora);
      return res.json({ msg: 'Disparo agendado!' });
    }
  }

  executarDisparo(lista, mensagem, intervalo, imagemBase64, imagemMime, imagemNome);
  return res.json({ msg: 'Disparo iniciado!' });
});

async function executarDisparo(lista, mensagem, intervalo, imagemBase64, imagemMime, imagemNome) {
  disparo.status = 'rodando';
  const delay = (parseInt(intervalo) || 30) * 1000;

  for (let i = 0; i < lista.length; i++) {
    if (disparo.status === 'cancelado') break;

    while (disparo.pausado) {
      await new Promise(r => setTimeout(r, 1000));
      if (disparo.status === 'cancelado') break;
    }

    const numero      = lista[i];
    const numeroLimpo = numero.replace('@c.us', '').replace(/\D/g, '');
    const chatId      = numeroLimpo + '@c.us';

    const texto = mensagem.replace(/\{([^}]+)\}/g, (_, ops) => {
      const opcoes = ops.split('|');
      return opcoes[Math.floor(Math.random() * opcoes.length)];
    });

    // Retry com 3 tentativas e backoff
    try {
      let tentativas = 0;
      let enviado    = false;

      while (tentativas < 3 && !enviado) {
        try {
          if (imagemBase64) {
            const media = new MessageMedia(imagemMime, imagemBase64, imagemNome);
            await wppClient.sendMessage(chatId, media, { caption: texto });
          } else {
            await wppClient.sendMessage(chatId, texto);
          }
          enviado = true;
        } catch (errTentativa) {
          tentativas++;
          if (tentativas >= 3) throw errTentativa;
          console.warn(`⚠️ Tentativa ${tentativas} falhou para ${numero}. Aguardando ${5 * tentativas}s...`);
          await new Promise(r => setTimeout(r, 5000 * tentativas));
        }
      }

      disparo.logs.push({ numero, status: '✅ Enviado' });
      disparo.stats.sucesso++;
      chatsMemoria.push({
        tipo: 'enviada',
        de:   numero,
        txt:  texto,
        hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      });
    } catch (err) {
      disparo.logs.push({ numero, status: `❌ Erro: ${err.message || 'falha'}` });
      disparo.stats.erro++;
    }

    disparo.atual       = i + 1;
    disparo.stats.total = disparo.atual;
    disparo.stats.taxa  = Math.round((disparo.stats.sucesso / disparo.atual) * 100);

    if (i < lista.length - 1) await new Promise(r => setTimeout(r, delay));
  }

  if (disparo.status !== 'cancelado') disparo.status = 'finalizado';
}

app.get('/progresso', autenticar, (req, res) => {
  return res.json({
    status:  disparo.status,
    atual:   disparo.atual,
    total:   disparo.total,
    pausado: disparo.pausado,
  });
});

app.get('/logs-envio', autenticar, (req, res) => {
  return res.json(disparo.logs.slice(-100));
});

app.post('/pausar', autenticar, (req, res) => {
  disparo.pausado = !disparo.pausado;
  return res.json({ pausado: disparo.pausado });
});

app.post('/cancelar', autenticar, (req, res) => {
  disparo.status  = 'cancelado';
  disparo.pausado = false;
  return res.json({ ok: true });
});

app.get('/chats', autenticar, (req, res) => {
  return res.json(chatsMemoria.slice(-100));
});

app.get('/stats', autenticar, (req, res) => {
  return res.json(disparo.stats);
});

// ─────────────────────────────────────────────────
// ✅ SEGURANÇA: rota /setup-admin removida de produção
// ─────────────────────────────────────────────────

// ─────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Money Partner Pro 2026 rodando na porta ${PORT}`);
});
