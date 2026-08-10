// Точка входа демо — SkinViewEngine на Three.js + skin3d
import { SkinViewEngine, SkinModelType, type SkinSource } from "../../src/index.ts";
import { initViewerControls } from "./viewer-controls.ts";
import { createTestSkinDataUrl } from "./test-skin.ts";
import demoSkinUrl from "./assets/target-skin.png";

const canvas = document.getElementById("skin-canvas") as HTMLCanvasElement | null;
const canvasWrap = document.getElementById("canvas-wrap");
const fileInput = document.getElementById("skin-file") as HTMLInputElement | null;
const urlInput = document.getElementById("skin-url") as HTMLInputElement | null;
const usernameInput = document.getElementById("skin-username") as HTMLInputElement | null;
const btnApplyUrl = document.getElementById("btn-apply-url");
const btnLoadUsername = document.getElementById("btn-load-username");
const btnDemoSkin = document.getElementById("btn-demo-skin");
const btnClassic = document.getElementById("btn-classic");
const btnSlim = document.getElementById("btn-slim");
const statusEl = document.getElementById("status");

if (!canvas) {
  throw new Error("Canvas #skin-canvas не найден");
}

const engine = new SkinViewEngine(canvas, {
  modelType: SkinModelType.Classic,
  autoDetectModel: true,
  idleAnimation: true,
});

engine.start();

// Диагностический хук: доступ к движку из devtools-консоли демо
(window as unknown as { __engine?: SkinViewEngine }).__engine = engine;

let activeBlobUrl: string | null = null;

type SkinLoadKind = "demo" | "file" | "url" | "username";

// ===== Статус и загрузка скина =====
function showStatus(message: string, isError = false): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function clearStatus(): void {
  showStatus("");
}

function revokeBlobUrl(): void {
  if (activeBlobUrl) {
    URL.revokeObjectURL(activeBlobUrl);
    activeBlobUrl = null;
  }
}

function formatSkinLoadError(err: unknown, kind: SkinLoadKind): string {
  const detail = err instanceof Error ? err.message : String(err);
  if (kind === "demo") {
    return `Не удалось загрузить демо-скин: ${detail}`;
  }
  if (kind === "file") {
    return `Не удалось прочитать PNG-файл: ${detail}`;
  }
  if (kind === "username") {
    return `Не удалось загрузить скин по нику: ${detail}`;
  }
  return `Не удалось загрузить скин по URL. Проверьте адрес и CORS на сервере. (${detail})`;
}

async function applySkin(source: SkinSource, kind: SkinLoadKind): Promise<boolean> {
  try {
    clearStatus();
    await engine.setSkin(source);
    console.info("[skinviewengine] скин загружен, модель:", engine.modelType);
    return true;
  } catch (err) {
    console.error("[skinviewengine] ошибка загрузки скина:", err);
    showStatus(formatSkinLoadError(err, kind), true);
    return false;
  }
}

async function loadFromFile(file: File): Promise<void> {
  if (file.type !== "image/png") {
    showStatus("Поддерживается только PNG (64×64 или 64×32).", true);
    return;
  }

  revokeBlobUrl();
  activeBlobUrl = URL.createObjectURL(file);
  await applySkin(activeBlobUrl, "file");
}

async function loadDemoSkin(): Promise<void> {
  revokeBlobUrl();
  if (fileInput) fileInput.value = "";

  if (await applySkin(demoSkinUrl, "demo")) return;

  console.warn("[skinviewengine] fallback на встроенный тестовый скин");
  await applySkin(createTestSkinDataUrl(), "demo");
}

async function loadFromUrl(rawUrl: string): Promise<void> {
  const url = rawUrl.trim();
  if (!url) {
    showStatus("Введите URL скина.", true);
    return;
  }

  revokeBlobUrl();
  await applySkin(url, "url");
}

async function loadFromUsername(rawUsername: string): Promise<void> {
  const username = rawUsername.trim();
  if (!username) {
    showStatus("Введите никнейм Minecraft.", true);
    return;
  }

  revokeBlobUrl();
  if (fileInput) fileInput.value = "";

  btnLoadUsername?.toggleAttribute("disabled", true);
  showStatus(`Загрузка скина для «${username}»…`);

  try {
    await engine.setSkinByUsername(username);
    clearStatus();
    console.info("[skinviewengine] скин по нику загружен, модель:", engine.modelType);
  } catch (err) {
    console.error("[skinviewengine] ошибка загрузки по нику:", err);
    showStatus(formatSkinLoadError(err, "username"), true);
  } finally {
    btnLoadUsername?.toggleAttribute("disabled", false);
  }
}

// ===== UI: файл, URL, демо-скин =====
fileInput?.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void loadFromFile(file);
});

btnApplyUrl?.addEventListener("click", () => {
  void loadFromUrl(urlInput?.value ?? "");
});

btnLoadUsername?.addEventListener("click", () => {
  void loadFromUsername(usernameInput?.value ?? "");
});

usernameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void loadFromUsername(usernameInput.value);
});

urlInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void loadFromUrl(urlInput.value);
});

btnDemoSkin?.addEventListener("click", () => {
  void loadDemoSkin();
});

btnClassic?.addEventListener("click", () => {
  engine.setModelType(SkinModelType.Classic);
});

btnSlim?.addEventListener("click", () => {
  engine.setModelType(SkinModelType.Slim);
});

// ===== Drag-and-drop PNG на canvas =====
function isPngFile(file: File): boolean {
  return file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
}

canvasWrap?.addEventListener("dragover", (e) => {
  e.preventDefault();
  canvasWrap.classList.add("drag-over");
});

canvasWrap?.addEventListener("dragleave", (e) => {
  if (e.currentTarget === e.target || !canvasWrap.contains(e.relatedTarget as Node)) {
    canvasWrap.classList.remove("drag-over");
  }
});

canvasWrap?.addEventListener("drop", (e) => {
  e.preventDefault();
  canvasWrap.classList.remove("drag-over");

  const file = [...(e.dataTransfer?.files ?? [])].find(isPngFile);
  if (!file) {
    showStatus("Перетащите PNG-файл скина.", true);
    return;
  }

  if (fileInput) {
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
  }

  void loadFromFile(file);
});

// ===== Стартовый скин и панель управления =====
void loadDemoSkin();
initViewerControls(engine);

// Classic / slim — клавиши 1 и 2
window.addEventListener("keydown", (e) => {
  if (e.key === "1") engine.setModelType(SkinModelType.Classic);
  if (e.key === "2") engine.setModelType(SkinModelType.Slim);
});

window.addEventListener("beforeunload", () => {
  revokeBlobUrl();
  engine.dispose();
});
