#!/usr/bin/env node
// Drives headless Chrome over the DevTools protocol to take screenshots of the running app.
// No dependencies: uses the installed Google Chrome and Node's built-in fetch and WebSocket.
//
//   node scripts/screenshot.mjs <steps.json> <out-dir>
//
// steps.json is an array run in order; each step may combine these keys:
//   { "viewport": [375, 812], "dark": false }   viewport size and colour scheme
//   { "url": "http://localhost:3000/ja" }        navigate (then wait `waitAfter` ms, default 2500)
//   { "click": "text" }                          click the first button/link whose text or
//                                                aria-label contains it (exact text wins)
//   { "eval": "js expression" }                  run in the page and print the result
//   { "wait": 500 }                              pause
//   { "shot": "name", "full": true }             save <out-dir>/name.png (full = whole page)
// Page errors are printed at the end. Set CHROME to override the Chrome binary.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [stepsFile, outDir] = process.argv.slice(2);
if (!stepsFile || !outDir) {
  console.error("usage: node scripts/screenshot.mjs <steps.json> <out-dir>");
  process.exit(2);
}
const steps = JSON.parse(readFileSync(stepsFile, "utf8"));
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(
  process.env.CHROME ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "screenshot-"))}`,
    "--no-first-run",
    "--autoplay-policy=no-user-gesture-required",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let page;
for (let i = 0; i < 50 && !page; i++) {
  await sleep(200);
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    page = targets.find((t) => t.type === "page");
  } catch {
    // Chrome is still starting.
  }
}
if (!page) {
  chrome.kill();
  throw new Error("Chrome did not start");
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => (ws.onopen = resolve));
let lastId = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (message) => {
  const msg = JSON.parse(message.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.exceptionThrown") {
    errors.push(msg.params.exceptionDetails);
  } else if (
    msg.method === "Runtime.consoleAPICalled" &&
    msg.params.type === "error"
  ) {
    errors.push(msg.params.args.map((a) => a.value ?? a.description));
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++lastId;
    pending.set(id, (msg) =>
      msg.error
        ? reject(new Error(`${method}: ${msg.error.message}`))
        : resolve(msg.result),
    );
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text,
    );
  }
  return result.result.value;
};

let width = 375;
let height = 812;
let dark = false;
const applyViewport = async (h = height) => {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height: h,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
  await send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: dark ? "dark" : "light" },
    ],
  });
};

await send("Page.enable");
await send("Runtime.enable");
await applyViewport();

for (const step of steps) {
  if (step.viewport || step.dark !== undefined) {
    [width, height] = step.viewport ?? [width, height];
    dark = step.dark ?? dark;
    await applyViewport();
  }
  if (step.url) {
    await send("Page.navigate", { url: step.url });
    await sleep(step.waitAfter ?? 2500);
  }
  if (step.click) {
    const clicked = await evaluate(`(() => {
      const want = ${JSON.stringify(step.click)};
      const els = [...document.querySelectorAll("button, a, label, [role=button]")];
      const el =
        els.find((e) => e.textContent.trim() === want) ??
        els.find((e) => e.textContent.includes(want)) ??
        els.find((e) => (e.getAttribute("aria-label") ?? "").includes(want));
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!clicked) console.log(`click: no element matches "${step.click}"`);
    await sleep(step.waitAfter ?? 400);
  }
  if (step.eval)
    console.log("eval:", JSON.stringify(await evaluate(step.eval)));
  if (step.wait) await sleep(step.wait);
  if (step.shot) {
    if (step.full) {
      await applyViewport(
        await evaluate("document.documentElement.scrollHeight"),
      );
      await sleep(300);
    }
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(
      join(outDir, `${step.shot}.png`),
      Buffer.from(data, "base64"),
    );
    if (step.full) await applyViewport();
    console.log(`shot: ${join(outDir, `${step.shot}.png`)}`);
  }
}

for (const error of errors) {
  console.log("page error:", JSON.stringify(error).slice(0, 400));
}
ws.close();
chrome.kill();
