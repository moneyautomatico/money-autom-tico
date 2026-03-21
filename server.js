require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// ======================
// 🔗 BANCO
// ======================
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("✅ Banco conectado"))
  .catch(err => console.log("❌ ERRO MONGO:", err));

// ======================
// 🤖 OPENAI
// ======================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ======================
// 👤 MODEL
// ======================
const UserSchema = new mongoose.Schema({
  email: String,
  senha: String,
  admin: { type: Boolean, default: false },
  ia_treinamento: { type: String, default: "" }
});

const User = mongoose.model('User', UserSchema);

// ======================
// 🔐 AUTH
// ======================
function auth(req, res, next) {
  const token = req.headers.authorization;

  if (!token) return res.status(401).json({ erro: "Sem token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user_id = decoded.id;
    next();
  } catch {
    res.status(401).json({ erro: "Token inválido" });
  }
}

// ======================
// 🔐 REGISTER
// ======================
app.post('/register', async (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.json({ erro: "Preencha todos os campos" });
  }

  const hash = await bcrypt.hash(senha, 10);

  await User.create({
    email,
    senha: hash
  });

  res.json({ msg: "Conta criada com sucesso" });
});

// ======================
// 🔐 LOGIN
// ======================
app.post('/login', async (req, res) => {
  const { email, senha } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.json({ erro: "Usuário não encontrado" });

  const ok = await bcrypt.compare(senha, user.senha);
  if (!ok) return res.json({ erro: "Senha inválida" });

  const token = jwt.sign(
    { id: user._id },
    process.env.JWT_SECRET
  );

  res.json({
    token,
    admin: user.admin
  });
});

// ======================
// 🤖 IA - SALVAR TREINO
// ======================
app.post('/ia/salvar', auth, async (req, res) => {
  await User.findByIdAndUpdate(req.user_id, {
    ia_treinamento: req.body.texto
  });

  res.json({ msg: "IA salva com sucesso" });
});

// ======================
// 🤖 IA - BUSCAR TREINO
// ======================
app.get('/ia', auth, async (req, res) => {
  const user = await User.findById(req.user_id);
  res.json({ texto: user.ia_treinamento });
});

// ======================
// 🤖 IA - RESPONDER (BOT EXTERNO)
// ======================
app.post('/ia/responder', async (req, res) => {
  try {
    const user = await User.findOne();

    if (!user || !user.ia_treinamento) {
      return res.json({ resposta: "IA não configurada." });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `Você é um atendente profissional. ${user.ia_treinamento}`
        },
        {
          role: "user",
          content: req.body.mensagem
        }
      ]
    });

    res.json({
      resposta: response.choices[0].message.content
    });

  } catch (err) {
    console.log("❌ ERRO IA:", err.message);
    res.json({ resposta: "Erro na IA" });
  }
});

// ======================
// 📱 WHATSAPP (AGORA EXTERNO)
// ======================
app.get('/whatsapp/connect', auth, (req, res) => {
  res.json({
    msg: "Use o bot externo para conectar o WhatsApp",
    user_id: req.user_id
  });
});

// ======================
// 🏠 ROTA PRINCIPAL (SITE)
// ======================
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// ======================
// 🚀 START
// ======================
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("🚀 Servidor rodando na porta " + PORT);
});
