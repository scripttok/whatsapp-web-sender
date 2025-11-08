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
  if (typeof selector !== "string") return;
  const handle = await page.$(selector);
  if (!handle) return;
  for (const char of text) {
    await handle.type(char, { delay: rand(30, 80) });
    await sleep(rand(15, 40));
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

    // === SEMPRE VOLTAR PARA TELA PRINCIPAL ANTES DE TENTAR NOVO NÚMERO ===
    try {
      await page.goBack({ waitUntil: "networkidle0" });
      await sleep(1000);
      await page.waitForSelector("div#side", { timeout: 10000 });
    } catch (e) {
      console.log("[INFO] Já na tela principal ou erro ao voltar.");
    }

    let success = false;
    try {
      success = await openChat(page, num);
    } catch (err) {
      console.log(`[ERRO] Erro ao abrir chat ${num}: ${err.message}`);
    }

    if (success) {
      try {
        await mouseHuman(page);
        await sendImage(page, imagePath, caption);
        session.progress.sentNumbers.push(num);
        session.progress.sent++;
      } catch (err) {
        console.log(
          `[ERRO] Falha ao enviar imagem para ${num}: ${err.message}`
        );
        session.progress.failedNumbers.push(num);
        session.progress.failed++;
      }
    } else {
      console.log(`[PULADO] Número inválido ou sem WhatsApp: ${num}`);
      session.progress.failedNumbers.push(num);
      session.progress.failed++;
    }

    // Atualiza progresso
    session.progress.pending = remaining - 1;
    io.to(sessionId).emit("progress", { ...session.progress });

    if (i < numbers.length - 1) {
      await sleep(rand(1200, 2500)); // Delay entre envios
    }
  }

  io.to(sessionId).emit("complete");
  console.log(`[PUPPETEER] Envio concluído para sessão: ${sessionId}`);
}

// === ABRIR CHAT (100% COMO A VERSÃO ORIGINAL + CORREÇÕES) ===
async function openChat(page, number) {
  console.log(`[DEBUG] Abrindo chat com ${number}...`);

  // === 1. CLICAR EM "NOVA CONVERSA" ===
  const newChatSelectors = [
    'span[data-icon="new-chat-outline"]',
    'button[aria-label="Nova conversa"]',
  ];

  let newChatClicked = false;
  for (const sel of newChatSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 5000 });
      await page.click(sel);
      await sleep(rand(300, 600));
      newChatClicked = true;
      console.log(`[DEBUG] "Nova conversa" clicado via: ${sel}`);
      break;
    } catch (_) {}
  }

  if (!newChatClicked) {
    console.log('[WARN] Botão "Nova conversa" não encontrado.');
  }

  // === 2. ENCONTRAR CAMPO DE BUSCA ===
  const searchSelectors = [
    'input[title="Pesquisar ou começar uma nova conversa"]',
    'div[contenteditable="true"][data-tab="3"]',
  ];

  let searchBox = null;
  let activeSelector = null;

  for (const sel of searchSelectors) {
    try {
      const handle = await page.$(sel);
      if (handle) {
        searchBox = handle;
        activeSelector = sel;
        console.log(`[DEBUG] Campo de busca encontrado: ${sel}`);
        break;
      }
    } catch (_) {}
  }

  if (!searchBox) {
    console.log("[INFO] Campo de busca não encontrado. Tentando URL direta...");
    await page.goto(`https://web.whatsapp.com/send?phone=${number}`, {
      waitUntil: "networkidle2",
    });
    try {
      await page.waitForSelector("div[contenteditable='true'][data-tab]", {
        timeout: 10000,
      });
      return true;
    } catch {
      return false;
    }
  }

  // === 3. LIMPAR E DIGITAR NÚMERO ===
  await searchBox.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await typeHuman(page, activeSelector, number);
  await sleep(rand(500, 1000)); // EXATAMENTE COMO NA VERSÃO ORIGINAL

  // === 4. VERIFICAR "NO RESULTS FOUND" (EXATO COMO ORIGINAL) ===
  const notFound = await page.evaluate(() => {
    const span = document.querySelector(
      "div.x1f6kntn.x1fc57z9.xhslqc4 span._ao3e"
    );
    return span && span.innerText.includes("No results found");
  });

  if (notFound) {
    console.log(`[INFO] Nenhum resultado encontrado para ${number}. Pulando.`);
    return false;
  }

  // === 5. ESPERAR E CLICAR NO CARD (com Puppeteer) ===
  let cardClicked = false;

  try {
    // Espera o card aparecer (com texto do número)
    await page.waitForFunction(
      (num) => {
        const items = Array.from(
          document.querySelectorAll('div[role="option"], div[role="button"]')
        );
        return items.some((i) => i.innerText && i.innerText.includes(num));
      },
      { timeout: 5000 },
      number
    );

    // CLIQUE COM PUPPETEER (mais confiável que evaluate)
    const clicked = await page.evaluate((num) => {
      const items = Array.from(
        document.querySelectorAll('div[role="option"], div[role="button"]')
      );
      for (const i of items) {
        if (i.innerText && i.innerText.includes(num)) {
          i.scrollIntoView({ block: "center" });
          i.click();
          return true;
        }
      }
      return false;
    }, number);

    cardClicked = clicked;
  } catch (_) {}

  if (!cardClicked) {
    console.log(`[WARN] Card não clicado. Tentando Enter...`);
    await page.keyboard.press("Enter");
    await sleep(600);
  }

  // === 6. AGUARDAR CAMPO DE MENSAGEM ===
  try {
    await page.waitForSelector("div[contenteditable='true'][data-tab]", {
      timeout: 10000,
    });
    console.log("[DEBUG] Chat aberto com sucesso.");
    return true;
  } catch (e) {
    console.log(`[FALHA] Campo de mensagem não apareceu: ${number}`);
    return false;
  }
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
    await sleep(rand(5, 10));
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
      await page.waitForSelector(sel, { timeout: 100, visible: true });
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
