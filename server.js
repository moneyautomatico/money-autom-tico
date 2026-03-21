const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");

require("dotenv").config();

const app = express();

app.use(express.json());
app.use(cors());

// 🔥 SERVIR FRONTEND
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 🔗 CONEXÃO COM MONGO (SEU BANCO REAL)
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB conectado"))
  .catch(err => console.log("❌ Erro Mongo:", err));

// 👤 MODEL USER
const User = mongoose.model("User", {
  email: String,
  senha: String,
  admin: { type: Boolean, default: false }
});

// 🤖 MODEL IA
const IA = mongoose.model("IA", {
  user_id: String,
  texto: String
});

// 🔐 LOGIN
app.post("/login", async (req, res) => {
  try {
    const { email, senha } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.json({ erro: "Usuário não encontrado" });

    const valid = await bcrypt.compare(senha, user.senha);
    if (!valid) return res.json({ erro: "Senha inválida" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);

    res.json({
      token,
      user_id: user._id,
      admin: user.admin
    });

  } catch (err) {
    res.json({ erro: "Erro no login" });
  }
});

// 📝 REGISTRO
app.post("/register", async (req, res) => {
  try {
    const { email, senha } = req.body;

    const hash = await bcrypt.hash(senha, 10);

    await User.create({
      email,
      senha: hash
    });

    res.json({ msg: "Usuário criado!" });

  } catch {
    res.json({ erro: "Erro ao registrar" });
  }
});

// 🔐 AUTH
function auth(req, res, next) {
  const token = req.headers["authorization"];
  if (!token) return res.status(401).json({ erro: "Sem token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ erro: "Token inválido" });
  }
}

// 📤 DISPARO
app.post("/campanha", auth, async (req, res) => {
  res.json({ msg: "Disparo recebido" });
});

// 🤖 IA SALVAR
app.post("/ia/salvar", auth, async (req, res) => {
  const { texto } = req.body;

  await IA.findOneAndUpdate(
    { user_id: req.userId },
    { texto },
    { upsert: true }
  );

  res.json({ msg: "IA salva!" });
});

// 🤖 IA BUSCAR
app.get("/ia", auth, async (req, res) => {
  const ia = await IA.findOne({ user_id: req.userId });
  res.json({ texto: ia?.texto || "" });
});

// 👑 ADMIN
app.get("/admin/users", auth, async (req, res) => {
  const users = await User.find();
  res.json(users);
});

// 🔍 TESTE BANCO
app.get("/teste-db", async (req, res) => {
  const users = await User.find();
  res.json(users);
});

// 🚀 START
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("🚀 Servidor rodando na porta " + PORT);
});
