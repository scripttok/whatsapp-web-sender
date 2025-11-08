// server/puppeteerController.js
// VERSÃO TEMPORÁRIA CORRIGIDA

const { io } = require("./index"); // Agora funciona!

async function startWhatsApp(sessionId) {
  console.log(
    `[PUPPETEER] Iniciando WhatsApp para sessão: ${sessionId || "temp"}`
  );

  // Simula QR Code após 2 segundos
  setTimeout(() => {
    if (io && sessionId) {
      io.to(sessionId).emit(
        "qr",
        "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=WHATSAPP_WEB_SESSION"
      );
    }
  }, 2000);

  // Simula conexão após 5 segundos
  setTimeout(() => {
    if (io && sessionId) {
      io.to(sessionId).emit("connected");
    }
  }, 5000);
}

async function startSending(sessionId, caption, numbers) {
  console.log(
    `[PUPPETEER] Iniciando envio simulado para ${numbers.length} contatos`
  );

  if (!io || !sessionId) return;

  const session = require("./sessionManager").getSession(sessionId);
  if (!session) return;

  let sent = 0;
  const total = numbers.length;

  const interval = setInterval(() => {
    if (sent >= total) {
      clearInterval(interval);
      io.to(sessionId).emit("complete");
      return;
    }

    const num = numbers[sent];
    sent++;

    // 80% sucesso, 20% falha
    if (Math.random() < 0.8) {
      session.progress.sentNumbers.push(num);
      session.progress.sent++;
    } else {
      session.progress.failedNumbers.push(num);
      session.progress.failed++;
    }

    session.progress.pending = total - sent;

    io.to(sessionId).emit("progress", {
      sentNumbers: session.progress.sentNumbers,
      failedNumbers: session.progress.failedNumbers,
      pendingNumbers: numbers.slice(sent),
    });
  }, 1500);
}

module.exports = { startWhatsApp, startSending };
