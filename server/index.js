// server/index.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const cookieParser = require("cookie-parser");

// Auth
const loginRoute = require("./auth/login");
const logoutRoute = require("./auth/logout");
const authMiddleware = require("./auth/middleware");
const { getAllUsers, insertUser, deleteUser } = require("./auth/db");

// Session Manager
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

// === MIDDLEWARES ESSENCIAIS ===
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "../client")));

// BLOQUEAR Socket.IO na tela de login
app.get("/socket.io/socket.io.js", (req, res) =>
  res.status(404).send("Not Found")
);
app.get("/socket.io/", (req, res) => res.status(404).send("Not Found"));

// === CONFIGURAÇÃO DO MULTER (upload temporário) ===
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

// === ROTAS PÚBLICAS ===
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.get("/login", (req, res) => {
  console.log("[ROTA] Servindo login");
  res.sendFile(path.join(__dirname, "../client/login.html"));
});

// === ROTAS DE AUTENTICAÇÃO ===
app.post("/api/login", loginRoute);
app.post("/api/logout", logoutRoute);

// === ROTA RAIZ (PROTEGIDA) ===
app.get("/", (req, res) => {
  console.log("[ROTA /] Acessada");
  authMiddleware(req, res, () => {
    console.log("[ROTA /] Autenticado → serve index.html");
    res.sendFile(path.join(__dirname, "../client/index.html"));
  });
});

// === UPLOAD DE ARQUIVOS (PROTEGIDO) ===
app.post(
  "/upload",
  authMiddleware,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "contacts", maxCount: 1 },
  ]),
  (req, res) => {
    const sessionId = req.sessionId;
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

// === PAINEL ADMIN (PROTEGIDO) ===
app.use("/admin", authMiddleware);

app.get("/admin", (req, res) => {
  if (req.user.email !== "admin@hyperzap.com") {
    return res.status(403).send("Acesso negado");
  }
  res.sendFile(path.join(__dirname, "../client/admin/index.html"));
});

app.get("/api/admin/users", authMiddleware, (req, res) => {
  if (req.user.email !== "admin@hyperzap.com") {
    return res.status(403).json({ error: "Acesso negado" });
  }
  const users = getAllUsers.all();
  res.json(users);
});

app.post("/api/admin/users", authMiddleware, async (req, res) => {
  if (req.user.email !== "admin@hyperzap.com") {
    return res.status(403).json({ error: "Acesso negado" });
  }
  const { email, name, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email e senha obrigatórios" });
  }
  try {
    const bcrypt = require("bcrypt");
    const hash = await bcrypt.hash(password, 10);
    insertUser.run(email, hash, name || null);
    res.json({ success: true });
  } catch (err) {
    console.error("[ADMIN] Erro ao criar usuário:", err);
    res.status(400).json({ error: "Email já existe" });
  }
});

app.delete("/api/admin/users/:id", authMiddleware, (req, res) => {
  if (req.user.email !== "admin@hyperzap.com") {
    return res.status(403).json({ error: "Acesso negado" });
  }
  deleteUser.run(req.params.id);
  res.json({ success: true });
});

// === SOCKET.IO ===
io.on("connection", (socket) => {
  console.log(`[SOCKET] Cliente conectado: ${socket.id}`);

  let rawId = socket.handshake.query.sessionId;
  if (!rawId || rawId === "undefined" || rawId === "null") {
    rawId = uuidv4();
  }
  const sessionId = rawId;
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

  // === CONTROLE DE ENVIO ===
  socket.on("pause-sending", () => {
    const { getSendingState } = require("./puppeteerController");
    const state = getSendingState(sessionId);
    if (state) {
      state.paused = true;
      console.log(`[SOCKET] Envio pausado para sessão: ${sessionId}`);
    }
  });

  socket.on("resume-sending", () => {
    const { getSendingState } = require("./puppeteerController");
    const state = getSendingState(sessionId);
    if (state) {
      state.paused = false;
      console.log(`[SOCKET] Envio retomado para sessão: ${sessionId}`);
    }
  });

  socket.on("stop-sending", () => {
    const { getSendingState } = require("./puppeteerController");
    const state = getSendingState(sessionId);
    if (state) {
      state.shouldStop = true;
      setSending(sessionId, false);
      console.log(`[SOCKET] Envio parado para sessão: ${sessionId}`);
    }
  });

  // === DESCONEXÃO ===
  socket.on("disconnect", () => {
    console.log(`[SOCKET] Cliente desconectado: ${socket.id}`);

    const session = getSession(sessionId);
    if (session?.browser) {
      session.browser.close().catch(() => {});
    }
    deleteSession(sessionId);
  });
});

// === INICIAR SERVIDOR ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] Rodando na porta ${PORT}`);
  console.log(`[SERVER] Acesse: http://localhost:${PORT}/login`);
});

module.exports.io = io;
