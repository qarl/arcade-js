// SPDX-License-Identifier: GPL-3.0-only
//
// STANDING GATE: the live idiomatic game reads NO CPU register.
//
// Runbook §5(c) wants zero register references in the idiomatic layer. idiomatic_gate counts them in
// the source, but it exempts a `fn(m, x = m.regs.X)` parameter default -- the bridge a routine keeps for
// a register-dispatched caller in the FROZEN layer, which cannot pass named arguments. That exemption is
// blind to an IDIOMATIC caller that leaves the argument out: the default then reads whatever register
// the previous idiomatic routine left behind, and idiomatic code is passing values to itself through the
// CPU. Nothing in the source tells the two apart, so this gate asks the running game.
//
// HOW. The whole wired idiomatic machine runs under runIdiomaticGame (the shipped clock-free engine),
// with every register field of its Regs object (core/cpu/z80.js REG_FIELDS) replaced by a getter trap
// for the run. A read is charged to the first frame outside the Regs accessors and native frames -- the
// pair and flag accessors (hl, de, fC, ...) are walked through, so `m.regs.de` is charged to its caller
// like `m.regs.e`. That frame is charged whatever file it is in: a module anywhere under idiomatic/ (a
// subdirectory too), or any other file -- a core/ or machine helper an idiomatic module calls is charged
// as `<file>:<line> via <idiomatic module>`. Two kinds of access are NOT reads, and are named so they
// cannot hide one:
//   * a getter called from inside a Regs SETTER -- a flag write (`m.regs.fC = x`) rewrites F from F, so
//     the write reads F first; the value handed out is never the idiomatic code's;
//   * an ENGINE read: the first frame is the engine itself (ENGINE_FILES -- the withOmittedRet seam in
//     machine.js reading SP, the run loop) AND no idiomatic module is anywhere on the stack. Counted in
//     engineReads, never charged; the same file read with an idiomatic frame below it is charged.
// Every other register read fails the gate. Nothing is allowed.
//
// SESSIONS: the coin/start/play tape and attract (3600 NMIs each; the input tape is test/idiomatic.test.js's, which that test runs at its own lengths), and every
// poke-driven distant state in tapes/*.poke.json, built from the exact render argv distant_suite.py uses.
// A routine that no session runs is not measured (the HOLE); the static half of the question -- an
// idiomatic call that leaves out a `= m.regs.X` argument -- is the reviewer's (reviewer-rules R37).
//
// TEETH. Each mutant below runs on a copied idiomatic tree and must be heard: a scenery step that leaves
// its cursors out (IX/IY read through the bridge, the tape), a round caption that leaves its character
// cursor out (DE, a pair accessor, a distant state), and a flag READ riding a flag write (F through the
// fC accessor) -- so the setter carve-out cannot swallow a real flag read. A fourth copies the register
// file with Object.assign, so a read made from a native frame is still charged to the idiomatic caller.
// The last three read through code the module reaches: a helper in an idiomatic/ SUBDIRECTORY, a helper
// OUTSIDE the layer (a core/-style file beside the tree), and a Machine method in the engine's own
// machine.js -- so neither location, nor the engine carve-out, can drop a read made for idiomatic code.

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { REG_FIELDS } from "../../../core/cpu/z80.js";
import { runIdiomaticGame } from "../../../core/frame-stepped.js";
import manifest from "../manifest.js";
import {
  GAME_DIR, parseRenderArgs, createRenderMachine, runGeneratorFrames, idiomaticTree,
} from "../tools/render-lib.js";

const REPO = join(GAME_DIR, "..", "..");
const ROM_PRESENT = ["maincpu", "tiles", "sprites", "proms"].every((r) => existsSync(join(GAME_DIR, "rom", `${r}.bin`)));
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "ROM absent at games/timeplt/rom/ (BYO)" }, fn);

const NMIS = 3600;
const TAPE_FILES = readdirSync(join(GAME_DIR, "tapes")).filter((f) => f.endsWith(".poke.json")).sort();

// The coin/start/play tape of test/idiomatic.test.js, in NMI ordinals.
const { actions } = manifest.inputs;
const COIN_AT = 100, START_AT = 160, PLAY_FROM = 220, HOLD = 8, TURN = 97, FIRE_EVERY = 23, FIRE_FOR = 7;
const DIRECTIONS = [actions.up, actions.right, actions.down, actions.left];
function inputAt(n, live) {
  if (!live) return null;
  const a = {};
  const press = (act) => { a[act.port] = (a[act.port] || 0) | act.bit; };
  if (n >= COIN_AT && n < COIN_AT + HOLD) press(actions.coin);
  if (n >= START_AT && n < START_AT + HOLD) press(actions.start1);
  if (n >= PLAY_FROM) {
    press(DIRECTIONS[Math.floor((n - PLAY_FROM) / TURN) % 4]);
    if ((n - PLAY_FROM) % FIRE_EVERY < FIRE_FOR) press(actions.fire);
  }
  return a;
}

// ── the instrument ──────────────────────────────────────────────────────────────────────────

const IDIOMATIC_FRAME = /\/games\/timeplt\/idiomatic\/((?:[\w.-]+\/)*[\w.-]+\.m?js):(\d+)/;
const REGS_FRAME = /\/core\/cpu\/z80\.js:/;
const SETTER_FRAME = /at (?:Regs\.)?set \w+ /;
// The run engine's own files: a read from one of these with NO idiomatic frame on the stack is the
// engine's (the omitted-ret seam reads SP around each dispatch), not idiomatic code's.
const ENGINE_FILES = new Set(["games/timeplt/machine.js", "core/frame-stepped.js"]);
// "<repo-relative file>:<line>" of a stack frame (the tree root of a copied idiomatic tree is dropped too).
const FRAME_AT = /(\/[^\s()]+?\.m?js):(\d+):\d+\)?\s*$/;
function frameAt(f) {
  const hit = f && f.match(FRAME_AT);
  if (!hit) return { file: f ? f.trim() : "<no frame>", line: "?" };
  const rel = hit[1].match(/\/((?:games|core|boards|tools|web)\/.*)$/);
  return { file: rel ? rel[1] : hit[1], line: hit[2] };
}

/**
 * Replace every register field of `m.regs` with a getter trap. Returns the tally the run fills:
 * reads (charged "module:line reg" -> count; an idiomatic module by its path under idiomatic/, any
 * other file as "<file>:<line> reg via <idiomatic module or no idiomatic caller>"), setterReads
 * (flag-write read-modify-writes, counted only to show the carve-out is exercised), engineReads (the
 * engine's own seam reads, counted only to show the carve-out is named), and arm/disarm switches.
 */
function trapRegisters(m) {
  const tally = { reads: new Map(), setterReads: 0, engineReads: 0, armed: false };
  const charge = (key) => tally.reads.set(key, (tally.reads.get(key) ?? 0) + 1);
  for (const k of REG_FIELDS) {
    // Most fields are width-masking accessors on the Regs prototype; the trap delegates to them, so the
    // run observes the shipped masked behaviour rather than a plain unmasked slot.
    const proto = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(m.regs), k);
    let value = m.regs[k];
    Object.defineProperty(m.regs, k, {
      configurable: true,
      enumerable: true,
      get() {
        if (tally.armed) {
          const frames = new Error().stack.split("\n").slice(2);
          if (frames.length && SETTER_FRAME.test(frames[0]) && REGS_FRAME.test(frames[0])) {
            tally.setterReads++;
          } else {
            // Walk out through the Regs accessors (hl, de, fC, ...) to the code that asked.
            const i = frames.findIndex((f) => !REGS_FRAME.test(f) && !f.includes("(<anonymous>)"));
            const at = i < 0 ? null : frames[i];
            const hit = at && at.match(IDIOMATIC_FRAME);
            if (hit) {
              charge(`${hit[1]}:${hit[2]} ${k}`);
            } else {
              // Not an idiomatic frame: charged unless it is the engine with no idiomatic code below it.
              const caller = frames.slice(Math.max(i, 0)).map((f) => f.match(IDIOMATIC_FRAME)).find(Boolean);
              const { file, line } = frameAt(at);
              if (!caller && ENGINE_FILES.has(file)) tally.engineReads++;
              else charge(`${file}:${line} ${k} via ${caller ? `${caller[1]}:${caller[2]}` : "no idiomatic caller"}`);
            }
          }
        }
        return proto ? proto.get.call(this) : value;
      },
      set(v) { if (proto) proto.set.call(this, v); else value = v; },
    });
  }
  return tally;
}

/** Run the coin/start/play tape (`live`) or attract from reset on the tree `machineUrl`. */
async function runTape(live, machineUrl = new URL("../machine.js", import.meta.url)) {
  const layer = await import(machineUrl.href);
  const overrides = await layer.resolveAllIdiomatic(machineUrl);
  const rom = new Uint8Array(readFileSync(join(GAME_DIR, "rom", "maincpu.bin")));
  const m = await layer.Machine.create(rom, { overrides });
  const tally = trapRegisters(m);
  tally.armed = true;
  const r = runIdiomaticGame(m, {
    nmiReturnPC: manifest.convergence.idiomatic.nmiReturnPC,
    maxFrames: NMIS,
    onFrame: (mm, f) => {
      tally.armed = false;
      if (f >= 1) mm.io.inputAssert = inputAt(f - 1, live);
      tally.armed = true;
    },
  });
  tally.armed = false;
  return { tally, frames: r.frames, stop: r.stopError ?? null };
}

/** distant_suite.py's own render argv for this schedule (idiomatic layer). */
function suiteArgv(file) {
  const out = execFileSync(
    "python3",
    ["games/timeplt/tools/distant_suite.py", "--schedule", `games/timeplt/tapes/${file}`,
      "--layer", "idiomatic", "--print-render-argv"],
    { cwd: REPO, encoding: "utf8" },
  );
  const drop = new Set(["--frames-out", "--reach", "--reach-out"]);
  return JSON.parse(out).argv.filter((x, i, a) => !drop.has(x) && !drop.has(a[i - 1]));
}

/** Run one distant schedule's render session, optionally on a mutated idiomatic tree. */
async function runDistant(file, idiomaticEdits) {
  const args = parseRenderArgs(["node", "render.js", ...suiteArgv(file)]);
  const { machine: m } = await createRenderMachine({ ...args, reach: [] }, { idiomaticEdits });
  m.captureVideo = false;
  const tally = trapRegisters(m);
  tally.armed = true;
  const states = runGeneratorFrames(m, args.frames, args.tapeOrigin ?? 0);
  tally.armed = false;
  return { tally, frames: states.length, want: args.frames, stop: m.stoppedBy };
}

const show = (tally) => [...tally.reads].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} x${n}`).join("; ");

// ── the gate ────────────────────────────────────────────────────────────────────────────────

for (const [label, live] of [["coin/start/play tape", true], ["attract", false]]) {
  test(`${label}: no idiomatic module reads a CPU register (${NMIS} NMIs)`, async () => {
    const { tally, frames, stop } = await runTape(live);
    assert.equal(stop, null, `the run stopped early: ${stop}`);
    assert.equal(frames, NMIS, "the run did not reach its NMI budget");
    assert.equal(tally.reads.size, 0, `idiomatic code read registers: ${show(tally)}`);
    assert.ok(tally.engineReads > 0, "no engine seam read was seen, so the engine carve-out was never tested");
  });
}

for (const file of TAPE_FILES) {
  test(`distant ${file}: no idiomatic module reads a CPU register`, async () => {
    const { tally, frames, want, stop } = await runDistant(file);
    assert.equal(stop, null, `the run stopped early: ${stop}`);
    assert.equal(frames, want, "the run did not reach its frame budget");
    assert.equal(tally.reads.size, 0, `idiomatic code read registers: ${show(tally)}`);
  });
}

// ── teeth: each mutant reintroduces one register read and must be heard ─────────────────────

const edit = (from, to) => (src) => src.replace(from, to);

test("TEETH: a scenery step that leaves its cursors out is heard (IX/IY, the tape)", async () => {
  const tree = idiomaticTree({ edits: {
    "driftTwoTileSceneryAtThreeQuarters.js": edit("return advanceToNextSlot(m, tileRecord, tileEntry);", "return advanceToNextSlot(m);"),
  } });
  const { tally } = await runTape(true, tree.machine);
  const keys = [...tally.reads.keys()];
  assert.ok(keys.some((k) => k.startsWith("advanceToNextSlot.js:") && k.endsWith(" ix")), `IX read not heard: ${keys.join(", ")}`);
  assert.ok(keys.some((k) => k.startsWith("advanceToNextSlot.js:") && k.endsWith(" iy")), `IY read not heard: ${keys.join(", ")}`);
});

test("TEETH: a round caption that leaves its cursor out is heard (DE through the pair accessor, a distant state)", async () => {
  const { tally } = await runDistant(TAPE_FILES[0], {
    "drawRoundNumberCaption.js": edit("cursor = retreatCharCursor(m, cursor);", "cursor = retreatCharCursor(m);"),
  });
  const keys = [...tally.reads.keys()];
  assert.ok(keys.some((k) => k.startsWith("retreatCharCursor.js:") && (k.endsWith(" d") || k.endsWith(" e"))),
    `DE read not heard: ${keys.join(", ")}`);
});

test("CARVE-OUT: a flag write alone is not charged (the setter reads F from F), attract", async () => {
  // The live layer makes no flag write, so the setter carve-out is met here, on a mutant that adds
  // one, and a green run is not green by never meeting one.
  const tree = idiomaticTree({ edits: {
    "hasReachedHorizontalEdgeWindow.js": edit("return arrived;", "return (m.regs.fC = arrived);"),
  } });
  const { tally } = await runTape(false, tree.machine);
  assert.ok(tally.setterReads > 0, "no flag write was seen, so the setter carve-out was never tested");
  assert.equal(tally.reads.size, 0, `a flag write alone was charged as a read: ${show(tally)}`);
});

test("TEETH: a flag read beside a flag write is heard (F through the fC accessor)", async () => {
  const tree = idiomaticTree({ edits: {
    "hasReachedHorizontalEdgeWindow.js": edit("return arrived;", "void m.regs.fC; return (m.regs.fC = arrived);"),
  } });
  const { tally } = await runTape(false, tree.machine);
  const keys = [...tally.reads.keys()];
  assert.ok(keys.some((k) => k.startsWith("hasReachedHorizontalEdgeWindow.js:") && k.endsWith(" f")), `F read not heard: ${keys.join(", ")}`);
});

test("TEETH: a register-file copy made through a native frame is heard (Object.assign, attract)", async () => {
  const tree = idiomaticTree({ edits: {
    "hasReachedHorizontalEdgeWindow.js": edit("return arrived;", "void Object.assign({}, m.regs); return arrived;"),
  } });
  const { tally } = await runTape(false, tree.machine);
  const keys = [...tally.reads.keys()];
  assert.ok(keys.some((k) => k.startsWith("hasReachedHorizontalEdgeWindow.js:") && k.endsWith(" a")), `Object.assign read not heard: ${keys.join(", ")}`);
});

/** A copied tree where hasReachedHorizontalEdgeWindow (run every attract frame) calls `helper(m)`
 * from `spec`, a module written at `rel` (relative to the tree's games/timeplt/idiomatic/). */
function helperTree(spec, rel) {
  const tree = idiomaticTree({ edits: {
    "hasReachedHorizontalEdgeWindow.js": (src) =>
      edit("return arrived;", "helper(m); return arrived;")(src)
      + `\nimport { helper } from "${spec}";\n`,
  } });
  const path = join(dirname(fileURLToPath(tree.machine)), "idiomatic", rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "export function helper(m) {\n  return m.regs.a;\n}\n");
  return tree;
}

test("TEETH: a register read in an idiomatic/ SUBDIRECTORY helper is heard (lib/evil.js, attract)", async () => {
  const tree = helperTree("./lib/evil.js", "lib/evil.js");
  const { tally } = await runTape(false, tree.machine);
  const keys = [...tally.reads.keys()];
  assert.ok(keys.some((k) => k.startsWith("lib/evil.js:2 a")), `subdirectory read not heard: ${keys.join(", ")}`);
});

test("TEETH: a register read in a helper OUTSIDE the layer is heard, charged via its idiomatic caller (attract)", async () => {
  const tree = helperTree("../../../core-mutant/z80ops_tmp.js", "../../../core-mutant/z80ops_tmp.js");
  const { tally } = await runTape(false, tree.machine);
  const keys = [...tally.reads.keys()];
  assert.ok(keys.some((k) => /\/core-mutant\/z80ops_tmp\.js:2 a via hasReachedHorizontalEdgeWindow\.js:\d+$/.test(k)),
    `outside-layer read not heard: ${keys.join(", ")}`);
});

test("TEETH: a register read in an ENGINE file on behalf of idiomatic code is heard (a machine.js method, attract)", async () => {
  const tree = idiomaticTree({ edits: {
    "hasReachedHorizontalEdgeWindow.js": edit("return arrived;", "m.peekA(); return arrived;"),
  } });
  const path = fileURLToPath(tree.machine);
  const src = readFileSync(path, "utf8");
  const at = "export class Machine {\n";
  assert.ok(src.includes(at), "machine.js has no Machine class to extend");
  writeFileSync(path, src.replace(at, `${at}  peekA() {\n    return this.regs.a;\n  }\n`));
  const { tally } = await runTape(false, tree.machine);
  const keys = [...tally.reads.keys()];
  assert.ok(keys.some((k) => /^games\/timeplt\/machine\.js:\d+ a via hasReachedHorizontalEdgeWindow\.js:\d+$/.test(k)),
    `engine-file read for idiomatic code not heard: ${keys.join(", ")}`);
});
