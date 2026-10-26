// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for spinToSelfHalt (ROM 0x3ff6, `jmp $3ff6`): a self-jump neither layer can run to
// completion, gated the timeplt-0167 way.
//   ROM       -- the bytes are 4C F6 3F, and the only F6 3F pairs in the image are that operand and the NMI
//                vector at 0x3ffa: no absolute operand in the program names this address.
//   EQUAL     -- one oracle step re-dispatches 0x3ff6 (stopped by a sentinel) and writes no RAM; the rewrite,
//                run in a worker against a counting proxy, neither returns nor touches the machine. The worker
//                is terminated, so the runner never hangs.
//   UNREACHED -- over live runs the IRQ vector handler is dispatched (positive control) and 0x3ff6 never is.
//                The NMI vector is never exercised: this machine model fires no NMI (machine.js).
// TEETH: an IRQ vector tampered to 0x3ff6 reaches it; a spin that kicks the watchdog and a spin that
// returns are both caught by the worker probe.
// Run: node --test games/centiped/idiomatic/test/equivalence-3ff6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { setTimeout as delay } from "node:timers/promises";

import { loc_3ff6 as oracle } from "../../translated/loc_3ff6.js";
import { Machine } from "../../machine.js";
import { buildRoutines } from "../../routines.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);
const TAPE = JSON.parse(readFileSync(new URL("../../tapes/coin_start_play.json", import.meta.url), "utf8"));
const SPIN_URL = new URL("../spinToSelfHalt.js", import.meta.url).href;

const TARGET = 0x3ff6;
const ROM_BASE = 0x2000;
const NMI_VECTOR = 0x3ffa, IRQ_VECTOR = 0x3ffe;
const IRQ_HANDLER = 0x3871;
const LIVE_FRAMES = 720;
const SPIN_MS = 250;

class Sentinel extends Error {}

const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const romAt = (img, a) => img[a - ROM_BASE];

test("ROM: 0x3ff6 is JMP $3ff6, named only by its own operand and the NMI vector", () => {
  assert.deepEqual([0, 1, 2].map((i) => romAt(ROM, TARGET + i)), [0x4c, 0xf6, 0x3f], "not the self-jump");
  const named = [];
  for (let a = ROM_BASE; a < 0x3fff; a++) {
    if (romAt(ROM, a) === 0xf6 && romAt(ROM, a + 1) === 0x3f) named.push(a);
  }
  assert.deepEqual(named, [TARGET + 1, NMI_VECTOR], "another absolute operand names 0x3ff6");
});

test("EQUAL (oracle): one step re-dispatches 0x3ff6 and writes no RAM", () => {
  const m = new Machine(ROM, { overrides: new Map([[TARGET, () => { throw new Sentinel(); }]]) });
  for (let a = 0; a < 0x0400; a++) m.mem.write8(a, (a * 37) ^ 0x5a);
  const before = m.dumpState();
  assert.throws(() => oracle(m), Sentinel, "the oracle did not jump back to 0x3ff6");
  assert.equal(m.pc, TARGET);
  assert.equal(firstStateDiff(before, m.dumpState(), (off) => m.stateOffsetToAddr(off), inDeadStack), null);
});

// Worker probe: flags = [started, machine touches, returned]. Mutants are defined inside the worker.
const WORKER_SRC = `
const { workerData } = require("node:worker_threads");
const flags = new Int32Array(workerData.shared);
const touch = () => Atomics.add(flags, 1, 1);
const m = new Proxy(function () {}, {
  get() { touch(); return m; }, set() { touch(); return true; }, apply() { touch(); return m; },
});
const MUTANTS = {
  kicksWatchdog: (mm) => { for (;;) mm.mem8[0x2000] = 0; },
  returns: () => {},
};
import(workerData.url).then((mod) => {
  const fn = workerData.mutant ? MUTANTS[workerData.mutant] : mod.spinToSelfHalt;
  Atomics.store(flags, 0, 1);
  fn(m);
  Atomics.store(flags, 2, 1);
});
`;

async function probe(mutant = null) {
  const shared = new SharedArrayBuffer(12);
  const flags = new Int32Array(shared);
  const w = new Worker(WORKER_SRC, { eval: true, workerData: { url: SPIN_URL, shared, mutant } });
  let err = null;
  w.on("error", (e) => { err = e; });
  try {
    for (let t = 0; Atomics.load(flags, 0) === 0 && !err && t < 1000; t++) await delay(10);
    await delay(SPIN_MS);
    return { started: Atomics.load(flags, 0), touches: Atomics.load(flags, 1), returned: Atomics.load(flags, 2), err };
  } finally {
    await w.terminate();
  }
}

test("EQUAL (rewrite): spinToSelfHalt neither returns nor touches the machine; mutants are caught", async () => {
  const r = await probe();
  assert.equal(r.err, null, `worker failed: ${r.err}`);
  assert.equal(r.started, 1, "the probe never entered spinToSelfHalt");
  assert.equal(r.returned, 0, "spinToSelfHalt returned");
  assert.equal(r.touches, 0, "spinToSelfHalt touched the machine; the oracle self-jump writes nothing");
  const kick = await probe("kicksWatchdog");
  assert.ok(kick.started === 1 && kick.touches > 0, "the probe FAILED to see a spin that kicks the watchdog");
  const ret = await probe("returns");
  assert.equal(ret.returned, 1, "the probe FAILED to see a spin that returns");
});

// A live oracle run counting dispatches of 0x3ff6 (stopped by a sentinel there) and of the IRQ handler.
function liveRun(image, tape) {
  const base = buildRoutines(), seen = { [TARGET]: 0, [IRQ_HANDLER]: 0 };
  const overrides = new Map([
    [TARGET, () => { seen[TARGET]++; throw new Sentinel(); }],
    [IRQ_HANDLER, (mm, ...x) => { seen[IRQ_HANDLER]++; return base.get(IRQ_HANDLER)(mm, ...x); }],
  ]);
  const m = new Machine(image, { overrides });
  if (tape) m.inputTape = tape;
  let hit = false;
  try { m.runFrames(LIVE_FRAMES); } catch (e) { if (!(e instanceof Sentinel)) throw e; hit = true; }
  return { seen, hit, stoppedBy: m.stoppedBy };
}

test("UNREACHED: live runs service the IRQ vector and never dispatch 0x3ff6", () => {
  for (const [label, tape] of [["undriven", null], ["coin-start-play", TAPE]]) {
    const r = liveRun(ROM, tape);
    assert.equal(r.hit, false, `${label}: 0x3ff6 was dispatched on a genuine live run`);
    assert.equal(r.stoppedBy, null, `${label} run stopped early: ${r.stoppedBy}`);
    assert.ok(r.seen[IRQ_HANDLER] > 0, `${label}: no vectored dispatch ran, so the zero proves nothing`);
    assert.equal(r.seen[TARGET], 0);
    console.log(`  UNREACHED: ${label} -- IRQ handler ${r.seen[IRQ_HANDLER]}, 0x3ff6 0`);
  }
});

test("TEETH: an IRQ vector tampered to 0x3ff6 reaches it", () => {
  const image = Uint8Array.from(ROM);
  image[IRQ_VECTOR - ROM_BASE] = TARGET & 0xff;
  image[IRQ_VECTOR + 1 - ROM_BASE] = TARGET >> 8;
  const r = liveRun(image, null);
  assert.equal(r.hit, true, "the tampered vector FAILED to reach 0x3ff6");
  assert.equal(r.seen[TARGET], 1);
  assert.equal(r.seen[IRQ_HANDLER], 0, "the tampered run still dispatched the genuine handler");
});
