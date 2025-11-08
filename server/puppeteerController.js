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

// === ENVIO DE IMAGEM ===
async function sendImage(page, imagePath, caption) {
  const attachSelectors = [
    'button[aria-label="Anexar"]',
    'span[data-icon="clip"]',
    'span[data-icon="plus"]',
    'div[aria-label="Anexar"]',
  ];

  let attached = false;
  for (const sel of attachSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 3000 });
      await page.click(sel);
      attached = true;
      break;
    } catch {}
  }

  if (!attached) throw new Error("Botão de anexar não encontrado");

  const input = await page.$('input[type="file"]');
  if (!input) throw new Error("Input de arquivo não encontrado");
  await input.uploadFile(imagePath);
  await sleep(rand(800, 1200));

  const captionBox = await page.$('div[contenteditable="true"][data-tab="10"]');
  if (captionBox && caption) {
    await typeHuman(
      page,
      'div[contenteditable="true"][data-tab="10"]',
      caption
    );
    await sleep(rand(200, 400));
  }

  const sendBtn = await page.$('span[data-icon="send"]');
  if (!sendBtn) throw new Error("Botão enviar não encontrado");
  await sendBtn.click();
  await sleep(rand(1000, 1500));
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

module.exports = { startWhatsApp, startSending };
