// server/auth/middleware.js
const { db } = require("./db");
const { getSession, createSession } = require("../sessionManager");

module.exports = (req, res, next) => {
  // ================================================
  // GARANTIA: req.cookies sempre existe (mesmo no Socket.IO)
  // ================================================
  if (!req.cookies) {
    // No Socket.IO o cookie-parser ainda não rodou → forçamos aqui
    const cookieParser = require("cookie-parser");
    cookieParser()(req, res, () => {});
  }

  const sessionId = req.cookies?.sessionId;

  console.log("[AUTH] Verificando sessão...");
  console.log("[AUTH] Cookie sessionId:", sessionId || "NÃO EXISTE");

  if (!sessionId) {
    console.log("[AUTH] Sem cookie → acesso negado");
    // Se for rota HTTP → redireciona
    if (res && typeof res.redirect === "function") {
      return res.redirect("/login");
    }
    // Se for Socket.IO → rejeita conexão
    return next(new Error("Não autenticado"));
  }

  try {
    const sessionRow = db
      .prepare("SELECT * FROM active_sessions WHERE session_id = ?")
      .get(sessionId);

    if (!sessionRow || new Date(sessionRow.expires_at) < new Date()) {
      console.log("[AUTH] Sessão inválida ou expirada");
      if (res && typeof res.clearCookie === "function") {
        res.clearCookie("sessionId");
        return res.redirect("/login");
      }
      return next(new Error("Sessão inválida"));
    }

    const user = db
      .prepare("SELECT id, email, name FROM users WHERE id = ?")
      .get(sessionRow.user_id);

    if (!user) {
      if (res && typeof res.clearCookie === "function") {
        res.clearCookie("sessionId");
        return res.redirect("/login");
      }
      return next(new Error("Usuário não encontrado"));
    }

    console.log("[AUTH] Usuário autenticado:", user.email);

    req.user = user;
    req.sessionId = sessionId; // mantém compatibilidade antiga

    // ================================================
    // AJUSTE CIRÚRGICO: sessão WhatsApp vinculada ao usuário
    // ================================================
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

    req.whatsappSessionId = whatsappSessionId; // ← use isso no /upload e socket
    // ================================================

    next();
  } catch (err) {
    console.error("[AUTH ERRO]", err);
    if (res && typeof res.redirect === "function") {
      res.clearCookie("sessionId");
      return res.redirect("/login");
    }
    return next(new Error("Erro de autenticação"));
  }
};
