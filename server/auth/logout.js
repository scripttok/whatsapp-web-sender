// server/auth/logout.js
const { db } = require("./db");

module.exports = (req, res) => {
  const sessionId = req.cookies.sessionId;

  if (sessionId) {
    try {
      const stmt = db.prepare(
        "DELETE FROM active_sessions WHERE session_id = ?"
      );
      stmt.run(sessionId);
      console.log(`[LOGOUT] Sessão removida: ${sessionId}`);
    } catch (err) {
      console.error("[LOGOUT ERROR]", err);
    }
  }

  // LIMPEZA FORÇADA DO COOKIE
  res.clearCookie("sessionId", {
    path: "/",
    domain: ".leadcaptura.com.br", // DOMÍNIO PRINCIPAL
    secure: true,
    httpOnly: true,
    sameSite: "strict",
  });

  res.clearCookie("sessionId", { path: "/" }); // LIMPEZA GERAL

  res.json({ success: true });
};
