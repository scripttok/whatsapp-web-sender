// server/index.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { v4: uuidv4 } = require("uuid");
const {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  setSending,
} = require("./sessionManager");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// Configuração do Multer (upload temporário)
const upload = multer({
  dest: "server/uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (
      file.fieldname === "image" &&
      !file.originalname.match(/\.(jpg|jpeg|png|gif)$/i)
    ) {
      return cb(new Error("Apenas imagens JPG, PNG ou GIF"));
    }
    if (file.fieldname === "contacts" && !file.originalname.endsWith(".txt")) {
      return cb(new Error("Apenas arquivos .txt"));
    }
    cb(null, true);
  },
});

// Rota de saúde (para Render)
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Servir frontend
app.use(express.static(path.join(__dirname, "../client")));

// Rota principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

// Upload de arquivos
app.post(
  "/upload",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "contacts", maxCount: 1 },
  ]),
  (req, res) => {
    const sessionId = req.headers["x-session-id"];
    const session = getSession(sessionId);

    if (!session) {
      return res.status(400).json({ error: "Sessão inválida" });
    }

    try {
      const imagePath = req.files["image"] ? req.files["image"][0].path : null;
      const contactsPath = req.files["contacts"]
        ? req.files["contacts"][0].path
        : null;

      updateSession(sessionId, { imagePath, contactsPath });

      res.json({ success: true, message: "Arquivos recebidos" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Socket.IO
io.on("connection", (socket) => {
  console.log(`[SOCKET] Cliente conectado: ${socket.id}`);

  const sessionId = socket.handshake.query.sessionId || uuidv4();
  socket.emit("sessionId", sessionId);
  socket.join(sessionId);

  const session = createSession(sessionId, socket);
  updateSession(sessionId, { status: "connected" });

  // Iniciar conexão com WhatsApp
  socket.on("start-whatsapp", async () => {
    const puppeteerController = require("./puppeteerController");
    await puppeteerController.startWhatsApp(sessionId);
  });

  // Iniciar envio
  socket.on("start-sending", async (data) => {
    const { caption, selectedNumbers } = data;
    const puppeteerController = require("./puppeteerController");
    await puppeteerController.startSending(sessionId, caption, selectedNumbers);
  });

  // === PAUSAR ENVIO ===
  socket.on("pause-sending", () => {
    const { getSendingState } = require("./puppeteerController");
    const state = getSendingState(sessionId);
    if (state) {
      state.paused = true;
      console.log(`[SOCKET] Envio pausado para sessão: ${sessionId}`);
    }
  });

  // === RETOMAR ENVIO ===
  socket.on("resume-sending", () => {
    const { getSendingState } = require("./puppeteerController");
    const state = getSendingState(sessionId);
    if (state) {
      state.paused = false;
      console.log(`[SOCKET] Envio retomado para sessão: ${sessionId}`);
    }
  });

  // === PARAR E LIMPAR ENVIO ===
  socket.on("stop-sending", () => {
    const { getSendingState } = require("./puppeteerController");
    const state = getSendingState(sessionId);
    if (state) {
      state.shouldStop = true;
      setSending(sessionId, false);
      console.log(`[SOCKET] Envio parado e limpo para sessão: ${sessionId}`);
    }
  });

  socket.on("disconnect", () => {
    console.log(`[SOCKET] Cliente desconectado: ${socket.id}`);
    // Opcional: deletar sessão após 5min de inatividade
    // setTimeout(() => {
    //   if (getSession(sessionId)?.socket?.connected === false) {
    //     deleteSession(sessionId);
    //   }
    // }, 5 * 60 * 1000);
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] Rodando na porta ${PORT}`);
  console.log(`[SERVER] Acesse: http://localhost:${PORT}`);
});

module.exports.io = io;
