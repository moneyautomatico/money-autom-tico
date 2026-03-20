require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');

const app = express();

app.use(express.json());
app.use(cors());

// 🧪 ROTA TESTE (IMPORTANTE)
app.get("/", (req, res) => {
  res.send("API ONLINE 🚀");
});

// 🔗 CONEXÃO BANCO (SEGURA)
if (process.env.MONGO_URL) {
  mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log("✅ Banco conectado"))
    .catch(err => console.log(err));
} else {
  console.log("⚠️ MONGO_URL não configurado");
}

// 👤 MODEL USER
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  senha: String,
  ativo: { type: Boolean, default: true },
  mensagens: Array,
  delay_min: Number,
  delay_max: Number
});

const User = mongoose.model('User', UserSchema);

// 🔐 REGISTRO
app.post('/register', async (req, res) => {
  try {
    const { email, senha } = req.body;

    const existe = await User.findOne({ email });
    if (existe) {
      return res.status(400).json({ erro: "Email já cadastrado" });
    }

    const hash = await bcrypt.hash(senha, 10);

    const user = await User.create({
      email,
      senha: hash,
      mensagens: [],
      delay_min: 10,
      delay_max: 30
    });

    res.json(user);

  } catch (e) {
    res.status(500).json({ erro: "Erro no registro" });
  }
});

// 🔐 LOGIN
app.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    const ok = await bcrypt.compare(senha, user.senha);
    if (!ok) {
      return res.status(401).json({ erro: "Senha inválida" });
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET || "segredo",
      { expiresIn: '7d' }
    );

    res.json({ user, token });

  } catch (e) {
    res.status(500).json({ erro: "Erro no login" });
  }
});

// 🔐 MIDDLEWARE
function auth(req, res, next) {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ erro: "Sem token" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "segredo");
    req.user_id = decoded.id;
    next();
  } catch {
    res.status(401).json({ erro: "Token inválido" });
  }
}

// 📤 CAMPANHA
app.post('/campanha', auth, async (req, res) => {
  const { numeros } = req.body;

  console.log("📤 Enviando para:", numeros);

  res.json({ ok: true });
});

// 📂 UPLOAD
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

app.post('/upload', upload.single('file'), (req, res) => {
  res.json({ url: `/uploads/${req.file.filename}` });
});

// 🚀 START (CORRIGIDO PARA RAILWAY)
const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Money Automático rodando na porta " + PORT);
});
