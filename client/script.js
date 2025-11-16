// client/script.js
const socket = io({
  query: {
    sessionId:
      new URLSearchParams(window.location.search).get("session") || undefined,
  },
});

let sessionId = null;
let contacts = [];
let selectedNumbers = new Set();
let isPaused = false;
let initialSelected = 0; // Armazena total inicial de números selecionados

// Elementos DOM
const connectBtn = document.getElementById("connect-btn");
const qrContainer = document.getElementById("qr-container");
const qrImage = document.getElementById("qr-image");
const configSection = document.getElementById("config-section");
const imageInput = document.getElementById("image-input");
const captionInput = document.getElementById("caption-input");
const contactsInput = document.getElementById("contacts-input");
const loadContactsBtn = document.getElementById("load-contacts-btn");
const contactsContainer = document.getElementById("contacts-container");
const contactsList = document.getElementById("contacts-list");
const totalCount = document.getElementById("total-count");
const selectedCount = document.getElementById("selected-count");
const sendBtn = document.getElementById("send-btn");
const progressSection = document.getElementById("progress-section");
const sentList = document.getElementById("sent-list");
const failedList = document.getElementById("failed-list");
const pendingList = document.getElementById("pending-list");
const status = document.getElementById("status");

// Botões de controle
const pauseBtn = document.getElementById("pause-btn");
const stopBtn = document.getElementById("stop-btn");

// Contadores numéricos
const sentCountEl = document.createElement("div");
sentCountEl.className = "summary-card";
sentCountEl.innerHTML = `<div class="label">Enviados</div><div class="value" id="sent-count">0</div>`;
const failedCountEl = document.createElement("div");
failedCountEl.className = "summary-card";
failedCountEl.innerHTML = `<div class="label">Não enviados</div><div class="value" id="failed-count">0</div>`;
const pendingCountEl = document.createElement("div");
pendingCountEl.className = "summary-card";
pendingCountEl.innerHTML = `<div class="label">Pendentes</div><div class="value" id="pending-count">0</div>`;

// Inserir contadores no progresso
const progressHeader = progressSection.querySelector("h3");
progressHeader.insertAdjacentElement("afterend", sentCountEl);
progressHeader.insertAdjacentElement("afterend", failedCountEl);
progressHeader.insertAdjacentElement("afterend", pendingCountEl);

// Socket Events
socket.on("sessionId", (id) => {
  sessionId = id;
  const url = new URL(window.location);
  url.searchParams.set("session", id);
  history.replaceState(null, "", url);
});

socket.on("qr", (qr) => {
  qrImage.src = qr;
  qrContainer.classList.remove("hidden");
  updateStatus("Escaneie o QR Code...", "connected");
});

socket.on("connected", () => {
  qrContainer.classList.add("hidden");
  configSection.classList.remove("hidden");
  updateStatus("Conectado! Configure o envio.", "connected");
});

socket.on("progress", (data) => {
  updateProgress(data);
});

socket.on("complete", () => {
  updateStatus("Envio concluído!", "connected");
  sendBtn.disabled = false;
  sendBtn.textContent = "Enviar Novamente";
  pauseBtn.style.display = "none";
  stopBtn.style.display = "none";
});

socket.on("error", (msg) => {
  updateStatus(`Erro: ${msg}`, "error");
});

socket.on("disconnect-whatsapp", () => {
  const session = getSession(sessionId);
  if (session?.browser) {
    session.browser.close().catch(() => {});
    deleteSession(sessionId);
  }
});

// Funções
function updateStatus(text, type) {
  status.textContent = text;
  status.className = `status ${type}`;
  status.classList.remove("hidden");
}

connectBtn.onclick = () => {
  connectBtn.disabled = true;
  connectBtn.textContent = "Conectando...";
  socket.emit("start-whatsapp");
};

contactsInput.onchange = () => {
  loadContactsBtn.disabled = !contactsInput.files[0];
};

loadContactsBtn.onclick = async () => {
  const file = contactsInput.files[0];
  const text = await file.text();
  contacts = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l);

  renderContacts();
  contactsContainer.classList.remove("hidden");
  loadContactsBtn.style.display = "none";
};

function renderContacts() {
  contactsList.innerHTML = "";
  contacts.forEach((num) => {
    const div = document.createElement("div");
    div.className = "contact-item";
    div.innerHTML = `
      <input type="checkbox" checked data-num="${num}">
      <span class="contact-number">${num}</span>
    `;
    contactsList.appendChild(div);
  });

  updateSelection();
  attachCheckboxListeners();
}

function attachCheckboxListeners() {
  document.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.onchange = updateSelection;
  });
}

function updateSelection() {
  selectedNumbers = new Set(
    Array.from(document.querySelectorAll('input[type="checkbox"]:checked')).map(
      (cb) => cb.dataset.num
    )
  );
  totalCount.textContent = contacts.length;
  selectedCount.textContent = selectedNumbers.size;
  sendBtn.disabled = selectedNumbers.size === 0;
}

sendBtn.onclick = async () => {
  if (!imageInput.files[0]) {
    alert("Selecione uma imagem");
    return;
  }

  const caption = captionInput.value.trim();
  const formData = new FormData();
  formData.append("image", imageInput.files[0]);
  if (contactsInput.files[0]) {
    formData.append("contacts", contactsInput.files[0]);
  }

  sendBtn.disabled = true;
  sendBtn.textContent = "Enviando...";
  progressSection.classList.remove("hidden");
  clearProgress();

  // Armazena total inicial
  initialSelected = selectedNumbers.size;

  // Mostrar botões de controle
  pauseBtn.style.display = "inline-flex";
  stopBtn.style.display = "inline-flex";
  pauseBtn.textContent = "Pausar";
  pauseBtn.style.background = "#ffc107";
  isPaused = false;

  // Inicializar contadores
  document.getElementById("sent-count").textContent = "0";
  document.getElementById("failed-count").textContent = "0";
  document.getElementById("pending-count").textContent = initialSelected;

  try {
    await fetch("/upload", {
      method: "POST",
      headers: { "x-session-id": sessionId },
      body: formData,
    });
    socket.emit("start-sending", {
      caption,
      selectedNumbers: Array.from(selectedNumbers),
    });
  } catch (err) {
    updateStatus("Erro no upload", "error");
    resetAfterStop();
  }
};

// Botão Pausar / Continuar
pauseBtn.onclick = () => {
  if (isPaused) {
    socket.emit("resume-sending");
    pauseBtn.textContent = "Pausar";
    pauseBtn.style.background = "#ffc107";
    updateStatus("Envio retomado...", "sending");
  } else {
    socket.emit("pause-sending");
    pauseBtn.textContent = "Continuar";
    pauseBtn.style.background = "#28a745";
    updateStatus("Envio pausado. Clique em Continuar para retomar.", "sending");
  }
  isPaused = !isPaused;
};

// Botão Parar e Limpar
stopBtn.onclick = () => {
  if (confirm("Tem certeza que deseja PARAR e LIMPAR tudo?")) {
    socket.emit("stop-sending");
    socket.emit("disconnect-whatsapp");

    resetAfterStop();
    updateStatus("Envio parado e tudo limpo. Pronto para novo envio.", "error");
  }
};

function resetAfterStop() {
  sendBtn.disabled = false;
  sendBtn.textContent = "Enviar";
  pauseBtn.style.display = "none";
  stopBtn.style.display = "none";
  progressSection.classList.add("hidden");

  imageInput.value = "";
  captionInput.value = "";
  contactsInput.value = "";
  loadContactsBtn.style.display = "inline-flex";
  loadContactsBtn.disabled = true;
  contactsContainer.classList.add("hidden");
  contactsList.innerHTML = "";
  contacts = [];
  selectedNumbers = new Set();
  initialSelected = 0;

  clearProgress();
  document.getElementById("sent-count").textContent = "0";
  document.getElementById("failed-count").textContent = "0";
  document.getElementById("pending-count").textContent = "0";

  connectBtn.disabled = false;
  connectBtn.textContent = "Conectar WhatsApp";
  qrContainer.classList.add("hidden");
  configSection.classList.add("hidden");

  isPaused = false;
}

function updateProgress(data) {
  // Atualiza listas
  updateList(sentList, data.sentNumbers);
  updateList(failedList, data.failedNumbers);

  // Calcula pendentes: total inicial - enviados - falhados
  const sent = data.sentNumbers.length;
  const failed = data.failedNumbers.length;
  const pending = initialSelected - sent - failed;

  // Atualiza lista de pendentes
  const allSelected = Array.from(selectedNumbers);
  const sentSet = new Set(data.sentNumbers);
  const failedSet = new Set(data.failedNumbers);
  const pendingNumbers = allSelected.filter(
    (n) => !sentSet.has(n) && !failedSet.has(n)
  );
  updateList(pendingList, pendingNumbers);

  // Atualiza contadores
  document.getElementById("sent-count").textContent = sent;
  document.getElementById("failed-count").textContent = failed;
  document.getElementById("pending-count").textContent = pending;
}

function updateList(ul, items) {
  ul.innerHTML = "";
  items.forEach((num) => {
    const li = document.createElement("li");
    li.textContent = num;
    ul.appendChild(li);
  });
}

function clearProgress() {
  [sentList, failedList, pendingList].forEach((ul) => (ul.innerHTML = ""));
}

// === LOGOUT ===
document.getElementById("logout-btn")?.addEventListener("click", async () => {
  if (!confirm("Tem certeza que deseja sair?")) return;

  try {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "include",
    });
    window.location.href = "/login.html";
  } catch (err) {
    alert("Erro ao sair. Recarregue a página.");
  }
});
