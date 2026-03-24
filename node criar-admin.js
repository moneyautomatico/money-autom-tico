require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/money-partner';
const UserSchema = new mongoose.Schema({
  name:            String,
  email:           { type: String, unique: true },
  password:        String,
  iaResumo:        { type: String, default: '' },
  baseAprendizado: { type: String, default: '' },
  createdAt:       { type: Date, default: Date.now },
});
const User = mongoose.model('User', UserSchema);
async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB conectado');
  // Remove usuário antigo se existir
  await User.deleteOne({ email: 'tiagoscosta.business@gmail.com' });
  const hashed = await bcrypt.hash('123456', 10);
  await User.create({
    name:     'Administrador',
    email:    'tiagoscosta.business@gmail.com',
    password: hashed,
  });
  console.log('✅ Admin criado com sucesso!');
  console.log('📧 E-mail: tiagoscosta.business@gmail.com');
  console.log('🔑 Senha:  123456');
  await mongoose.disconnect();
  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
