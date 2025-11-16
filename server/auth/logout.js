// server/auth/logout.js
const { deleteSession } = require("./db");

module.exports = (req, res) => {
  const sessionId = req.cookies.sessionId;
  if (sessionId) {
    deleteSession.run(sessionId);
  }

  res.clearCookie("sessionId");
  res.json({ success: true, message: "Logout realizado" });
};
