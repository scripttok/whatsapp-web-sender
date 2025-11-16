// server/auth/middleware.js
const { db } = require("./db");

module.exports = (req, res, next) => {
  const sessionId = req.cookies.sessionId;

  console.log("[AUTH] Verificando sessão...");
  console.log("[AUTH] Cookie sessionId:", sessionId ? sessionId : "NÃO EXISTE");

  if (!sessionId) {
    console.log("[AUTH] Sem cookie → redireciona para login");
    return res.redirect("/login.html");
  }

  try {
    const stmt = db.prepare(
      "SELECT * FROM active_sessions WHERE session_id = ?"
    );
    const session = stmt.get(sessionId);

    console.log(
      "[AUTH] Sessão no banco:",
      session ? "ENCONTRADA" : "NÃO ENCONTRADA"
    );

    if (!session) {
      console.log(
        "[AUTH] Sessão não existe no banco → limpa cookie e redireciona"
      );
      res.clearCookie("sessionId");
      return res.redirect("/login.html");
    }

    if (new Date(session.expires_at) < new Date()) {
      console.log("[AUTH] Sessão expirada → limpa e redireciona");
      res.clearCookie("sessionId");
      return res.redirect("/login.html");
    }

    const userStmt = db.prepare(
      "SELECT id, email, name FROM users WHERE id = ?"
    );
    const user = userStmt.get(session.user_id);

    if (!user) {
      console.log("[AUTH] Usuário não encontrado → redireciona");
      res.clearCookie("sessionId");
      return res.redirect("/login.html");
    }

    console.log("[AUTH] Usuário autenticado:", user.email);
    req.user = user;
    req.sessionId = sessionId;
    next();
  } catch (err) {
    console.error("[AUTH ERRO]", err);
    res.clearCookie("sessionId");
    res.redirect("/login.html");
  }
};
