// ego-browser nodejs 로 실행하는 장면 캡처 스크립트, 1920x1080 프레임 기준
// 실행 기준: ego-browser nodejs < video/capture.mjs
const fs = await import("node:fs");
const DIR = "/Users/hahmjuntae/Desktop/workspace/personal/hackathons/nebius-nvidia-wt/submit-prep/video";
const DEMO = "https://repropilot.graphite-site.workers.dev/";
const REPO = "https://github.com/hahmjuntae/repropilot";
const scenes = JSON.parse(fs.readFileSync(`${DIR}/scenes.json`, "utf8"));
fs.mkdirSync(`${DIR}/frames`, { recursive: true });

const task = await taskSpace("repropilot demo capture");
const page = task.page("p1");
await page.cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 810, deviceScaleFactor: 1920 / 1440, mobile: false });

async function caption(text) {
  await page.evaluate((text) => {
    let el = document.getElementById("__cap");
    if (!el) {
      el = document.createElement("div");
      el.id = "__cap";
      el.style.cssText = "position:fixed;left:50%;bottom:26px;transform:translateX(-50%);width:max-content;max-width:1180px;padding:12px 26px;border-radius:12px;background:rgba(10,12,16,.86);color:#fff;font:600 24px/1.45 Inter,-apple-system,'Segoe UI',sans-serif;text-align:center;z-index:99999";
      document.body.appendChild(el);
    }
    el.textContent = text;
  }, text);
}

async function shot(file) {
  const res = await page.cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(file, Buffer.from(res.data, "base64"));
}

async function scrollTo(y) {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(250);
}

async function playToEnd() {
  await page.goto(DEMO);
  await page.waitForSelector("text=Play recorded run");
  await page.click("text=Play recorded run", { label: "play recorded run" });
  await page.waitForFunction(() => document.body.innerText.includes("Reproduced and fixed"), undefined, { timeout: 90000 });
}

async function tab(name) {
  await page.click(`loc=role:tab[name*="${name}"]`, { label: `open ${name} tab` });
  await scrollTo(400);
}

let played = false;
const setups = {
  async landing() {
    await page.goto(DEMO);
    await page.waitForSelector("text=Play recorded run");
    played = false;
  },
  async issue() {
    await page.goto(`${REPO}/blob/main/examples/batchkit/ISSUE.md`);
    await page.waitForFunction(() => document.body.innerText.includes("silently drops trailing items"), undefined, { timeout: 30000 });
    await scrollTo(260);
  },
  async running() {
    await page.goto(DEMO);
    await page.waitForSelector("text=Play recorded run");
    await page.click("text=Play recorded run", { label: "play recorded run" });
    await page.waitForFunction(() => document.body.innerText.includes("Runs (1)"), undefined, { timeout: 60000 });
    await page.click("text=Stop", { label: "pause the replay" });
    await scrollTo(380);
  },
  async "runs-first"() {
    if (!played) await playToEnd();
    played = true;
    await tab("Runs");
    await page.evaluate(() => {
      const all = [...document.querySelectorAll("details.run")];
      all.forEach((d, i) => (d.open = i === 0));
    });
  },
  async "tab-test"() { await tab("Failing test"); },
  async "tab-patch"() { await tab("Patch"); },
  async "tab-pr"() { await tab("PR draft"); },
  async "readme-models"() {
    await page.goto(`${REPO}#where-nemotron-and-token-factory-are-used`);
    await page.waitForFunction(() => document.body.innerText.includes("Where Nemotron and Token Factory are used"), undefined, { timeout: 30000 });
    await page.evaluate(() => {
      const h = [...document.querySelectorAll("h2")].find((n) => n.textContent.includes("Where Nemotron"));
      if (h) window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 40);
    });
    await page.waitForTimeout(300);
  },
};

let n = 0;
for (const scene of scenes) {
  await setups[scene.setup]();
  for (const line of scene.lines) {
    n += 1;
    await caption(line);
    await shot(`${DIR}/frames/${String(n).padStart(2, "0")}.png`);
  }
  await caption("");
  await page.evaluate(() => document.getElementById("__cap")?.remove());
  if (scene.id === "intro") await shot(`${DIR}/frames/clean-landing.png`);
  if (scene.id === "patch") await shot(`${DIR}/frames/clean-patch.png`);
}
console.log({ space: task.spaceId, frames: n });
