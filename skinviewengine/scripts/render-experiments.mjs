// Диагностика швов: серия рендеров демо в headless-браузере с точечным отключением
// подозрительных настроек (тени, outer-слой, transparent, DoubleSide и т.д.).
// Запуск: node scripts/render-experiments.mjs  (нужен puppeteer-core в NODE_PATH)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// puppeteer-core ставится вне репозитория (диагностика, не зависимость пакета)
const PUPPETEER = process.env.SVE_PUPPETEER;
const puppeteer = (
  await import(PUPPETEER ? pathToFileURL(PUPPETEER).href : "puppeteer-core")
).default;

const URL_ = process.env.SVE_URL || "http://127.0.0.1:5180/";
const OUT_DIR = process.env.SVE_OUT || path.resolve("scripts/out");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

// Каждый эксперимент выполняется в контексте страницы над window.__engine
const EXPERIMENTS = {
  base: () => {},
  noShadow: () => {
    window.__engine.lighting.key.castShadow = false;
  },
  noOuter: () => {
    window.__skin().traverse((o) => {
      if (o.name === "outer") o.visible = false;
    });
  },
  noInner: () => {
    window.__skin().traverse((o) => {
      if (o.name === "inner") o.visible = false;
    });
  },
  outerOpaque: () => {
    window.__mats("outer").forEach((m) => {
      m.transparent = false;
      m.alphaTest = 0.5;
      m.needsUpdate = true;
    });
  },
  outerFrontSide: () => {
    window.__mats("outer").forEach((m) => {
      m.side = 0;
      m.needsUpdate = true;
    });
  },
  outerNoCast: () => {
    window.__skin().traverse((o) => {
      if (o.name === "outer") o.castShadow = false;
    });
  },
  bigBias: () => {
    const k = window.__engine.lighting.key;
    k.shadow.bias = -0.002;
    k.shadow.normalBias = 0.05;
  },
  noEnv: () => {
    window.__mats().forEach((m) => {
      m.envMap = null;
      m.needsUpdate = true;
    });
  },
};

// Хелперы доступа к скину/материалам, ставятся в страницу один раз
function installHelpers() {
  const engine = window.__engine;
  const player = Object.values(engine).find((v) => v && v.isObject3D && v.skin && v.cape);
  window.__skin = () => player.skin;
  window.__mats = (layer) => {
    const out = new Set();
    player.skin.traverse((o) => {
      if (!o.material) return;
      if (layer && o.name !== layer) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) out.add(m);
    });
    return [...out];
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-gpu-sandbox",
    "--no-sandbox",
    "--force-device-scale-factor=1",
  ],
});

const only = process.argv.slice(2);
for (const [name, fn] of Object.entries(EXPERIMENTS)) {
  if (only.length && !only.includes(name)) continue;

  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1100, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("[pageerror]", name, e.message));

  await page.goto(URL_, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction("!!window.__engine", { timeout: 30000 });
  await page.evaluate(() => {
    window.__engine.stop();
    window.__engine.controls.autoRotate = false;
  });
  await new Promise((r) => setTimeout(r, 2500));
  await page.evaluate(installHelpers);
  await page.evaluate(fn);
  await page.evaluate(() => {
    window.__engine.setCameraDistance(60);
    window.__engine.renderFrame();
    window.__engine.renderFrame();
  });
  await new Promise((r) => setTimeout(r, 300));

  const el = await page.$("#skin-canvas");
  const file = path.join(OUT_DIR, `exp_${name}.png`);
  fs.writeFileSync(file, await el.screenshot());
  console.log("saved", file);
  await page.close();
}

await browser.close();
