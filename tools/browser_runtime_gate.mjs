#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
/**
 * Browser-runtime gate: the shipped web/player.html, run in a headless browser over the DevTools protocol --
 * the runtime web/test/games-boot.test.js (node) cannot reach. Serves the repo root with web/server.py's
 * headers (COOP/COEP/CORP, no-store) from an in-process server whose accept backlog survives the browser's
 * module-graph burst (web/server.py's default backlog resets those connections), loads
 * player.html?game=<g> with the developer ROM path, and asserts:
 *   boot     the page reaches "running" with no uncaught exception and no engine error;
 *   canvas   the presented frame is not uniform;
 *   keys     every manifest.inputs.keys binding, pressed as a real key event, stores its action's bit
 *            in the IN slot of its action's port (the page's Atomics.store, instrumented);
 *   audio    for a clips game, the coin's sound-latch edges reach the page and the clip player starts an
 *            AudioBufferSourceNode for them (a page that drops every sound fails here).
 * TEETH, in the same run: each mutant is the same page served under /__mutant/<name>/ with one file
 * rewritten on the fly (the working tree is never touched), and each must fail on its own check -- a
 * sound latch the player keys off the wrong address (audio), a coin action on the wrong bit (keys).
 *
 * ONE browser per invocation: the control and every mutant are tabs of that one instance, never a relaunch.
 * The browser is a non-system build when one exists (CHROME env, a Playwright-cached Chromium or headless
 * shell, Chrome for Testing); the user's own Google Chrome is the last fallback. Fails closed: no browser,
 * a ROM-less clone, a timeout, any failed assertion, or a mutant that passes prints a non-PASS line.
 *
 *   node tools/browser_runtime_gate.mjs --game G [--chrome PATH] [--timeout-ms N]
 * Prints `browser_runtime: PASS -- G` only when the control passes every check and every mutant fails.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer as httpServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Browser candidates, most preferred first: never the user's own Chrome while anything else exists. */
function browsers() {
  const out = [];
  if (process.env.CHROME) out.push(process.env.CHROME);
  const pw = join(homedir(), "Library", "Caches", "ms-playwright");
  const cache = existsSync(pw) ? readdirSync(pw).sort().reverse() : [];
  for (const d of cache.filter((x) => /^chromium-\d+$/.test(x))) {
    for (const arch of ["chrome-mac-arm64", "chrome-mac"]) {
      out.push(join(pw, d, arch, "Chromium.app", "Contents", "MacOS", "Chromium"));
    }
  }
  for (const d of cache.filter((x) => /^chromium_headless_shell-\d+$/.test(x))) {
    for (const arch of ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64"]) {
      out.push(join(pw, d, arch, "chrome-headless-shell"));
    }
  }
  out.push("/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome");
  return out;
}

// Installed before any page script: counts clip starts, keeps the worker's sound edges and the IN-slot stores.
const INSTRUMENT = `(() => {
  const rt = window.__rt = { starts: 0, sound: [], stores: [] };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) { rt.starts++; return start.apply(this, a); };
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(...a) {
      super(...a);
      this.addEventListener("message", (e) => { if (e.data?.type === "sound") rt.sound.push(...e.data.ev); });
    }
  };
  const store = Atomics.store;
  Atomics.store = function (arr, i, v) {
    if (arr instanceof Int32Array && i <= 2) rt.stores.push([i, v]);
    return store.call(this, arr, i, v);
  };
})();`;

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".json": "application/json",
  ".bin": "application/octet-stream", ".wav": "audio/wav", ".png": "image/png", ".css": "text/css" };

/** The mutants: { name: { file (repo-relative), edit(src) -> src, expect (the check that must fail) } }. */
function mutants(game, manifest) {
  const out = {};
  const player = readFileSync(join(REPO, "web", "player.html"), "utf8");
  if (manifest.audio?.samples && player.includes("const LATCH = SOUNDS.soundLatch;")) {
    out.latch = { file: "web/player.html", expect: "audio",
      edit: (s) => s.replace("const LATCH = SOUNDS.soundLatch;", "const LATCH = SOUNDS.soundLatch | 1;") };
  }
  const coin = manifest.inputs.actions.coin;
  const used = Object.values(manifest.inputs.actions).filter((a) => a.port === coin.port).reduce((b, a) => b | a.bit, 0);
  const spare = [0x80, 0x40, 0x20].find((b) => !(used & b));
  if (spare) {
    // Re-export the real manifest (its unprefixed URL) with only the coin bit moved.
    out.coinbit = { file: `games/${game}/manifest.js`, expect: "keys",
      edit: () => `import base from "/games/${game}/manifest.js";\nconst a = base.inputs.actions;\n` +
        `export default { ...base, inputs: { ...base.inputs, actions: { ...a, coin: { ...a.coin, bit: ${spare} } } } };\n` };
  }
  return out;
}

/** web/server.py's contract, loopback only; /__mutant/<name>/<path> serves <path> with that mutant applied. */
function serve(muts) {
  const server = httpServer((req, res) => {
    let rel = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^[/\\]+/, "");
    let mut = null;
    const m = /^__mutant\/([^/]+)\/(.*)$/.exec(rel.split(sep).join("/"));
    if (m) { mut = muts[m[1]]; rel = m[2]; }
    const path = join(REPO, rel);
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Cache-Control", "no-store");
    if ((m && !mut) || !(path === REPO || path.startsWith(REPO + sep)) || !existsSync(path) || !statSync(path).isFile()) {
      res.writeHead(404).end();
      return;
    }
    let body = readFileSync(path);
    if (mut && rel === mut.file) body = mut.edit(body.toString("utf8"));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", 1024, () => resolve(server)));
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.wait = new Map();
    this.events = [];
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.wait.has(d.id)) {
        const { resolve, reject } = this.wait.get(d.id);
        this.wait.delete(d.id);
        d.error ? reject(new Error(`${d.error.message}`)) : resolve(d.result);
      } else if (d.method) this.events.push(d);
    };
    this.open = new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = () => j(new Error("CDP socket error")); });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.wait.set(id, { resolve, reject }));
  }
}

/** One tab of the shared browser: load `url`, run every check; returns "PASS" or "FAIL -- <check>: ...". */
async function page(cdp, url, game, manifest, timeoutMs) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId: s } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  try {
    const ev = async (expression) => (await cdp.send("Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true }, s)).result.value;
    const key = async (code, type) => {
      const k = /^Digit(\d)$/.exec(code)?.[1] ?? /^Key([A-Z])$/.exec(code)?.[1]?.toLowerCase() ?? code;
      await cdp.send("Input.dispatchKeyEvent", { type, code, key: k, windowsVirtualKeyCode: 0 }, s);
    };
    const thrown = () => cdp.events.filter((e) => e.sessionId === s && e.method === "Runtime.exceptionThrown")
      .map((e) => e.params.exceptionDetails?.exception?.description ?? e.params.exceptionDetails?.text);
    await cdp.send("Runtime.enable", {}, s);
    await cdp.send("Page.enable", {}, s);
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT }, s);
    await cdp.send("Page.navigate", { url }, s);

    const t0 = Date.now();
    let status = "";
    while (Date.now() - t0 < timeoutMs) {
      status = (await ev("document.getElementById('status')?.textContent ?? ''").catch(() => "")) || "";
      if (/running/.test(status) || /error/i.test(status)) break;
      await sleep(250);
    }
    if (!/running/.test(status)) return `FAIL -- boot: status "${status}"${thrown().length ? `; ${thrown()[0]}` : ""}`;
    await sleep(1500);
    const colours = await ev(`(() => { const c = document.getElementById('screen');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 7) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return seen.size; })()`);
    if (!(colours >= 4)) return `FAIL -- canvas: the presented frame shows ${colours} colour(s)`;

    const { ports, actions, keys } = manifest.inputs;
    const slotOf = (p) => [ports.in0, ports.in1, ports.in2].indexOf(p);
    const heard0 = await ev("({ starts: window.__rt.starts, sound: window.__rt.sound.length })");
    // Coin keys last: the coin is the input whose ROM effect (a credit and its sound) the audio check hears.
    const order = Object.keys(keys).sort((a, b) => (keys[a] === "coin") - (keys[b] === "coin"));
    for (const code of order) {
      const act = actions[keys[code]];
      const before = await ev("window.__rt.stores.length");
      await key(code, "keyDown");
      await sleep(120);
      await key(code, "keyUp");
      await sleep(120);
      const stores = (await ev("window.__rt.stores")).slice(before);
      const slot = slotOf(act.port);
      if (!stores.some(([i, v]) => i === slot && (v & act.bit) === act.bit)) {
        return `FAIL -- keys: ${code} (${keys[code]}) never stored bit 0x${act.bit.toString(16)} in IN${slot}`;
      }
    }
    const latch = (await import(pathToFileURL(join(REPO, "games", game, manifest.audio?.map ?? "-")).href)
      .catch(() => null))?.default?.soundLatch;
    if (manifest.audio?.samples && latch != null) {
      if (!existsSync(join(REPO, "games", game, manifest.audio.samples, "index.json"))) {
        return "SKIP -- recorded clips absent (audio/samples/index.json): audio NOT validated";
      }
      await sleep(2000);
      const rt = await ev("({ starts: window.__rt.starts, sound: window.__rt.sound })");
      const edges = rt.sound.slice(heard0.sound).filter((v, i) => i % 2 === 0 && v === latch).length;
      if (!edges) return `FAIL -- audio: no sound-latch (0x${latch.toString(16)}) edge reached the page after the coin`;
      if (!(rt.starts > heard0.starts)) return `FAIL -- audio: ${edges} latch edge(s) arrived but no clip started`;
    }
    if (thrown().length) return `FAIL -- uncaught exception: ${thrown()[0]}`;
    return "PASS";
  } finally {
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

async function run(game, chrome, timeoutMs) {
  const manifest = (await import(pathToFileURL(join(REPO, "games", game, "manifest.js")).href)).default;
  const missing = Object.keys(manifest.rom.images).filter((n) => !existsSync(join(REPO, "games", game, "rom", `${n}.bin`)));
  if (missing.length) return `SKIP -- ROM images absent (${missing.join(", ")}): NOT validated`;
  const muts = mutants(game, manifest);
  const profile = mkdtempSync(join(tmpdir(), "browser-runtime-"));
  const server = await serve(muts);
  let browser = null;
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
      "--no-first-run", "--no-default-browser-check", "--mute-audio", "--autoplay-policy=no-user-gesture-required",
      "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
    const wsUrl = await new Promise((resolve, reject) => {
      let err = "";
      const t = setTimeout(() => reject(new Error(`the browser printed no DevTools URL: ${err.slice(-200)}`)), 20000);
      browser.stderr.on("data", (d) => {
        err += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
        if (m) { clearTimeout(t); resolve(m[1]); }
      });
    });
    const cdp = new Cdp(wsUrl);
    await cdp.open;
    const control = await page(cdp, `${base}/web/player.html?game=${game}`, game, manifest, timeoutMs);
    console.log(`  control: ${control}`);
    if (control !== "PASS") return control;
    for (const [name, mut] of Object.entries(muts)) {
      const got = await page(cdp, `${base}/__mutant/${name}/web/player.html?game=${game}`, game, manifest, timeoutMs);
      console.log(`  mutant ${name} (must fail ${mut.expect}): ${got}`);
      if (!got.startsWith(`FAIL -- ${mut.expect}:`)) return `FAIL -- teeth: mutant ${name} read "${got}"`;
    }
    return Object.keys(muts).length ? "PASS" : "FAIL -- teeth: no mutant applies to this game";
  } finally {
    if (browser) {
      await new Promise((r) => {
        if (browser.exitCode !== null || browser.signalCode !== null) return r();
        browser.once("exit", r);
        browser.kill("SIGKILL");
      });
    }
    server.close();
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* best effort */ }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
  const game = opt("--game");
  if (!game) { console.error("usage: browser_runtime_gate.mjs --game G [--chrome PATH] [--timeout-ms N]"); return 2; }
  const chrome = opt("--chrome") ?? browsers().find((c) => existsSync(c));
  if (!chrome || !existsSync(chrome)) { console.log("browser_runtime: SKIP -- no browser found: NOT validated"); return 1; }
  console.log(`  browser: ${chrome}`);
  let verdict;
  try { verdict = await run(game, chrome, Number(opt("--timeout-ms", "60000"))); }
  catch (e) { verdict = `FAIL -- ${e.message}`; }
  console.log(`browser_runtime: ${verdict}${verdict === "PASS" ? ` -- ${game}` : ""}`);
  return verdict === "PASS" ? 0 : 1;
}

main().then((rc) => process.exit(rc));
