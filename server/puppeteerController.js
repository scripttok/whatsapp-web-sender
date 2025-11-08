// server/puppeteerController.js
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");
const { getSession, updateSession } = require("./sessionManager");

puppeteer.use(StealthPlugin());

const { io } = require("./index");

// === FUNÇÕES AUXILIARES ===
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function typeHuman(page, selector, text) {
  const handle = await page.$(selector);
  if (!handle) return;
  for (const char of text) {
    await handle.type(char, { delay: rand(20, 60) });
    await sleep(rand(10, 30));
  }
}

async function mouseHuman(page) {
  try {
    const w = await page.evaluate(() => window.innerWidth);
    const h = await page.evaluate(() => window.innerHeight);
    for (let i = 0; i < rand(1, 2); i++) {
      await page.mouse.move(rand(0, w), rand(0, h), { steps: rand(2, 4) });
      await sleep(rand(20, 40));
    }
  } catch (e) {}
}

async function isNoConversationFound(page) {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll("span")).some((s) =>
      s.innerText?.includes("Nenhuma conversa, contato ou mensagem encontrada")
    )
  );
}

// === INICIAR WHATSAPP ===
async function startWhatsApp(sessionId) {
  const session = getSession(sessionId);
  if (!session || session.browser) return;

  console.log(`[PUPPETEER] Iniciando navegador para sessão: ${sessionId}`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
  });

  const page = await browser.newPage();
  await page.goto("https://web.whatsapp.com", { waitUntil: "networkidle0" });

  updateSession(sessionId, { page, browser, status: "qr" });

  // QR Code
  page.waitForSelector("canvas", { timeout: 0 }).then(async () => {
    const qr = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      return canvas ? canvas.toDataURL() : null;
    });
    if (qr) io.to(sessionId).emit("qr", qr);
  });

  // Conectado
  await page.waitForSelector("div#side", { timeout: 120000 });
  io.to(sessionId).emit("connected");
  updateSession(sessionId, { status: "connected" });
}

// === INICIAR ENVIO ===
async function startSending(sessionId, caption, selectedNumbers) {
  const session = getSession(sessionId);
  if (!session || !session.page || !session.imagePath) return;

  const { page, imagePath } = session;
  const numbers = selectedNumbers;

  console.log(
    `[PUPPETEER] Iniciando envio real para ${numbers.length} contatos`
  );

  for (let i = 0; i < numbers.length; i++) {
    const num = numbers[i];
    const remaining = numbers.length - i;

    try {
      await openChat(page, num);
      if (await isNoConversationFound(page)) {
        session.progress.failedNumbers.push(num);
        session.progress.failed++;
      } else {
        await mouseHuman(page);
        await sendImage(page, imagePath, caption);
        session.progress.sentNumbers.push(num);
        session.progress.sent++;
      }
    } catch (err) {
      console.log(`[ERRO] ${num}: ${err.message}`);
      session.progress.failedNumbers.push(num);
      session.progress.failed++;
    }

    session.progress.pending = remaining - 1;
    io.to(sessionId).emit("progress", { ...session.progress });

    if (i < numbers.length - 1) {
      await sleep(rand(1000, 2000));
    }
  }

  io.to(sessionId).emit("complete");
  console.log(`[PUPPETEER] Envio concluído para sessão: ${sessionId}`);
}

// === ABRIR CHAT ===
async function openChat(page, number) {
  const searchBox = await page.$('div[contenteditable="true"][data-tab="3"]');
  if (!searchBox) {
    await page.goto(`https://web.whatsapp.com/send?phone=${number}`);
    await page.waitForSelector('div[contenteditable="true"][data-tab="10"]', {
      timeout: 10000,
    });
    return true;
  }

  await searchBox.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await typeHuman(page, 'div[contenteditable="true"][data-tab="3"]', number);
  await sleep(rand(800, 1200));

  try {
    await page.waitForFunction(
      (num) =>
        Array.from(document.querySelectorAll("span")).some((s) =>
          s.innerText.includes(num)
        ),
      { timeout: 5000 },
      number
    );
    await page.keyboard.press("Enter");
  } catch {}

  await page.waitForSelector('div[contenteditable="true"][data-tab="10"]', {
    timeout: 10000,
  });
  return true;
}

// === ENVIO DE IMAGEM (SEM ABRIR EXPLORADOR) ===
async function sendImage(page, imagePath, caption) {
  console.log(`[DEBUG] Enviando imagem como FOTO: ${imagePath}`);

  // === PASSO 1: ABRIR MENU "+" ===
  console.log("[DEBUG] Abrindo menu de anexar...");

  const attachSelectors = [
    'button[aria-label="Anexar"]',
    'button[data-testid="attach-menu-button"]',
    'span[data-icon="clip"]',
    'span[data-icon="plus"]',
    'div[aria-label="Anexar"]',
    'div[aria-label="Attach"]',
    'button[title*="Anexar"]',
    'button[title*="Attach"]',
  ];

  let menuOpened = false;
  for (const sel of attachSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 1000 });
      await page.click(sel);
      menuOpened = true;
      console.log(`[DEBUG] Menu aberto via: ${sel}`);
      break;
    } catch (e) {}
  }

  if (!menuOpened) {
    throw new Error("Botão '+' não encontrado");
  }

  // === PASSO 2: ESPERAR INPUT DE IMAGEM (SEM CLICAR EM "FOTOS E VÍDEOS") ===
  const fileInputHandle = await page.waitForSelector(
    'input[type="file"][accept*="image/*"]',
    { timeout: 5000 }
  );

  if (!fileInputHandle) {
    throw new Error("Input de upload de imagem não encontrado após abrir menu");
  }

  console.log("[DEBUG] Input de imagem detectado (sem abrir explorador)");

  // === PASSO 3: INJEÇÃO PURA COM File API ===
  const normalizedPath = path.normalize(imagePath).replace(/\\/g, "/");
  console.log(`[DEBUG] Injetando arquivo: ${normalizedPath}`);

  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`Arquivo não encontrado: ${normalizedPath}`);
  }

  const fileBuffer = fs.readFileSync(normalizedPath);
  const fileName = path.basename(normalizedPath);
  const fileMime = normalizedPath.endsWith(".png") ? "image/png" : "image/jpeg";

  await page.evaluateHandle(
    async (input, buffer, name, type) => {
      const blob = new Blob([new Uint8Array(buffer)], { type });
      const file = new File([blob], name, { type });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    fileInputHandle,
    Array.from(fileBuffer),
    fileName,
    fileMime
  );

  console.log(`[DEBUG] Imagem injetada: ${fileName}`);

  // === PASSO 4: AGUARDAR PRÉVIA ===
  try {
    await page.waitForFunction(
      () => {
        const img = document.querySelector(
          'img[alt="Prévia da imagem"], img[src^="blob:"]'
        );
        return img && img.src && img.src.startsWith("blob:");
      },
      { timeout: 10000 }
    );
    console.log("[DEBUG] Prévia da imagem detectada com sucesso");
  } catch (e) {
    console.log(
      "[WARN] Prévia não detectada (mas tentando enviar mesmo assim)"
    );
  }

  await sleep(rand(1000, 1500));

  // === PASSO 5: DIGITAR LEGENDA ===
  const captionBox = await page.$(
    "div[contenteditable='true'][data-tab='10'], div[contenteditable='true'][aria-label]"
  );
  if (captionBox && caption) {
    for (const ch of caption.split("")) {
      try {
        await captionBox.type(ch, { delay: rand(20, 60) });
      } catch {
        await page.keyboard.type(ch, { delay: rand(20, 60) });
      }
      await sleep(rand(10, 30));
    }
    await sleep(rand(10, 20));
  }

  // === PASSO 6: CLICAR NO BOTÃO ENVIAR ===
  console.log("[DEBUG] Aguardando botão de enviar...");

  const sendBtnSelectors = [
    'div[aria-label="Send"] svg[data-icon="wds-ic-send-filled"]',
    'div[aria-label="Enviar"] svg[data-icon="wds-ic-send-filled"]',
    'span[data-icon="wds-ic-send-filled"]',
    'div[role="button"][aria-label="Send"]',
    'div[role="button"][aria-label="Enviar"]',
    'span[data-icon="send"]',
  ];

  let sendClicked = false;
  for (const sel of sendBtnSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 8000, visible: true });
      await page.click(sel);
      sendClicked = true;
      console.log(`[DEBUG] Enviado via seletor: ${sel}`);
      break;
    } catch (e) {}
  }

  if (!sendClicked) {
    throw new Error("Botão de enviar não encontrado após prévia");
  }

  console.log("[INFO] FOTO ENVIADA COM SUCESSO!");
  await sleep(rand(1000, 800));
}

module.exports = { startWhatsApp, startSending };
