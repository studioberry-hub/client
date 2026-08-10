// Временный скрипт: рендерит diag-страницу в Electron и сохраняет PNG для сравнения до/после
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const url = process.argv[2] || "http://127.0.0.1:5174/diag.html";
const outFile = process.argv[3] || "scripts/out/capture.png";
const setupScript = process.argv[4] || "";

app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-unsafe-webgpu");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 760,
    height: 1040,
    show: false,
    backgroundColor: "#222222",
    webPreferences: { backgroundThrottling: false, offscreen: false },
  });

  await win.loadURL(url);

  // Ждём готовности сцены (скин загружен, первый кадр отрисован)
  for (let i = 0; i < 100; i++) {
    const ready = await win.webContents.executeJavaScript("!!window.diagReady");
    if (ready) break;
    await sleep(100);
  }

  if (setupScript) {
    await win.webContents.executeJavaScript(setupScript);
  }
  await win.webContents.executeJavaScript("window.engine.renderFrame(); true");
  await sleep(300);
  await win.webContents.executeJavaScript("window.engine.renderFrame(); true");
  await sleep(200);

  const rect = await win.webContents.executeJavaScript(
    "(()=>{const r=document.getElementById('skin-canvas').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()",
  );
  const img = await win.webContents.capturePage(rect);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, img.toPNG());
  console.log("saved", outFile, img.getSize());
  app.quit();
});
