require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// 🔗 BANCO
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("✅ Banco conectado"))
  .catch(err => console.log("❌ ERRO MONGO:", err));

// 👤 MODEL
const UserSchema = new mongoose.Schema({
  email: String,
  senha: String,
  admin: { type: Boolean, default: false },
  ia_treinamento: { type: String, default: "" }
});

const User = mongoose.model('User', UserSchema);

// 🔐 AUTH
function auth(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ erro: "Sem token" });

  try {
    const decoded = jwt.verify(token, "segredo");
    req.user_id = decoded.id;
    next();
  } catch {
    res.status(401).json({ erro: "Token inválido" });
  }
}

// 🔐 REGISTER
app.post('/register', async (req, res) => {
  const { email, senha } = req.body;

  const hash = await bcrypt.hash(senha, 10);

  await User.create({ email, senha: hash });

  res.json({ msg: "Conta criada" });
});

// 🔐 LOGIN
app.post('/login', async (req, res) => {
  const { email, senha } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.json({ erro: "Usuário não encontrado" });

  const ok = await bcrypt.compare(senha, user.senha);
  if (!ok) return res.json({ erro: "Senha inválida" });

  const token = jwt.sign({ id: user._id }, "segredo");

  res.json({ token, admin: user.admin });
});

// 🤖 SALVAR IA
app.post('/ia/salvar', auth, async (req, res) => {
  await User.findByIdAndUpdate(req.user_id, {
    ia_treinamento: req.body.texto
  });

  res.json({ msg: "IA salva" });
});

// 🤖 GET IA
app.get('/ia', auth, async (req, res) => {
  const user = await User.findById(req.user_id);
  res.json({ texto: user.ia_treinamento });
});

// =======================
// 📱 WHATSAPP
// =======================

const client = new Client({
  authStrategy: new LocalAuth()
});

client.on('qr', qr => {
  console.log('📲 ESCANEIE O QR CODE:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp conectado!');
});

// 🧠 IA RESPONDENDO
client.on('message', async msg => {

  try {
    const user = await User.findOne(); // 🔥 MVP (1 usuário)

    if (!user || !user.ia_treinamento) return;

    const resposta = gerarResposta(user.ia_treinamento, msg.body);

    msg.reply(resposta);

  } catch (e) {
    console.log(e);
  }

});

// 🤖 FUNÇÃO IA SIMPLES
function gerarResposta(treino, mensagem) {
  return `🤖 Atendimento automático:\n\n${treino}\n\n📩 Você disse: ${mensagem}`;
}

client.initialize();

// 🚀 START
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("🚀 Servidor rodando na porta " + PORT);
});
