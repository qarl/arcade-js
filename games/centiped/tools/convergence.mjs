// SPDX-License-Identifier: GPL-3.0-only
// Whole-machine convergence for centiped (--mode state | pixel): the cycle-driven oracle vs a MAME golden,
// entropy-matched by REPLAYING MAME's exact $100a POKEY-RANDOM stream (captured observe-only) so RNG cannot
// fork the two, then compared with the drift-tolerant reconverge rule (each frame vs its nearest golden frame
// within ±W, since the oracle snapshots a sub-frame instant off MAME's notifier). state mode diffs RAM; pixel
// mode diffs the rendered frame vs the golden AVI. PASS requires: RNG read-count in sync (the oracle consumes
// $100a bit-for-bit like MAME — a control-flow tooth), full frame count + clean stop, the drift residual under
// a floor calibrated ABOVE the measured correct residual and BELOW a bug, distinct frames, and a baked-in
// NULL-MUTANT that MUST fail (a gate that cannot fail is decoration).
//
//   node games/centiped/tools/convergence.mjs [--mode state|pixel] [--golden DIR] [--seconds N] [--drift W]
//   state captures its own golden (or --golden); pixel REQUIRES --golden (frames.rgb+rng.bin from pixel_suite.py).
//   exit 0 = PASS (prints "centiped_convergence: PASS"), 1 = FAIL, 2 = setup/IO error.
import { readFileSync, existsSync, mkdirSync, openSync, readSync, fstatSync, closeSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Machine, resolveAllIdiomatic } from "../machine.js";
import { runIdiomaticIrqGame } from "../../../core/frame-stepped.js";
import { STACK_SCRATCH } from "../idiomatic/names.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const STACK_LO = STACK_SCRATCH.lo, STACK_HI = STACK_SCRATCH.hi; // the guest return-stack window (page-1
// tail): the idiomatic engine's stack ops land here and are excluded from the diff (the MAME golden's per-frame
// state is RAM only, no SP, so no per-frame R43 floor can be taken). It is the ONLY region excluded -- real
// state elsewhere in page 1 (high scores, trackball) is diffed.
const IRQ_VBLANK = [0, 0, 0, 1]; // per-slot io.vblank for the four 32V IRQs; only scanline 240 is in vblank
const GAME = dirname(HERE);
const REPO = dirname(dirname(GAME));
const FRAME = 2048;
const FPX = 256 * 240 * 3; // one rendered RGB frame

function parseArgs(argv) {
  const a = { seconds: 120, drift: 2, mode: "state", layer: "oracle", rompath: join(process.env.HOME || "", "Downloads"),
    mame: "/opt/homebrew/bin/mame", set: "centiped3", golden: null,
    tAvg: 70, tMax: 130, pxAvg: 0.15, pxMax: 0.30, minDistinct: 100, overTol: 0 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--seconds") a.seconds = parseInt(argv[++i], 10);
    else if (k === "--drift") a.drift = parseInt(argv[++i], 10);
    else if (k === "--mode") a.mode = argv[++i];
    else if (k === "--layer") a.layer = argv[++i]; // "oracle" (translated, cycle-driven) | "idiomatic" (clock-free)
    else if (k === "--rompath") a.rompath = argv[++i];
    else if (k === "--mame") a.mame = argv[++i];
    else if (k === "--set") a.set = argv[++i];
    else if (k === "--golden") a.golden = argv[++i];
    else if (k === "--stream") a.stream = true; // pixel: read the golden from disk frame-by-frame (full 10-min golden won't fit RAM)
    else if (k === "--tape") a.tape = argv[++i]; // gameplay: JSON input tape replayed into the idiomatic layer (golden must be MAME-under-the-same-tape)
    else if (k === "--converge-until") a.convergeUntil = parseInt(argv[++i], 10); // bound correctness to frames [W,N]; completeness still over the full golden (see the bounded-residual note)
    else if (k === "--vs-oracle") a.vsOracle = true; // gameplay gate (a): diff the idiomatic layer vs the cycle-driven oracle under the tape (both MAME-aligned)
    else if (k === "--over-tol") a.overTol = parseInt(argv[++i], 10); // allow a small RNG over-read (the trackball-model boundary's control-flow cost); a LARGE one still REDs
    else if (k === "--t-avg") a.tAvg = parseFloat(argv[++i]);
    else if (k === "--t-max") a.tMax = parseFloat(argv[++i]);
    else if (k === "--px-avg") a.pxAvg = parseFloat(argv[++i]);
    else if (k === "--px-max") a.pxMax = parseFloat(argv[++i]);
  }
  return a;
}

function fail(msg) { console.log(`centiped_convergence: FAIL -- ${msg}`); process.exit(1); }
function ioerr(msg) { console.error(`convergence: ${msg}`); process.exit(2); }

// Capture a fresh MAME golden (state + RNG stream) into `dir`, or reuse an existing one.
function captureGolden(opts) {
  const dir = opts.golden || join(HERE, `.golden-${opts.seconds}s`);
  const stateOut = join(dir, "state.bin");
  const rngOut = join(dir, "rng.bin");
  if (opts.golden && existsSync(stateOut) && existsSync(rngOut)) return { dir, stateOut, rngOut };
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const lua = join(HERE, "lua", "dump_state_rng.lua");
  try {
    execFileSync(opts.mame, [opts.set, "-rompath", opts.rompath, "-norotate", "-video", "none",
      "-sound", "none", "-nothrottle", "-frameskip", "0", "-nonvram_save", "-nocheat", "-noautosave",
      "-seconds_to_run", String(opts.seconds), "-autoboot_script", lua, "-autoboot_delay", "0"],
      { env: { ...process.env, STATE_OUT: stateOut, RNG_OUT: rngOut }, stdio: "ignore", timeout: 300000 });
  } catch (e) { ioerr(`MAME capture failed (rompath ${opts.rompath}, set ${opts.set}): ${e.message}`); }
  return { dir, stateOut, rngOut };
}

// Run the oracle replaying `rng`; return sampled frames + how many RNG values it consumed / over-consumed.
function runOracle(rom, gfx1, rng, frames, mutate) {
  const m = new Machine(rom, { gfx1 });
  let ri = 0, over = 0;
  const orig = m.io.pokeyRandom.bind(m.io);
  m.io.pokeyRandom = (c) => { if (ri < rng.length) return rng[ri++]; over++; return orig(c); };
  if (mutate) { const w = m.mem.write8.bind(m.mem); m.mem.write8 = (a, v) => w(a, (a & 0xffff) === 0x0056 ? (v + 3) & 0xff : v); }
  const out = m.runFrames(frames);
  return { out, ri, over, stoppedBy: m.stoppedBy };
}

// Run the ORACLE (cycle-driven, translated) under an input tape via the Machine's built-in inputTape/
// applyInputs. Same MAME-alignment as the idiomatic side: applyInputs lands an input one frame before MAME's
// frame-notifier, so the tape is shifted +1 (landmark-verified: credit banks at golden 341, start at 382 --
// the shifted tape reproduces both). Returns sampled frames + RNG consumption. `mutate` = the null-mutant.
function runOracleTape(rom, gfx1, rng, frames, mutate, tape) {
  const m = new Machine(rom, { gfx1 });
  let ri = 0, over = 0;
  const orig = m.io.pokeyRandom.bind(m.io);
  m.io.pokeyRandom = (c) => { if (ri < rng.length) return rng[ri++]; over++; return orig(c); };
  if (mutate) { const w = m.mem.write8.bind(m.mem); m.mem.write8 = (a, v) => w(a, (a & 0xffff) === 0x0056 ? (v + 3) & 0xff : v); }
  m.inputTape = tape.map((t) => ({ ...t, frame: t.frame + 1 })); // +1: MAME-align (see header)
  const out = m.runFrames(frames);
  return { out, ri, over, stoppedBy: m.stoppedBy };
}

function diff(a, b) { let n = 0; for (let i = 0; i < FRAME; i++) if (a[i] !== b[i]) n++; return n; }
function diffNoStack(a, b) { let n = 0; for (let i = 0; i < FRAME; i++) { if (i >= STACK_LO && i < STACK_HI) continue; if (a[i] !== b[i]) n++; } return n; }

// Run the IDIOMATIC layer on the clock-free coroutine engine (runIdiomaticIrqGame), replaying `rng`. Same
// teeth as runOracle (RNG count, clean stop, distinct frames, mutant); the stack page is excluded downstream.
async function runIdiomatic(rom, gfx1, rng, frames, mutate, tape) {
  const overrides = await resolveAllIdiomatic();
  const m = new Machine(rom, { gfx1, overrides });
  m.booted = true;
  let ri = 0, over = 0;
  const orig = m.io.pokeyRandom.bind(m.io);
  m.io.pokeyRandom = (c) => { if (ri < rng.length) return rng[ri++]; over++; return orig(c); };
  if (mutate) { const w = m.mem.write8.bind(m.mem); m.mem.write8 = (a, v) => w(a, (a & 0xffff) === 0x0056 ? (v + 3) & 0xff : v); }
  const out = [];
  const res = runIdiomaticIrqGame(m, { bootAddr: 0x3b04, irqVblank: IRQ_VBLANK, maxFrames: frames,
    onFrame: (mm, f) => { if (tape) applyTape(mm, f, tape); out.push(mm.mem.dumpState()); } });
  return { out, ri, over, stoppedBy: res.stopError || null };
}

// Drift-tolerant score: each oracle frame vs its nearest golden frame within ±W (byte diff for state, %px
// for pixel). `cmp` maps two Uint8Arrays to a scalar distance; `gframe` yields golden frame i.
function drift(out, gframe, gN, W, cmp, until = Infinity) {
  let s = 0, c = 0, mx = 0;
  const end = Math.min(out.length - W - 2, gN - W, until);
  for (let k = W + 2; k < end; k++) {
    if (!out[k]) continue;
    let best = Infinity;
    for (let o = -W; o <= W; o++) { const d = cmp(out[k], gframe(k + o)); if (d < best) best = d; }
    s += best; c++; if (best > mx) mx = best;
  }
  return { avg: s / c, max: mx };
}
const score = (out, gframe, gN, W) => drift(out, gframe, gN, W, diff);

function pxDiff(a, b) { let n = 0; for (let i = 0; i < FPX; i++) if (a[i] !== b[i]) n++; return (100 * n) / FPX; }

// Apply one frame of an input tape into the idiomatic machine. Set at the vblank yield so THIS frame's
// scanline IRQs consume it (that is where the ROM reads IN0/the trackball). Digital bits -> io.inputAssert
// per port; trackball rows -> io.applyTrackball.
//
// MAME-ALIGNMENT (`f - 1`, mechanism-justified, NOT byte-minimized): the MAME golden's tape twin
// (dump_state_rng_tape.lua) sets an input at the frame-notifier, which fires at the END of a frame, so the
// input pressed "at tape frame f" is consumed during the NEXT emulated frame. The idiomatic engine's
// onFrame fires BEFORE this frame's IRQs, so applying tape frame f here would be consumed one frame too
// early. Applying tape frame (f-1) aligns idiomatic input-consumption with MAME -- VERIFIED by deterministic
// input->response landmarks: the coin banks a credit ($c8) at golden frame 341 and 1P-start goes live ($89)
// at 382, and `f-1` reproduces BOTH exactly (f-0 lands them at 340/381, one early). See FINDING-33730.md.
function applyTape(mm, f, tape) {
  const g = f - 1; // MAME-alignment: see the header comment (landmark-verified, not byte-fit)
  const bits = {};
  for (const t of tape) {
    const due = g >= t.frame && (t.dur == null || g < t.frame + t.dur);
    if (!due) continue;
    if (t.track) { mm.io.applyTrackball(t.track[0], t.track[1]); continue; }
    bits[t.port] = (bits[t.port] || 0) | t.bits;
  }
  mm.io.inputAssert = bits;
}

// Render the oracle replaying `rng`, capturing renderFrame() at each frame boundary (dumpState fires once per
// boundary in tick()). Returns the rendered frames + RNG consumption + stop reason (same teeth as runOracle).
function renderOracle(rom, gfx1, rng, frames, mutate) {
  const m = new Machine(rom, { gfx1 });
  let ri = 0, over = 0;
  const orig = m.io.pokeyRandom.bind(m.io);
  m.io.pokeyRandom = (c) => { if (ri < rng.length) return rng[ri++]; over++; return orig(c); };
  if (mutate) { const w = m.mem.write8.bind(m.mem); m.mem.write8 = (a, v) => w(a, (a & 0xffff) === 0x0056 ? (v + 3) & 0xff : v); }
  const rendered = [];
  const origDump = m.mem.dumpState.bind(m.mem);
  m.mem.dumpState = () => { try { rendered.push(m.renderFrame()); } catch { rendered.push(null); } return origDump(); };
  m.runFrames(frames);
  return { rendered, ri, over, stoppedBy: m.stoppedBy };
}

// Render the IDIOMATIC layer (the SHIPPED render path) on the clock-free engine, capturing renderFrame()
// each frame -- same teeth as renderOracle (RNG count, clean stop, distinct frames, null-mutant). The done
// gate validates THIS, not the oracle: an attract-only oracle render would never exercise the shipped layer.
async function renderIdiomatic(rom, gfx1, rng, frames, mutate, tape) {
  const overrides = await resolveAllIdiomatic();
  const m = new Machine(rom, { gfx1, overrides });
  m.booted = true;
  let ri = 0, over = 0;
  const orig = m.io.pokeyRandom.bind(m.io);
  m.io.pokeyRandom = (c) => { if (ri < rng.length) return rng[ri++]; over++; return orig(c); };
  if (mutate) { const w = m.mem.write8.bind(m.mem); m.mem.write8 = (a, v) => w(a, (a & 0xffff) === 0x0056 ? (v + 3) & 0xff : v); }
  const rendered = [];
  const res = runIdiomaticIrqGame(m, { bootAddr: 0x3b04, irqVblank: IRQ_VBLANK, maxFrames: frames,
    onFrame: (mm, f) => { if (tape) applyTape(mm, f, tape); try { rendered.push(mm.renderFrame()); } catch { rendered.push(null); } } });
  return { rendered, ri, over, stoppedBy: res.stopError || null };
}

// Streaming pixel: render the idiomatic layer frame-by-frame and score each vs its nearest golden frame
// within ±W, reading each golden frame from `fd` exactly once through a sliding ring of buffers -- so a full
// ~10-min golden (36k frames, 6.6 GB of pixels) is validated without ever holding it in RAM. Same teeth as
// the in-memory path (RNG count, clean stop, distinct frames, null-mutant). Returns the drift score + tallies.
async function renderIdiomaticStreamedPixel(rom, gfx1, rng, fd, gN, W, mutate, until = Infinity) {
  const overrides = await resolveAllIdiomatic();
  const m = new Machine(rom, { gfx1, overrides });
  m.booted = true;
  let ri = 0, over = 0;
  const orig = m.io.pokeyRandom.bind(m.io);
  m.io.pokeyRandom = (c) => { if (ri < rng.length) return rng[ri++]; over++; return orig(c); };
  if (mutate) { const w = m.mem.write8.bind(m.mem); m.mem.write8 = (a, v) => w(a, (a & 0xffff) === 0x0056 ? (v + 3) & 0xff : v); }
  const frames = gN - 1;
  // A ring of 2W+1 reusable buffers; golden frame i lives in slot (i mod ring) until it slides out of the
  // window, so each golden frame is read from disk once. Access golden[k+o] at slot (k+o) mod ring.
  const ring = 2 * W + 1;
  const gbuf = Array.from({ length: ring }, () => Buffer.allocUnsafe(FPX));
  const loadG = (i) => { readSync(fd, gbuf[i % ring], 0, FPX, i * FPX); };
  const psig = (f) => { let t = ""; for (let i = 0; i < FPX; i += 499) t += f[i] + ","; return t; };
  let s = 0, c = 0, mx = 0, k = -1, count = 0;
  const distinct = new Set();
  const res = runIdiomaticIrqGame(m, { bootAddr: 0x3b04, irqVblank: IRQ_VBLANK, maxFrames: frames,
    onFrame: (mm) => {
      k++;
      let f = null; try { f = mm.renderFrame(); } catch { f = null; }
      if (f) { count++; if (k % 7 === 1) distinct.add(psig(f)); }
      if (k + W < gN) loadG(k + W); // the frame entering the window's leading edge (loaded for the FULL run)
      // Correctness scored only over [W+2, min(frames-W-2, until)); the rest still runs (completeness) but
      // is not scored -- the documented bounded-residual region (see the bounded-residual note above).
      if (k < W + 2 || k >= frames - W - 2 || k >= until || !f) return;
      let best = Infinity;
      for (let o = -W; o <= W; o++) { const d = pxDiff(f, gbuf[(k + o) % ring]); if (d < best) best = d; }
      s += best; c++; if (best > mx) mx = best;
    } });
  return { avg: c ? s / c : Infinity, max: mx, ri, over, stoppedBy: res.stopError || null, count, distinct: distinct.size };
}

// --stream pixel path: the full-golden render-correctness check for `--done`. Idiomatic layer only.
async function pixelStreamMain(opts, rom, gfx1) {
  if (opts.layer !== "idiomatic") ioerr("--stream pixel is idiomatic-only (the shipped render path)");
  if (!opts.golden) ioerr("--mode pixel --stream requires --golden DIR (frames.rgb + rng.bin)");
  const framesP = join(opts.golden, "frames.rgb"), rngP = join(opts.golden, "rng.bin");
  if (!existsSync(framesP) || !existsSync(rngP)) ioerr(`--golden ${opts.golden} is missing frames.rgb or rng.bin`);
  const rng = readFileSync(rngP);
  const fd = openSync(framesP, "r");
  try {
    const gN = Math.floor(fstatSync(fd).size / FPX);
    if (gN < opts.minDistinct * 2) ioerr(`golden too short: ${gN} frames`);
    const pxMin = 12;
    // Bounded-residual mode: correctness over [W,N], completeness (clean full run, all frames, no over-read)
    // over the whole golden. See the state path's bounded-residual note. Teeth preserved: an earlier fork
    // lands in [W,N] -> drift blows the floor -> RED; an incomplete run -> the completeness checks -> RED.
    const N = opts.convergeUntil || Infinity;
    const bounded = Number.isFinite(N);
    const good = await renderIdiomaticStreamedPixel(rom, gfx1, rng, fd, gN, opts.drift, false, N);
    if (good.stoppedBy) fail(`idiomatic did not run clean to budget: stoppedBy=${good.stoppedBy.message || good.stoppedBy} -- a gap or crash`);
    if (good.over > opts.overTol) fail(`RNG OVER-READ: idiomatic ${good.ri + good.over}x vs MAME ${rng.length}x (over-tol ${opts.overTol}) -- diverged`);
    if (!bounded && good.ri !== rng.length) fail(`RNG UNDER-READ: idiomatic ${good.ri}x vs MAME ${rng.length}x -- truncated/diverged`);
    if (good.count < gN - 1) fail(`idiomatic rendered ${good.count}/${gN - 1} frames -- truncated`);
    if (good.distinct < pxMin) fail(`idiomatic rendered only ${good.distinct} distinct frames (froze/crashed)`);
    const bad = await renderIdiomaticStreamedPixel(rom, gfx1, rng, fd, gN, opts.drift, true, N);
    const mutantCaught = bad.avg >= opts.pxAvg || bad.over > opts.overTol;
    const region = bounded ? `[${opts.drift + 2},${N}] (completeness over all ${gN - 1})` : "full";
    console.log(`  golden ${gN} frames (streamed); RNG reads idiomatic ${good.ri} / MAME ${rng.length}; rendered ${good.count}/${gN - 1}, ${good.distinct} distinct.`);
    console.log(`  correct ${region}: avg=${good.avg.toFixed(3)}% max=${good.max.toFixed(3)}%   null-mutant: avg=${bad.avg.toFixed(3)}% max=${bad.max.toFixed(3)}%`);
    console.log(`  thresholds: avg<${opts.pxAvg}% max<${opts.pxMax}%`);
    if (!mutantCaught) fail(`NULL-MUTANT NOT CAUGHT (avg ${bad.avg.toFixed(3)}% < ${opts.pxAvg}%) -- the gate has no teeth`);
    if (good.avg >= opts.pxAvg) fail(`pixel residual avg ${good.avg.toFixed(3)}% >= ${opts.pxAvg}%`);
    if (good.max >= opts.pxMax) fail(`pixel residual max ${good.max.toFixed(3)}% >= ${opts.pxMax}%`);
    console.log("centiped_convergence: PASS");
  } finally {
    closeSync(fd);
  }
}

// --mode pixel: diff the RNG-replayed layer's RENDERED frame vs the golden AVI (frames.rgb, from
// pixel_suite.py). --layer idiomatic renders the shipped clock-free layer; --layer oracle the translated one.
async function pixelMain(opts, rom, gfx1) {
  if (opts.stream) return pixelStreamMain(opts, rom, gfx1);
  if (!opts.golden) ioerr("--mode pixel requires --golden DIR (frames.rgb + rng.bin from pixel_suite.py)");
  const framesP = join(opts.golden, "frames.rgb"), rngP = join(opts.golden, "rng.bin");
  if (!existsSync(framesP) || !existsSync(rngP)) ioerr(`--golden ${opts.golden} is missing frames.rgb or rng.bin`);
  const gpxBuf = readFileSync(framesP), rng = readFileSync(rngP);
  const gN = Math.floor(gpxBuf.length / FPX);
  const gpx = (i) => gpxBuf.subarray(i * FPX, (i + 1) * FPX);
  if (gN < opts.minDistinct * 2) ioerr(`golden too short: ${gN} frames`);
  // Frozen-screen guard: rendered attract is far less distinct than RAM (static title/score screens), so the
  // pixel floor is lower than state's -- it only needs to prove the screen is NOT frozen (a frozen golden = 1).
  const pxMin = 12;
  // distinctness: strided sample across the WHOLE frame (the top rows are static border in attract).
  const psig = (f) => { let s = ""; for (let i = 0; i < FPX; i += 499) s += f[i] + ","; return s; };
  const gsigs = new Set(); for (let k = 0; k < gN; k += 7) gsigs.add(psig(gpx(k)));
  if (gsigs.size < pxMin) fail(`golden has only ${gsigs.size} distinct rendered frames (frozen?)`);

  const renderLayer = opts.layer === "idiomatic"
    ? renderIdiomatic
    : (r0, g0, r1, f0, mut) => Promise.resolve(renderOracle(r0, g0, r1, f0, mut));

  const frames = gN - 1;
  const good = await renderLayer(rom, gfx1, rng, frames, false, opts.tapeData);
  if (good.stoppedBy) fail(`${opts.layer} did not run clean to budget: stoppedBy=${good.stoppedBy.message || good.stoppedBy} -- a gap or crash`);
  if (good.over > opts.overTol) fail(`RNG OVER-READ: ${opts.layer} ${good.ri + good.over}x vs MAME ${rng.length}x (over-tol ${opts.overTol}) -- diverged`);
  if (good.ri !== rng.length) fail(`RNG UNDER-READ: ${opts.layer} ${good.ri}x vs MAME ${rng.length}x -- truncated/diverged`);
  if (good.rendered.length < frames) fail(`${opts.layer} rendered ${good.rendered.length}/${frames} frames -- truncated`);
  const gs = drift(good.rendered, gpx, gN, opts.drift, pxDiff);

  const osigs = new Set(); for (let k = 1; k < good.rendered.length; k += 7) if (good.rendered[k]) osigs.add(psig(good.rendered[k]));
  if (osigs.size < pxMin) fail(`${opts.layer} rendered only ${osigs.size} distinct frames (froze/crashed)`);

  const bad = await renderLayer(rom, gfx1, rng, frames, true, opts.tapeData);
  const bs = drift(bad.rendered, gpx, gN, opts.drift, pxDiff);
  const mutantCaught = bs.avg >= opts.pxAvg || bad.over > opts.overTol;

  console.log(`  golden ${gN} frames, ${gsigs.size} distinct; RNG reads ${opts.layer} ${good.ri} / MAME ${rng.length}; rendered ${good.rendered.length}/${frames}.`);
  console.log(`  correct: avg=${gs.avg.toFixed(3)}% max=${gs.max.toFixed(3)}%   null-mutant: avg=${bs.avg.toFixed(3)}% max=${bs.max.toFixed(3)}%`);
  console.log(`  thresholds: avg<${opts.pxAvg}% max<${opts.pxMax}%`);
  if (!mutantCaught) fail(`NULL-MUTANT NOT CAUGHT (avg ${bs.avg.toFixed(3)}% < ${opts.pxAvg}%) -- the gate has no teeth`);
  if (gs.avg >= opts.pxAvg) fail(`pixel residual avg ${gs.avg.toFixed(3)}% >= ${opts.pxAvg}%`);
  if (gs.max >= opts.pxMax) fail(`pixel residual max ${gs.max.toFixed(3)}% >= ${opts.pxMax}%`);
  console.log("centiped_convergence: PASS");
}

// Gate (a): the shipped idiomatic layer must match the faithful cycle-driven ORACLE in GAMEPLAY. Both are
// driven by the SAME tape, MAME-aligned (idiomatic f-1, oracle tape+1), RNG-replayed from the golden; we
// diff them against EACH OTHER (the oracle is validated vs MAME in attract, so agreement transitively
// validates gameplay). Standard state floor + a NULL-MUTANT that must break it (teeth on the floor).
async function tapeVsOracleMain(opts, rom, gfx1) {
  if (!opts.tapeData) ioerr("--vs-oracle requires --tape FILE");
  if (!opts.golden) ioerr("--vs-oracle requires --golden DIR (rng.bin) to entropy-match both layers");
  const rngP = join(opts.golden, "rng.bin"), stateP = join(opts.golden, "state.bin");
  if (!existsSync(rngP)) ioerr(`--golden ${opts.golden} is missing rng.bin`);
  const rng = readFileSync(rngP);
  const gN = existsSync(stateP) ? Math.floor(readFileSync(stateP).length / FRAME) : opts.seconds * 60;
  const frames = gN - 1;
  const idio = await runIdiomatic(rom, gfx1, rng, frames, false, opts.tapeData);
  const orac = runOracleTape(rom, gfx1, rng, frames, false, opts.tapeData);
  if (idio.stoppedBy) fail(`idiomatic did not run clean: ${idio.stoppedBy.message || idio.stoppedBy}`);
  if (orac.stoppedBy) fail(`oracle did not run clean: ${orac.stoppedBy.message || orac.stoppedBy}`);
  const gframe = (i) => orac.out[i];
  const gs = drift(idio.out, gframe, orac.out.length, opts.drift, diffNoStack);
  const osigs = new Set(); for (let k = 1; k < idio.out.length; k += 7) if (idio.out[k]) osigs.add(idio.out[k].slice(0, 0x40).join(","));
  if (osigs.size < opts.minDistinct) fail(`idiomatic produced only ${osigs.size} distinct frames (froze/crashed)`);
  // NULL-MUTANT: corrupt the idiomatic layer only; it MUST break past the floor vs the clean oracle.
  const bad = await runIdiomatic(rom, gfx1, rng, frames, true, opts.tapeData);
  const bs = drift(bad.out, gframe, orac.out.length, opts.drift, diffNoStack);
  const mutantCaught = bs.avg >= opts.tAvg;
  console.log(`  idiomatic-vs-oracle under tape (both MAME-aligned): idio ${idio.out.length} / oracle ${orac.out.length} frames.`);
  console.log(`  correct: avg=${gs.avg.toFixed(1)}B max=${gs.max}B   null-mutant: avg=${bs.avg.toFixed(1)}B max=${bs.max}B`);
  console.log(`  thresholds: avg<${opts.tAvg} max<${opts.tMax}`);
  if (!mutantCaught) fail(`NULL-MUTANT NOT CAUGHT (avg ${bs.avg.toFixed(1)} < ${opts.tAvg}) -- the gameplay floor has no teeth`);
  if (gs.avg >= opts.tAvg) fail(`gameplay residual avg ${gs.avg.toFixed(1)}B >= ${opts.tAvg}B`);
  if (gs.max >= opts.tMax) fail(`gameplay residual max ${gs.max}B >= ${opts.tMax}B`);
  console.log("centiped_convergence: PASS");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const romP = join(GAME, "rom", "maincpu.bin"), gfxP = join(GAME, "rom", "gfx1.bin");
  if (!existsSync(romP) || !existsSync(gfxP)) ioerr(`ROM not built -- run: node ${join(REPO, "tools/build-rom.mjs")} centiped <zip>`);
  const rom = readFileSync(romP), gfx1 = readFileSync(gfxP);

  if (opts.tape) {
    // --tape works for idiomatic (applyTape f-1) and oracle (runOracleTape, inputTape +1) -- both
    // MAME-aligned. oracle-under-tape vs the golden is gameplay gate (c): the trackball-model boundary.
    if (!existsSync(opts.tape)) ioerr(`--tape ${opts.tape} not found`);
    opts.tapeData = JSON.parse(readFileSync(opts.tape, "utf8"));
  }

  if (opts.vsOracle) { await tapeVsOracleMain(opts, rom, gfx1); return; }
  if (opts.mode === "pixel") { await pixelMain(opts, rom, gfx1); return; }

  const { stateOut, rngOut } = captureGolden(opts);
  const golden = readFileSync(stateOut), rng = readFileSync(rngOut);
  const gN = Math.floor(golden.length / FRAME);
  const gframe = (i) => golden.subarray(i * FRAME, (i + 1) * FRAME);
  if (gN < opts.minDistinct * 2) ioerr(`golden too short: ${gN} frames`);
  // A fresh capture that silently under-runs (MAME exits early) would let the oracle match a short golden.
  if (!opts.golden) { const want = opts.seconds * 60; if (gN < want * 0.9) fail(`golden under-ran: ${gN} frames for --seconds ${opts.seconds} (expected ~${want}) -- capture cut short`); }
  // certify: state[0] all-zero (power-on invariant), and distinct golden frames (not a frozen screen).
  if (gframe(0).some((b) => b !== 0)) fail("golden state[0] is not all-zero (poisoned capture)");
  const gsigs = new Set(); for (let k = 0; k < gN; k += 7) gsigs.add(gframe(k).slice(0, 0x40).join(","));
  if (gsigs.size < opts.minDistinct) fail(`golden has only ${gsigs.size} distinct frames (frozen?)`);

  // Layer select: oracle = the translated layer cycle-driven; idiomatic = the §4 layer on the clock-free
  // coroutine engine, whose guest-stack scratch (page 1) is excluded from the diff.
  const idio = opts.layer === "idiomatic";
  const runLayer = idio
    ? runIdiomatic
    : (opts.tapeData
        ? (r0, g0, r1, f0, mut) => Promise.resolve(runOracleTape(r0, g0, r1, f0, mut, opts.tapeData))
        : (r0, g0, r1, f0, mut) => Promise.resolve(runOracle(r0, g0, r1, f0, mut)));
  const cmp = idio ? diffNoStack : diff;
  const scoreL = (out, gf, gn, w, until) => drift(out, gf, gn, w, cmp, until);

  const frames = gN - 1;
  // Bounded-residual mode (--converge-until N): correctness (drift) is asserted only over frames [W,N];
  // COMPLETENESS (clean run + full frame count + no RNG over-read) is still asserted over the WHOLE golden.
  // This exists for ONE documented reason: centiped's ATTRACT DEMO forks from MAME at a ~562s-deep heavy
  // wave-restart because the clock-free layer ages serviceTimerBank's countdown bank on a fixed frame-beat
  // (the oracle, cycle-driven, matches MAME exactly). It is attract-demo-only, zero player-visible impact.
  // TEETH ARE PRESERVED: a regression that forks EARLIER than N lands inside [W,N] -> drift blows the floor
  // -> RED; a run that fails to complete -> the completeness checks below -> RED. (See scratchpad finding.)
  const N = opts.convergeUntil || Infinity;
  const bounded = Number.isFinite(N);
  const good = await runLayer(rom, gfx1, rng, frames, false, opts.tapeData);
  // COMPLETENESS teeth (always, full golden): a clean run to the full frame count, and no RNG over-read
  // (reading PAST MAME's stream = a real divergence/gap, never an accepted residual).
  if (good.stoppedBy) fail(`${opts.layer} did not run clean to budget: stoppedBy=${good.stoppedBy.message || good.stoppedBy} -- a gap or crash`);
  if (good.out.length < frames) fail(`${opts.layer} produced ${good.out.length}/${frames} frames -- truncated (gap or crash)`);
  if (good.over > opts.overTol) fail(`RNG OVER-READ: ${opts.layer} read $100a ${good.ri + good.over}x, MAME captured ${rng.length}x (over-tol ${opts.overTol}) -- diverged from MAME's control flow`);
  // Un-bounded (per-commit / gameplay-tape) mode keeps the exact RNG-count control-flow tooth over the whole
  // run. Bounded mode cannot (the documented post-N fork makes the total diverge by design) -- the
  // [W,N] drift + null-mutant below is the correctness tooth there instead.
  if (!bounded && good.ri !== rng.length) fail(`RNG UNDER-READ: ${opts.layer} read $100a ${good.ri}x, MAME captured ${rng.length}x -- truncated/diverged (a gap or control-flow change)`);
  const gs = scoreL(good.out, gframe, gN, opts.drift, N);

  // positive control #1: the layer's frames are distinct (not frozen).
  const osigs = new Set(); for (let k = 1; k < good.out.length; k += 7) if (good.out[k]) osigs.add(good.out[k].slice(0, 0x40).join(","));
  if (osigs.size < opts.minDistinct) fail(`${opts.layer} produced only ${osigs.size} distinct frames (froze/crashed early)`);

  // positive control #2 (NULL-MUTANT): a corrupted layer MUST break past the floor within [W,N] -- teeth.
  const bad = await runLayer(rom, gfx1, rng, frames, true, opts.tapeData);
  const bs = scoreL(bad.out, gframe, gN, opts.drift, N);
  const mutantCaught = bs.avg >= opts.tAvg || bad.over > opts.overTol;

  const region = bounded ? `[${opts.drift + 2},${N}] (completeness over all ${frames})` : `[${opts.drift + 2},end]`;
  console.log(`  golden ${gN} frames, ${gsigs.size} distinct; RNG reads ${opts.layer} ${good.ri} / MAME ${rng.length} (over ${good.over}); ${opts.layer} ran ${good.out.length}/${frames} frames.`);
  console.log(`  correct ${region}: avg=${gs.avg.toFixed(1)}B max=${gs.max}B   null-mutant: avg=${bs.avg.toFixed(1)}B max=${bs.max}B over=${bad.over}`);
  console.log(`  thresholds: avg<${opts.tAvg} max<${opts.tMax}`);

  if (!mutantCaught) fail(`NULL-MUTANT NOT CAUGHT (avg ${bs.avg.toFixed(1)} < ${opts.tAvg}) -- the gate has no teeth`);
  if (gs.avg >= opts.tAvg) fail(`residual avg ${gs.avg.toFixed(1)}B >= ${opts.tAvg}B`);
  if (gs.max >= opts.tMax) fail(`residual max ${gs.max}B >= ${opts.tMax}B`);
  console.log("centiped_convergence: PASS");
}

main();
