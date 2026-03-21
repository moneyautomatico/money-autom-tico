require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');

const app = express();

// 🔧 MIDDLEWARES
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// 🔗 BANCO
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("✅ Banco conectado"))
  .catch(err => console.log("❌ ERRO MONGO:", err));

// 👤 MODEL
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  senha: { type: String, required: true },
  admin: { type: Boolean, default: false },
  ativo: { type: Boolean, default: true },
  mensagens: { type: Array, default: [] },
  ia_treinamento: { type: String, default: "" },
  delay_min: { type: Number, default: 5 },
  delay_max: { type: Number, default: 15 }
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);

// 🔐 AUTH
function auth(req, res, next) {
  const token = req.headers.authorization;

  if (!token) return res.status(401).json({ erro: "Sem token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "segredo");
    req.user_id = decoded.id;
    next();
  } catch {
    res.status(401).json({ erro: "Token inválido" });
  }
}

// 👑 ADMIN
async function adminOnly(req, res, next) {
  const user = await User.findById(req.user_id);
  if (!user || !user.admin) {
    return res.status(403).json({ erro: "Acesso restrito" });
  }
  next();
}

// 🔐 REGISTER
app.post('/register', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ erro: "Dados obrigatórios" });
    }

    const existe = await User.findOne({ email });
    if (existe) return res.status(400).json({ erro: "Email já existe" });

    const hash = await bcrypt.hash(senha, 10);

    await User.create({ email, senha: hash });

    res.json({ msg: "Conta criada com sucesso" });

  } catch (e) {
    console.log(e);
    res.status(500).json({ erro: "Erro no registro" });
  }
});

// 🔐 LOGIN
app.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ erro: "Usuário não encontrado" });

    const ok = await bcrypt.compare(senha, user.senha);
    if (!ok) return res.status(401).json({ erro: "Senha inválida" });

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET || "segredo",
      { expiresIn: '7d' }
    );

    res.json({ token, admin: user.admin });

  } catch (e) {
    res.status(500).json({ erro: "Erro no login" });
  }
});

// 🤖 SALVAR IA
app.post('/ia/salvar', auth, async (req, res) => {
  const { texto } = req.body;

  await User.findByIdAndUpdate(req.user_id, {
    ia_treinamento: texto
  });

  res.json({ msg: "IA salva" });
});

// 🤖 BUSCAR IA
app.get('/ia', auth, async (req, res) => {
  const user = await User.findById(req.user_id);
  res.json({ texto: user.ia_treinamento });
});

// 📤 CAMPANHA
app.post('/campanha', auth, async (req, res) => {
  const { numeros, mensagem } = req.body;

  if (!numeros || !mensagem) {
    return res.status(400).json({ erro: "Dados inválidos" });
  }

  console.log("🚀 Iniciando campanha...");

  numeros.forEach(n => {
    console.log("Enviando para:", n);
  });

  res.json({ msg: "Campanha iniciada" });
});

// 👑 ADMIN USERS
app.get('/admin/users', auth, adminOnly, async (req, res) => {
  const users = await User.find().select('-senha');
  res.json(users);
});

// 🚀 START
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("🚀 Servidor rodando na porta " + PORT);
});
