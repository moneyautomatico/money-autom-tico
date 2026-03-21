const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// 🔗 CONEXÃO COM MONGO
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("✅ MongoDB conectado"))
.catch(err => console.log(err));

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

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET
    );

    // 🔥 AQUI ESTÁ A CORREÇÃO PRINCIPAL
    res.json({
      token,
      admin: user.admin,
      user_id: user._id
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

  } catch (err) {
    res.json({ erro: "Erro ao registrar" });
  }
});

// 🔐 MIDDLEWARE
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

// 🤖 SALVAR IA
app.post("/ia/salvar", auth, async (req, res) => {
  const { texto } = req.body;

  await IA.findOneAndUpdate(
    { user_id: req.userId },
    { texto },
    { upsert: true }
  );

  res.json({ msg: "IA salva!" });
});

// 🤖 BUSCAR IA
app.get("/ia", auth, async (req, res) => {
  const ia = await IA.findOne({ user_id: req.userId });
  res.json({ texto: ia?.texto || "" });
});

// 🤖 RESPONDER IA
app.post("/ia/responder", async (req, res) => {
  const { mensagem, user_id } = req.body;

  const ia = await IA.findOne({ user_id });

  let resposta = "Não entendi.";

  if (ia && ia.texto) {
    if (mensagem.toLowerCase().includes("oi")) {
      resposta = "Olá! Como posso ajudar?";
    } else {
      resposta = ia.texto;
    }
  }

  res.json({ resposta });
});

// 👑 ADMIN
app.get("/admin/users", auth, async (req, res) => {
  const users = await User.find();
  res.json(users);
});

// 🚀 START
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 Servidor rodando na porta " + PORT);
});
