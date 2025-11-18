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

    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const expiresAtStr = expiresAt.toISOString();

    // expulsa as sessões antigas
    insertSession.run(user.id, sessionId, expiresAtStr);

    // 🌐 DETECÇÃO AUTOMÁTICA DO AMBIENTE
    const isProd = process.env.NODE_ENV === "production";

    // 🍪 PATCH SEGURO DO COOKIE
    res.cookie("sessionId", sessionId, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      domain: undefined,
      maxAge: 24 * 60 * 60 * 1000,
      path: "/", // garante entrega no site todo
    });

    console.log(`[LOGIN] Sucesso: ${email} | sessionId: ${sessionId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("[LOGIN ERROR]", err);
    res.status(500).json({ error: "Erro interno" });
  }
};
