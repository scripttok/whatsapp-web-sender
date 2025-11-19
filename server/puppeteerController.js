// server/puppeteerController.js
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { getSession, updateSession } = require("./sessionManager");
const { setSending } = require("./sessionManager");

const { io } = require("./index");

// === ESTADO DE ENVIO POR SESSÃO ===
const sendingState = new Map(); // sessionId → { paused: bool, shouldStop: bool }

// === FUNÇÕES AUXILIARES ===
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function typeHuman(page, selector, text) {
  if (typeof selector !== "string") return;
  try {
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press("Backspace");
    for (const char of text) {
      await page.keyboard.type(char);
      await sleep(rand(40, 100));
    }
  } catch (e) {}
}

async function mouseHuman(page) {
  try {
    const { width, height } = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    for (let i = 0; i < rand(1, 3); i++) {
      await page.mouse.move(rand(0, width), rand(0, height), {
        steps: rand(6, 12),
      });
      await sleep(rand(50, 150));
    }
  } catch (e) {}
}

// === INICIAR WHATSAPP ===
async function startWhatsApp(sessionId) {
  const session = getSession(sessionId);
  if (!session || session.browser) return;

  console.log(`[PLAYWRIGHT] Iniciando navegador para sessão: ${sessionId}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-site-isolation-trials",
      "--disable-blink-features=AutomationControlled",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--disable-extensions",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });

  // Remove qualquer rastro de automação
  await context.addInitScript(() => {
    delete navigator.__proto__.webdriver;
    window.chrome = { runtime: {}, app: {}, webstore: {} };
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, "languages", {
      get: () => ["pt-BR", "pt", "en"],
    });
  });

  const page = await context.newPage();

  // Bloqueia recursos pesados (economiza RAM e velocidade)
  await page.route("**/*", (route) => {
    const blocked = ["image", "stylesheet", "font", "media"];
    if (blocked.includes(route.request().resourceType())) {
      route.abort();
    } else {
      route.continue();
    }
  });

  await page.goto("https://web.whatsapp.com", {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });

  updateSession(sessionId, { page, browser, context, status: "qr" });

  // Emite QR Code
  page.waitForSelector("canvas", { timeout: 0 }).then(async () => {
    try {
      const qr = await page.evaluate(() => {
        const canvas = document.querySelector("canvas");
        return canvas ? canvas.toDataURL() : null;
      });
      if (qr) io.to(sessionId).emit("qr", qr);
    } catch (e) {}
  });

  // Detecta quando conectar
  try {
    await page.waitForSelector("div#side", { timeout: 120000 });
    io.to(sessionId).emit("connected");
    updateSession(sessionId, { status: "connected" });
    console.log(`[PLAYWRIGHT] WhatsApp conectado com sucesso: ${sessionId}`);
  } catch (e) {
    io.to(sessionId).emit("error", "QR Code expirou ou falha na conexão");
  }
}

// === ENVIO COM PAUSA / PARAR ===
async function startSending(sessionId, caption, selectedNumbers) {
  const session = getSession(sessionId);
  if (!session || !session.page || !session.imagePath) return;

  sendingState.set(sessionId, { paused: false, shouldStop: false });
  setSending(sessionId, true);

  try {
    const { page, imagePath } = session;
    const numbers = selectedNumbers;

    console.log(
      `[ENVIO] Iniciando envio para ${numbers.length} contatos - Sessão: ${sessionId}`
    );

    for (let i = 0; i < numbers.length; i++) {
      const state = sendingState.get(sessionId) || {
        shouldStop: false,
        paused: false,
      };

      if (state.shouldStop) {
        console.log(`[ENVIO] Parado manualmente pelo usuário.`);
        break;
      }

      while (state.paused) {
        await sleep(500);
        const newState = sendingState.get(sessionId);
        if (newState?.shouldStop) break;
      }

      const num = numbers[i];
      const remaining = numbers.length - i;

      // Volta pra tela inicial
      try {
        await page.bringToFront();
        await page.goto("https://web.whatsapp.com", {
          waitUntil: "domcontentloaded",
        });
        await page.waitForSelector("div#side", { timeout: 10000 });
      } catch (_) {}

      let success = false;
      try {
        success = await openChat(page, num);
      } catch (err) {
        console.log(`[ERRO] Falha ao abrir chat ${num}: ${err.message}`);
      }

      if (success) {
        try {
          await mouseHuman(page);
          await sendImage(page, imagePath, caption);
          session.progress.sentNumbers.push(num);
          session.progress.sent++;
        } catch (err) {
          console.log(`[ERRO] Falha ao enviar para ${num}: ${err.message}`);
          session.progress.failedNumbers.push(num);
          session.progress.failed++;
        }
      } else {
        session.progress.failedNumbers.push(num);
        session.progress.failed++;
      }

      session.progress.pending = remaining - 1;
      io.to(sessionId).emit("progress", { ...session.progress });

      if (i < numbers.length - 1 && !state.shouldStop) {
        await sleep(rand(2000, 4500)); // Intervalo mais humano
      }
    }

    io.to(sessionId).emit("complete");
    console.log(`[ENVIO] Finalizado - Sessão: ${sessionId}`);
  } finally {
    sendingState.delete(sessionId);
    setSending(sessionId, false);
  }
}

// === FUNÇÕES QUE VOCÊ JÁ TINHA (mantidas 100% funcionais) ===
async function openChat(page, number) {
  console.log(`[DEBUG] Abrindo chat com ${number}...`);

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
      break;
    } catch (_) {}
  }

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
        break;
      }
    } catch (_) {}
  }

  if (!searchBox) {
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

  await searchBox.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await typeHuman(page, activeSelector, number);
  await sleep(rand(600, 1200));

  const notFound = await page.evaluate(() => {
    const span = document.querySelector(
      "div.x1f6kntn.x1fc57z9.xhslqc4 span._ao3e"
    );
    return span && span.innerText.includes("No results found");
  });

  if (notFound) return false;

  try {
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

    await page.evaluate((num) => {
      const items = Array.from(
        document.querySelectorAll('div[role="option"], div[role="button"]')
      );
      for (const i of items) {
        if (i.innerText && i.innerText.includes(num)) {
          i.scrollIntoView({ block: "center" });
          i.click();
          break;
        }
      }
    }, number);
  } catch (_) {
    await page.keyboard.press("Enter");
  }

  try {
    await page.waitForSelector("div[contenteditable='true'][data-tab]", {
      timeout: 10000,
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function sendImage(page, imagePath, caption) {
  const attachSelectors = [
    'button[aria-label="Anexar"]',
    'span[data-icon="clip"]',
    'span[data-icon="plus"]',
    'div[aria-label="Anexar"]',
  ];

  let menuOpened = false;
  for (const sel of attachSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 2000 });
      await page.click(sel);
      menuOpened = true;
      break;
    } catch (_) {}
  }

  if (!menuOpened) throw new Error("Botão de anexar não encontrado");

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page
      .click('input[type="file"][accept*="image/*"]', { timeout: 5000 })
      .catch(() => {}),
  ]);

  const normalizedPath = path.resolve(imagePath);
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`Imagem não encontrada: ${normalizedPath}`);
  }

  await fileChooser.setFiles(normalizedPath);
  await sleep(rand(1500, 2500));

  if (caption) {
    const captionBox =
      (await page.$("div[contenteditable='true'][data-tab='10']")) ||
      (await page.$("div[contenteditable='true'][aria-placeholder]"));
    if (captionBox) {
      await captionBox.click();
      await page.keyboard.type(caption, { delay: rand(30, 80) });
    }
  }

  await sleep(rand(800, 1500));

  const sendBtn =
    (await page.$('span[data-icon="send"]')) ||
    (await page.$('button[aria-label="Enviar"]')) ||
    (await page.$('span[data-icon="wds-ic-send-filled"]'));

  if (sendBtn) {
    await sendBtn.click();
  } else {
    await page.keyboard.press("Enter");
  }

  await sleep(rand(1000, 2000));
}

function getSendingState(sessionId) {
  return sendingState.get(sessionId) || { paused: false, shouldStop: false };
}

function pauseSending(sessionId) {
  const state = sendingState.get(sessionId) || {};
  state.paused = true;
  sendingState.set(sessionId, state);
}

function resumeSending(sessionId) {
  const state = sendingState.get(sessionId) || {};
  state.paused = false;
  sendingState.set(sessionId, state);
}

function stopSending(sessionId) {
  const state = sendingState.get(sessionId) || {};
  state.shouldStop = true;
  sendingState.set(sessionId, state);
}

// Exporta tudo
module.exports = {
  startWhatsApp,
  startSending,
  getSendingState,
  pauseSending,
  resumeSending,
  stopSending,
};
