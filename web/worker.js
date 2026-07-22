// SPDX-License-Identifier: GPL-3.0-only
//
// Live in-browser engine driver — game-agnostic.
//
// The init message names a game id. The worker reads games/<id>/manifest.js to
// learn its board + ROM images, dynamically imports the game's machine and the
// board's Inputs, takes the ROM binaries from the init message when the page
// supplied them (assembled + sha256-verified in the page from the visitor's own
// zip — see web/romzip.js) and otherwise fetches the locally-built ones, then
// runs the REAL engine with zero edits: LiveMachine subclasses the game's Machine
// and overrides
// only the two per-frame seams the run loop already calls — applyInputs() (read
// live keys from the shared control buffer) and finishRasterFrame() (publish the
// frame to the shared framebuffer + pace to 60fps).

// ctrl Int32Array indices (shared with the page):
const C_IN0 = 0, C_IN1 = 1, C_IN2 = 2, C_PAUSED = 3, C_COUNTER = 4,
      C_RUNNING = 5, C_RESET = 6, C_SLEEP = 7;

let ctrl = null;   // Int32Array over the shared control buffer
let fb = null;     // Uint8Array over the shared (double-buffered) framebuffer
let FRAME_BYTES = 0;
let PORTS = null;  // {in0,in1,in2} input port addresses, from manifest.inputs.ports

function makeLive(Machine) {
  return class LiveMachine extends Machine {
    applyInputs(_frameIndex) {
      if (Atomics.load(ctrl, C_RESET) === 1) {
        Atomics.store(ctrl, C_RESET, 0);
        throw new Error("__reset__"); // unwinds runFrames; worker reboots to attract
      }
      this.io.inputAssert = {
        [PORTS.in0]: Atomics.load(ctrl, C_IN0) & 0xff, // IN0 joystick + jump (P1)
        [PORTS.in1]: Atomics.load(ctrl, C_IN1) & 0xff, // IN1 (P2 / cocktail)
        [PORTS.in2]: Atomics.load(ctrl, C_IN2) & 0xff, // IN2 coin / start
      };
    }

    finishRasterFrame() {
      super.finishRasterFrame();
      const vf = this.videoFrames;
      if (vf.length) {
        const frame = vf[vf.length - 1];
        const counter = Atomics.load(ctrl, C_COUNTER);
        fb.set(frame, (counter % 2) * FRAME_BYTES); // write the back slot
        Atomics.store(ctrl, C_COUNTER, counter + 1); // publish -> page reads front
        vf.length = 0;
      }
      const fl = this.frames.length;         // bound memory over a long session
      if (fl >= 3) this.frames[fl - 3] = null;
      this._pace();
    }

    _pace() {
      while (
        Atomics.load(ctrl, C_PAUSED) === 1 &&
        Atomics.load(ctrl, C_RUNNING) === 1 &&
        Atomics.load(ctrl, C_RESET) === 0
      ) {
        Atomics.wait(ctrl, C_SLEEP, 0, 80);
        this._next = performance.now();
      }
      const now = performance.now();
      if (this._next === undefined) this._next = now;
      const delay = this._next - now;
      if (delay > 1) Atomics.wait(ctrl, C_SLEEP, 0, delay); // precise sleep, no busy-wait
      this._next += 1000 / 60;
      if (performance.now() - this._next > 500) this._next = performance.now();
    }
  };
}

async function fetchBin(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function run(gameId, provided) {
  const manifest = (await import(`../games/${gameId}/manifest.js`)).default;
  PORTS = manifest.inputs.ports; // input port addresses -> inputAssert slots (IN0/IN1/IN2)
  const { Machine } = await import(`../games/${gameId}/machine.js`);
  const { Inputs } = await import(`../boards/${manifest.board}/io.js`);
  const LiveMachine = makeLive(Machine);

  // Every declared ROM image, per image: use the one the page handed us (already
  // size- and sha256-checked there) if present, else fetch the locally-built
  // .bin — so the `make rom` developer path keeps working untouched.
  const names = Object.keys(manifest.rom.images);
  const bins = await Promise.all(names.map((n) => {
    const supplied = provided && provided[n];
    // Transferred as ArrayBuffers; a Uint8Array copies just as happily.
    if (supplied) return new Uint8Array(supplied);
    return fetchBin(`../games/${gameId}/rom/${n}.bin`);
  }));
  const images = Object.fromEntries(names.map((n, i) => [n, bins[i]]));
  const { maincpu, ...gfx } = images;

  const sw = manifest.screen?.width ?? 256, sh = manifest.screen?.height ?? 224;
  FRAME_BYTES = sw * sh * 3;
  postMessage({ type: "ready" });

  while (Atomics.load(ctrl, C_RUNNING) === 1) {
    const m = new LiveMachine(maincpu, { inputs: new Inputs(), ...gfx });
    m.captureVideo = true;
    m._next = performance.now();
    let reason = null;
    try {
      m.runFrames(5_000_000); // huge budget; every frame is paced to 1/60s
      reason = m.stoppedBy || "budget reached";
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (msg === "__reset__") { postMessage({ type: "reset" }); continue; }
      reason = msg;
    }
    if (Atomics.load(ctrl, C_RUNNING) === 0) break;
    postMessage({ type: "restart", reason }); // translation gap or budget: reboot
  }
}

onmessage = (e) => {
  const d = e.data;
  if (d.type === "init") {
    ctrl = new Int32Array(d.ctrl);
    fb = new Uint8Array(d.fb);
    run(d.game, d.images).catch((err) =>
      postMessage({ type: "error", reason: String((err && err.stack) || err) }));
  }
};
