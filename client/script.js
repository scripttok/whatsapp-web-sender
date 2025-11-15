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

  // Mostrar botões de controle
  pauseBtn.style.display = "inline-flex";
  stopBtn.style.display = "inline-flex";
  pauseBtn.textContent = "Pausar";
  pauseBtn.style.background = "#ffc107";
  isPaused = false;

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
    sendBtn.disabled = false;
    sendBtn.textContent = "Enviar";
    pauseBtn.style.display = "none";
    stopBtn.style.display = "none";
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

    // Reset UI
    sendBtn.disabled = false;
    sendBtn.textContent = "Enviar";
    pauseBtn.style.display = "none";
    stopBtn.style.display = "none";
    progressSection.classList.add("hidden");
    clearProgress();
    updateStatus("Envio cancelado e limpo.", "error");

    isPaused = false;
    selectedNumbers = new Set();
  }
};

function updateProgress(data) {
  updateList(sentList, data.sentNumbers);
  updateList(failedList, data.failedNumbers);
  updateList(pendingList, data.pendingNumbers);
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
