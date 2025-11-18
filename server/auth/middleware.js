// server/auth/middleware.js
const { db } = require("./db");
const { getSession, createSession } = require("../sessionManager");

module.exports = (req, res, next) => {
  // Garante que req.cookies exista (necessário no Socket.IO)
  if (!req.cookies && req.headers.cookie) {
    const cookieParser = require("cookie-parser");
    cookieParser()(req, res, () => {});
  }

  const sessionId = req.cookies?.sessionId;

  console.log("[AUTH] Verificando sessão...");
  console.log("[AUTH] Cookie sessionId:", sessionId || "NÃO EXISTE");

  if (!sessionId) {
    if (res && typeof res.redirect === "function")
      return res.redirect("/login");
    return next(new Error("Não autenticado"));
  }

  try {
    const sessionRow = db
      .prepare("SELECT * FROM active_sessions WHERE session_id = ?")
      .get(sessionId);

    if (!sessionRow || new Date(sessionRow.expires_at) < new Date()) {
      if (res && res.clearCookie) res.clearCookie("sessionId");
      if (res && res.redirect) return res.redirect("/login");
      return next(new Error("Sessão inválida ou expirada"));
    }

    const user = db
      .prepare("SELECT id, email, name FROM users WHERE id = ?")
      .get(sessionRow.user_id);

    if (!user) {
      if (res && res.clearCookie) res.clearCookie("sessionId");
      if (res && res.redirect) return res.redirect("/login");
      return next(new Error("Usuário não encontrado"));
    }

    console.log("[AUTH] Usuário autenticado:", user.email);
    req.user = user;
    req.sessionId = sessionId;

    // Sessão WhatsApp fixa por usuário
    const whatsappSessionId = `user_${user.id}`;
    if (!getSession(whatsappSessionId)) {
      console.log(
        `[AUTH] Criando sessão WhatsApp mínima para ${whatsappSessionId}`
      );
      const dummySocket = {
        emit: () => {},
        join: () => {},
        id: "auth-middleware",
      };
      createSession(whatsappSessionId, dummySocket);
    }

    req.whatsappSessionId = whatsappSessionId;
    next();
  } catch (err) {
    console.error("[AUTH ERRO]", err);
    if (res && res.clearCookie) res.clearCookie("sessionId");
    if (res && res.redirect) return res.redirect("/login");
    next(new Error("Erro de autenticação"));
  }
};
