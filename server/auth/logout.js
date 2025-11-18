// server/auth/logout.js
const { db } = require("./db");

module.exports = (req, res) => {
  const sessionId = req.cookies.sessionId;

  if (sessionId) {
    try {
      db.prepare("DELETE FROM active_sessions WHERE session_id = ?").run(
        sessionId
      );
      console.log(`[LOGOUT] Sessão removida: ${sessionId}`);
    } catch (err) {
      console.error("[LOGOUT ERROR]", err);
    }
  }

  // Limpa o cookie (funciona em localhost e produção)
  res.clearCookie("sessionId", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
  });

  res.clearCookie("sessionId", { path: "/" }); // LIMPEZA GERAL

  res.json({ success: true });
};
