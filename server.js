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

// 🧪 ROTA TESTE
app.get("/", (req, res) => {
  res.send("API ONLINE 🚀");
});

// 🔗 CONEXÃO BANCO
if (process.env.MONGO_URL) {
  mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log("✅ Banco conectado"))
    .catch(err => console.log("❌ ERRO MONGO:", err));
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

    console.log("📩 Tentando registrar:", email);

    const existe = await User.findOne({ email });
    if (existe) {
      console.log("⚠️ Email já existe");
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

    console.log("✅ Usuário criado:", user.email);

    res.json(user);

  } catch (e) {
    console.log("❌ ERRO REGISTER:", e);
    res.status(500).json({ erro: e.message });
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
    console.log("❌ ERRO LOGIN:", e);
    res.status(500).json({ erro: e.message });
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
  } catch (e) {
    console.log("❌ ERRO TOKEN:", e);
    res.status(401).json({ erro: "Token inválido" });
  }
}

// 📤 CAMPANHA
app.post('/campanha', auth, async (req, res) => {
  try {
    const { numeros } = req.body;

    console.log("📤 Enviando para:", numeros);

    res.json({ ok: true });
  } catch (e) {
    console.log("❌ ERRO CAMPANHA:", e);
    res.status(500).json({ erro: e.message });
  }
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
  try {
    res.json({ url: `/uploads/${req.file.filename}` });
  } catch (e) {
    console.log("❌ ERRO UPLOAD:", e);
    res.status(500).json({ erro: e.message });
  }
});

// 🚀 START
const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Money Automático rodando na porta " + PORT);
});
