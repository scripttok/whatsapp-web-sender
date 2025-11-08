// server/sessionManager.js
const sessions = new Map(); // Armazena sessões: sessionId → { page, browser, socket, status }

function createSession(sessionId, socket) {
  if (sessions.has(sessionId)) {
    console.log(`[SESSION] Reutilizando sessão existente: ${sessionId}`);
  } else {
    console.log(`[SESSION] Nova sessão criada: ${sessionId}`);
    sessions.set(sessionId, {
      sessionId,
      socket,
      status: "initializing",
      page: null,
      browser: null,
      qrCode: null,
      progress: {
        total: 0,
        sent: 0,
        failed: 0,
        pending: 0,
        sentNumbers: [],
        failedNumbers: [],
        pendingNumbers: [],
      },
    });
  }
  return sessions.get(sessionId);
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function updateSession(sessionId, updates) {
  const session = getSession(sessionId);
  if (session) {
    Object.assign(session, updates);
    sessions.set(sessionId, session);
  }
}

function deleteSession(sessionId) {
  const session = getSession(sessionId);
  if (session && session.browser) {
    session.browser.close().catch(() => {});
  }
  sessions.delete(sessionId);
  console.log(`[SESSION] Sessão removida: ${sessionId}`);
}

function getAllSessions() {
  return Array.from(sessions.values());
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  getAllSessions,
};
