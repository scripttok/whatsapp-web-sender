// server/auth/logout.js
const { db } = require("./db");

module.exports = (req, res) => {
  const sessionId = req.cookies.sessionId;
  // const sessionId = req.headers["x-session-id"];

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
  //   res.clearCookie("sessionId", {
  //     path: "/",
  //     domain: ".onrender.com", // DOMÍNIO PRINCIPAL
  //     secure: true,
  //     httpOnly: true,
  //     sameSite: "strict",
  //   });

  // res.cookie("sessionId", sessionId, {
  //   httpOnly: true,
  //   secure: false,
  //   sameSite: "lax",
  //   domain: undefined,
  //   maxAge: 24 * 60 * 60 * 1000,
  //   path: "/", // garante entrega no site todo
  // });

  res.clearCookie("sessionId", {
    path: "/",
    // domain: ".onrender.com",
    domain: undefined,
    secure: false,
    httpOnly: true,
  });

  res.clearCookie("sessionId", { path: "/" }); // LIMPEZA GERAL

  res.json({ success: true });
};
