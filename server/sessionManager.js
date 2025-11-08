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
      imagePath: null, // Adicionado para manter o caminho da imagem
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

// NÃO FECHE O BROWSER AQUI DURANTE O ENVIO
// Só feche quando o usuário explicitamente desconectar
function deleteSession(sessionId) {
  const session = getSession(sessionId);
  if (session) {
    // Fecha o browser apenas se ainda estiver aberto
    if (session.browser && !session.browser.process()?.killed) {
      session.browser.close().catch((err) => {
        console.log(`[SESSION] Erro ao fechar browser: ${err.message}`);
      });
    }
    sessions.delete(sessionId);
    console.log(`[SESSION] Sessão removida: ${sessionId}`);
  }
}

function getAllSessions() {
  return Array.from(sessions.values());
}

// FUNÇÃO PARA LIMPAR APENAS O PROGRESSO (NÃO A SESSÃO)
function resetProgress(sessionId) {
  const session = getSession(sessionId);
  if (session) {
    session.progress = {
      total: 0,
      sent: 0,
      failed: 0,
      pending: 0,
      sentNumbers: [],
      failedNumbers: [],
      pendingNumbers: [],
    };
    updateSession(sessionId, { progress: session.progress });
  }
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  getAllSessions,
  resetProgress, // Exportado para uso no frontend
};
