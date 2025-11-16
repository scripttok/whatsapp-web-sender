// server/auth/login.js
const bcrypt = require("bcrypt");
const { getUserByEmail, insertSession } = require("./db");
const { v4: uuidv4 } = require("uuid");

module.exports = (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email e senha são obrigatórios" });
  }

  try {
    const user = getUserByEmail.get(email);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    // Gera sessionId único
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    // ✅ CONVERTER PARA STRING ISO (SQLite aceita)
    const expiresAtStr = expiresAt.toISOString();

    // Expulsa sessão anterior (1 por usuário)
    insertSession.run(user.id, sessionId, expiresAtStr);

    // Cookie seguro
    res.cookie("sessionId", sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "strict",
    });

    console.log(`[LOGIN] Sucesso: ${email} | sessionId: ${sessionId}`);
    res.json({ success: true, message: "Login realizado com sucesso" });
  } catch (err) {
    console.error("[LOGIN ERROR]", err);
    res.status(500).json({ error: "Erro interno" });
  }
};
