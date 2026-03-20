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

// 🧠 STATUS DO SISTEMA
app.get("/", (req, res) => {
  res.send(`
    <h1>🚀 Money Automático API</h1>
    <p>Status: ONLINE ✅</p>
    <p>Banco: CONECTADO 🔗</p>
    <hr/>
    <h3>Rotas disponíveis:</h3>
    <ul>
      <li>POST /register</li>
      <li>POST /login</li>
      <li>POST /campanha</li>
      <li>POST /upload</li>
    </ul>
  `);
});

// 🔗 CONEXÃO BANCO
if (!process.env.MONGO_URL) {
  console.log("❌ MONGO_URL não configurado");
} else {
  mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log("✅ Banco conectado"))
    .catch(err => console.log("❌ ERRO MONGO:", err));
}

// 👤 MODEL
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  senha: { type: String, required: true },
  ativo: { type: Boolean, default: true },
  mensagens: { type: Array, default: [] },
  delay_min: { type: Number, default: 10 },
  delay_max: { type: Number, default: 30 }
});

const User = mongoose.model('User', UserSchema);

// 🔐 REGISTER
app.post('/register', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ erro: "Email e senha obrigatórios" });
    }

    const existe = await User.findOne({ email });
    if (existe) {
      return res.status(400).json({ erro: "Email já cadastrado" });
    }

    const hash = await bcrypt.hash(senha, 10);

    await User.create({ email, senha: hash });

    console.log("✅ Novo usuário:", email);

    res.json({ msg: "Usuário criado com sucesso" });

  } catch (e) {
    console.log("❌ ERRO REGISTER:", e);
    res.status(500).json({ erro: e.message });
  }
});

// 🔐 LOGIN
app.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ erro: "Email e senha obrigatórios" });
    }

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

    res.json({ token });

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
    return res.status(401).json({ erro: "Token inválido" });
  }
}

// 📤 CAMPANHA PROFISSIONAL
app.post('/campanha', auth, async (req, res) => {
  try {
    const { numeros, mensagem } = req.body;

    if (!numeros || numeros.length === 0) {
      return res.status(400).json({ erro: "Informe os números" });
    }

    if (!mensagem) {
      return res.status(400).json({ erro: "Informe a mensagem" });
    }

    console.log("🚀 Campanha iniciada");

    const delay = (ms) => new Promise(r => setTimeout(r, ms));

    (async () => {
      for (let numero of numeros) {

        console.log(`📤 Enviando para ${numero}: ${mensagem}`);

        const tempo = Math.floor(Math.random() * 5000) + 5000;

        console.log(`⏱️ Delay: ${tempo / 1000}s`);

        await delay(tempo);
      }

      console.log("✅ Campanha finalizada");

    })();

    res.json({ ok: true, msg: "Campanha em execução" });

  } catch (e) {
    console.log("❌ ERRO CAMPANHA:", e);
    res.status(500).json({ erro: e.message });
  }
});

// 📂 UPLOAD
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});

const upload = multer({ storage });

app.post('/upload', upload.single('file'), (req, res) => {
  res.json({ url: `/uploads/${req.file.filename}` });
});

// 🚀 START
const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Money Automático rodando na porta " + PORT);
});
