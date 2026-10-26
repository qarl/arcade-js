// SPDX-License-Identifier: GPL-3.0-only
//
// idiomatic — the Donkey Kong go-live gates. Tests 1 and 2 run the ASSEMBLED game under the cycle-free
// coroutine engine (core/frame-stepped.js runIdiomaticGame) and compare it against the pure-
// translated oracle under runCycleFree, both crossing vblank at the wait at ROM 0x02BD. Test 3 is a
// structural check on the Machine; test 4 runs only the oracle. ROM-guarded.
//
//   1. "the idiomatic spine reproduces the translated oracle" — the override MAP holds only the boot
//      generator at 0x0000; the layer's direct imports run as JS and the engine fires the idiomatic
//      vblank handler directly (idiomaticNmi). 600 attract frames vs the oracle.
//
//   2. "the FULL FLIP" — resolveAllIdiomatic(), the configuration web/worker.js ships. Asserts SP is
//      INERT (runbook §4, "Retiring SP"): it never moves from its power-on value on any sample and
//      the direct-call NMI never touches it. Nothing resets SP any more, so a stray push/pop anywhere
//      in the frame shows as a persistent move (the old per-frame epilogue reset that absorbed
//      in-NMI deltas is gone). Also asserts the run reaches its budget and reproduces the oracle on
//      every live cell.
//
//   3. "with no overrides the seam is not installed at all" — an empty override map carries no own
//      push16/pop16/call, so every oracle run (incl. `runOracle` here) is the untouched prototype
//      path. Says nothing about the shipped player (test 2). Carries its own teeth.
//
//   4. "the seam's stack-effect tables still match the frozen oracle" — re-derives SEAM_CALLER_SKIP /
//      SEAM_TAIL_NO_RET from an instrumented attract run; entries attract never reaches are not
//      checked, and the count is reported.
//
// CONTRACT: byte-for-byte on every LIVE cell (work, sprite and video RAM), excluding only the dead
// stack scratch in [0x6BE0, 0x6C00) below each sample's live SP (test 2 proves the idiomatic SP inert).
// SCOPE: the ATTRACT sequence only; gameplay live-cell parity is NOT asserted here.

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  Machine, resolveOverrides, resolveAllIdiomatic, SEAM_CALLER_SKIP, SEAM_TAIL_NO_RET,
} from "../../machine.js";
import manifest from "../../manifest.js";
import { installEntropyPin } from "../../../../core/entropy-pin.js";
import { runIdiomaticGame, runCycleFree } from "../../../../core/frame-stepped.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const FRAMES = 600; // enough to boot and run the attract sequence

// A coverage choice, not a wall: the flip was measured live-cell identical to the oracle at 6000
// frames. The earlier walls (a leaked stack word, a register live-out dropped at the layer boundary,
// a pure-signature routine dispatched as fn(m)) were all invisible to per-routine gates — properties
// of the assembled game, which is why this test exists. Never lower it to make a failure go away.
const FLIP_FRAMES = 6000;

const { pollPCs, stateExclude, idiomatic } = manifest.convergence;
const { nmiReturnPC } = idiomatic;
const [STACK_LO, STACK_HI] = stateExclude.stack; // dead stack scratch, excluded (memory-equivalence)
const hex = (v) => `0x${(v & 0xffff).toString(16).padStart(4, "0")}`;

/** First live-cell divergence of two sampled runs ({ dumps, sps }), or null. Per sample, only the stack
 * scratch below the shallower of the two SPs is dead; every other cell is compared. */
function firstLiveDiff(x, y) {
  const probe = new Machine(ROM, {});
  const addrOf = Array.from(x.dumps[0], (_, o) => probe.stateOffsetToAddr(o));
  for (let i = 0; i < x.dumps.length; i++) {
    const dead = deadStackBelow({ lo: STACK_LO, hi: STACK_HI }, Math.max(x.sps[i], y.sps[i]));
    for (let o = 0; o < addrOf.length; o++) {
      if (x.dumps[i][o] !== y.dumps[i][o] && !dead(addrOf[o])) return { frame: i, addr: addrOf[o], a: x.dumps[i][o], b: y.dumps[i][o] };
    }
  }
  return null;
}

/** The pure-translated oracle under runCycleFree, sampled at the same 0x02BD vblank wait. */
function runOracle(frames) {
  const mt = new Machine(ROM, {});
  installEntropyPin(mt, manifest.entropyPin);
  const tr = { dumps: [], sps: [] };
  const rt = runCycleFree(mt, {
    pollPCs, maxFrames: frames, stepBudget: frames * 200000,
    onFrame: (m) => { tr.dumps.push(Buffer.from(m.dumpState())); tr.sps.push(m.regs.sp); },
  });
  assert.equal(rt.stopError, null, `translated oracle run errored: ${rt.stop}`);
  return tr;
}

test("the idiomatic spine reproduces the translated oracle (coroutine go-live)", async () => {
  // Wire the idiomatic control spine live: the boot generator (0x0000) is the entry; it delegates
  // into the mainLoop generator with `yield*` (idiomatic/boot.js imports it directly), so mainLoop
  // needs no registry override — an override at 0x02BD would be inert here, and m.call of a
  // generator returns an undriven generator (a silent no-op), so it is deliberately NOT registered.
  // Only the registry holds a single entry here; the vblank NMI still fires the idiomatic handler
  // directly (the engine sets idiomaticNmi). The full override map is test 2.
  const overrides = await resolveOverrides({
    "0": { module: "./idiomatic/boot.js", export: "boot" },
  });

  // Idiomatic run under the coroutine engine. Pin the spin-counter RNG (both runs) so the cycle-free
  // and poll-PC engines agree on the RNG — with the pin, every LIVE cell (incl. the 0x6019 counter)
  // reproduces byte-for-byte; only the dead stack scratch is excluded (see the comparison below).
  const mi = new Machine(ROM, { overrides });
  installEntropyPin(mi, manifest.entropyPin);
  const idi = { dumps: [], sps: [] };
  const ri = runIdiomaticGame(mi, {
    bootAddr: 0x0000,
    nmiReturnPC,
    maxFrames: FRAMES,
    onFrame: (m) => { idi.dumps.push(Buffer.from(m.dumpState())); idi.sps.push(m.regs.sp); },
  });
  assert.equal(ri.stopError, null, `idiomatic run errored: ${ri.stop}`);
  assert.ok(ri.frames >= FRAMES, `idiomatic run covered only ${ri.frames}/${FRAMES} frames (${ri.stop})`);

  const tr = runOracle(FRAMES);
  assert.equal(idi.dumps.length, tr.dumps.length, "frame counts differ between idiomatic and translated");

  // Compare the whole dumped state EXCEPT the stack scratch below each sample's live SP. This is the
  // memory-equivalence contract (manifest.convergence.stateExclude): idiomatic leaves are
  // DIRECT-called, so the oracle's transient push16/ret bytes below SP are never written — dead,
  // never read as data — while every LIVE cell must still match byte-for-byte.
  const d = firstLiveDiff(idi, tr);
  assert.equal(d, null, d && `frame ${d.frame}: idiomatic spine diverged from translated at ${hex(d.addr)} ` +
    `(idiomatic ${d.a} vs translated ${d.b})`);
});

test("the FULL FLIP: all idiomatic routines live, guest SP inert every frame", async () => {
  // THE CONFIGURATION THAT SHIPS. resolveAllIdiomatic() wires every routine in ROUTINES as an
  // override — the same call web/worker.js makes — which is the ONLY configuration that exercises
  // the translated->idiomatic seam: a frozen translated caller emits `push16(RET)` before its
  // `m.call`, and the idiomatic callee models the Z80 `ret` as a JS `return`. Nothing in the test
  // suite ran this before, which is why a 12-14 byte per-frame guest-stack leak shipped undetected
  // until SP walked into the task ring at 0x60C0 and the game died on dispatched stack garbage.
  const overrides = await resolveAllIdiomatic();
  assert.ok(overrides.size > 300, `expected the whole idiomatic layer wired, got ${overrides.size}`);

  const mi = new Machine(ROM, { overrides });
  installEntropyPin(mi, manifest.entropyPin);

  // The vblank NMI is a direct JS call in this engine: it must not touch SP at all. This localises a
  // fault to the NMI chain instead of only showing up as a moved SP at the next sample.
  const nmiFaults = [];
  const realFire = mi.fireNmi.bind(mi);
  mi.fireNmi = function () {
    const before = mi.regs.sp;
    realFire();
    if (mi.regs.sp !== before) nmiFaults.push(`${hex(before)} -> ${hex(mi.regs.sp)}`);
  };

  const idi = { dumps: [], sps: [] };
  const SP_RESET = mi.regs.sp; // power-on value; nothing in the idiomatic layer seats or moves SP
  const spFaults = [];
  const ri = runIdiomaticGame(mi, {
    bootAddr: 0x0000,
    nmiReturnPC,
    maxFrames: FLIP_FRAMES,
    onFrame: (m, frame) => {
      idi.dumps.push(Buffer.from(m.dumpState()));
      idi.sps.push(m.regs.sp);
      // THE ASSERTION. SP is retired: it must sit at its reset value on EVERY sample, frame 0 included.
      if (m.regs.sp !== SP_RESET) spFaults.push(`frame ${frame}: SP ${hex(m.regs.sp)}`);
    },
  });

  // A leak repeats every frame, so print the first few and the count rather than 500 lines: the
  // FIRST entry is the diagnosis (which frame it started on and in which direction), the count is
  // the severity.
  const brief = (xs) => (xs.length <= 6 ? xs.join("; ") : `${xs.slice(0, 6).join("; ")} … (${xs.length} in all)`);

  assert.equal(
    spFaults.length, 0,
    `guest SP moved off its reset value ${hex(SP_RESET)} — a push/pop or SP seat survives in the ` +
      `idiomatic layer: ${brief(spFaults)}`,
  );
  assert.equal(nmiFaults.length, 0, `the vblank NMI changed SP: ${brief(nmiFaults)}`);

  // COVERAGE, ASSERTED. "It died at frame 237" was not previously a test failure at all; these two
  // are what make a truncated run red instead of quietly short.
  assert.equal(ri.stopError, null, `full flip errored: ${ri.stop}`);
  assert.ok(
    ri.frames >= FLIP_FRAMES,
    `full flip covered only ${ri.frames}/${FLIP_FRAMES} frames (${ri.stop})`,
  );

  // And the flip must still BE the oracle on every live cell, not merely stack-balanced.
  const tr = runOracle(FLIP_FRAMES);
  assert.equal(idi.dumps.length, tr.dumps.length, "frame counts differ between the full flip and the oracle");
  const d = firstLiveDiff(idi, tr);
  assert.equal(d, null, d && `frame ${d.frame}: the full flip diverged from translated at ${hex(d.addr)} ` +
    `(flip ${d.a} vs translated ${d.b})`);
});

test("with no overrides the seam is not installed at all (the oracle path is untouched)", () => {
  // The seam's whole licence to exist is that it CANNOT affect a Machine with no overrides — every
  // oracle suite and every convergence baseline is on that path, including `runOracle` above
  // (`new Machine(ROM, {})`), i.e. the reference side of every comparison in this file. Asserting
  // "the numbers still match" would prove it only for the cases we happen to run. This proves it
  // STRUCTURALLY: with an empty override map the Machine carries no own push16/pop16/call at all,
  // so those calls resolve to the same prototype methods they always did.
  //
  // ★ WHAT THIS TEST DOES *NOT* COVER: THE SHIPPED PLAYER. It does not run on this path.
  // games/dkong/manifest.js sets `runtime: "idiomatic"`, and web/worker.js branches on exactly that
  // (`const idiomatic = manifest.runtime === "idiomatic"`), handing in
  // `machineMod.resolveAllIdiomatic(...)` — the FULL override map, seam installed, every frame the
  // player runs. The shipped configuration is therefore the one test 2 wires (the same
  // `resolveAllIdiomatic()`), and test 2 is the only gate that covers it. Read this test for what
  // it is: the guarantee that no-override Machines — the ORACLES the other gates measure against —
  // stay the untouched prototype path, so the seam cannot quietly move the reference too.
  for (const opts of [{}, { overrides: {} }, { overrides: new Map() }]) {
    const m = new Machine(ROM, opts);
    assert.equal(m.overrides.size, 0, "expected an empty override map");
    for (const name of ["push16", "pop16", "call"]) {
      assert.equal(
        Object.hasOwn(m, name), false,
        `Machine built with ${JSON.stringify(Object.keys(opts))} shadows ${name} — the seam was ` +
          "installed on a machine with no overrides, so the pure-oracle path is no longer the " +
          "untouched prototype path",
      );
      assert.equal(m[name], Machine.prototype[name], `${name} is not the prototype method`);
    }
  }

  // TEETH: the same three properties MUST be shadowed once an override exists, or the check above
  // would pass for a machine that simply never installs the seam.
  const wired = new Machine(ROM, { overrides: { "141": (mm) => mm } });
  assert.equal(wired.overrides.size, 1);
  for (const name of ["push16", "pop16", "call"]) {
    assert.equal(Object.hasOwn(wired, name), true, `expected the seam to shadow ${name} when wired`);
  }
});

test("the seam's stack-effect tables still match the frozen oracle", async () => {
  // machine.js's seam models two facts ABOUT THE ORACLE: which routines consume TWO stack words on
  // a `false` return (the caller-skip idiom), and which `jp`-tail targets consume NONE because
  // their oracle twin never rets. Both are committed tables, and a committed table can rot. This
  // re-derives them by instrumenting a pure-oracle run and diffs, so a `translated/` change that
  // moved a routine between classes fails HERE rather than as a mystery SP drift in test 2.
  const m = new Machine(ROM, {});
  installEntropyPin(m, manifest.entropyPin);

  // Mirror the seam's own adjacency rule: a translated `call` is emitted as
  // `push16(RET); step(...); call(T)`, a `jp` tail as a bare `call(T)`.
  let lastPushSp = -1;
  const basePush = m.push16.bind(m);
  const basePop = m.pop16.bind(m);
  const baseCall = m.call.bind(m);
  m.push16 = (v) => { basePush(v); lastPushSp = m.regs.sp; };
  m.pop16 = () => { lastPushSp = -1; return basePop(); };

  const seen = new Map(); // addr -> { plain:Set<delta>, skip:Set<delta>, tail:Set<delta> }
  const bucket = (addr) => {
    if (!seen.has(addr)) seen.set(addr, { plain: new Set(), skip: new Set(), tail: new Set() });
    return seen.get(addr);
  };
  m.call = (addr, ...args) => {
    const sp0 = m.regs.sp;
    const opened = lastPushSp === sp0;
    const r = baseCall(addr, ...args);
    const delta = ((m.regs.sp - sp0) << 16) >> 16;
    const b = bucket(addr);
    (r === false ? b.skip : b.plain).add(delta);
    if (!opened) b.tail.add(delta);
    return r;
  };

  const frames = 600;
  const res = runCycleFree(m, {
    pollPCs, maxFrames: frames, stepBudget: frames * 200000, onFrame: () => {},
  });
  assert.equal(res.stopError, null, `instrumented oracle run errored: ${res.stop}`);

  // ONLY ROUTINES WITH AN IDIOMATIC TWIN CAN EVER BE WRAPPED, so only they are in scope. An
  // address with no entry in ROUTINES (0x30FA was the example here until it was wired) is never an
  // override and the seam never sees it.
  const { ROUTINES } = await import("../names.js");
  const overridable = (a) => Object.hasOwn(ROUTINES, String(a));

  // AND only routines whose ordinary return consumes exactly ONE bracket, which is the shape the
  // seam's default models. 0x0028 is the counter-example worth naming: the `rst 0x28` trampoline
  // consumes FOUR words normally (its own `pop hl` of the table base plus the dispatched target's
  // `ret` of the continuation) and six on a skip. Its idiomatic twin performs that `pop hl` itself,
  // so the wrapper's "did the body leave SP alone?" guard already declines and neither table
  // applies. Filtering on the observed one-bracket shape keeps this check about what the tables
  // actually decide.
  const oneBracket = (b) => b.plain.size === 1 && b.plain.has(2);
  const list = (xs) => [...xs].sort((a, b) => a - b).map(hex).join(" ");

  const skipObserved = [];
  const skipContradicted = [];
  const tailZero = [];
  const tailRet = [];
  for (const [addr, b] of seen) {
    if (!overridable(addr)) continue;
    if (b.skip.size && (oneBracket(b) || b.plain.size === 0)) {
      if ([...b.skip].some((d) => d >= 4)) skipObserved.push(addr);
      else skipContradicted.push(addr);
    }
    if (b.tail.size) {
      if ([...b.tail].every((d) => d === 0)) tailZero.push(addr);
      else if ([...b.tail].every((d) => d !== 0)) tailRet.push(addr);
    }
  }

  // (a) Nothing the oracle skips two words on may be missing from the table — that is a 2-byte
  //     leak per skip at the seam.
  const missingSkip = skipObserved.filter((a) => !SEAM_CALLER_SKIP.has(a));
  assert.deepEqual(
    missingSkip.map(hex), [],
    "the oracle consumes TWO stack words on these routines' `false` return but they are absent " +
      `from SEAM_CALLER_SKIP in games/dkong/machine.js: ${list(missingSkip)}`,
  );
  // (b) Nothing in the table may be observed consuming only one — that is an over-pop.
  const wrongSkip = skipContradicted.filter((a) => SEAM_CALLER_SKIP.has(a));
  assert.deepEqual(
    wrongSkip.map(hex), [],
    "SEAM_CALLER_SKIP claims these consume two words on `false`, but the oracle consumed one: " +
      `${list(wrongSkip)}`,
  );
  // (c)/(d) the same two directions for the `jp`-tail table.
  const missingTail = tailZero.filter((a) => !SEAM_TAIL_NO_RET.has(a));
  assert.deepEqual(
    missingTail.map(hex), [],
    "these `jp`-tail targets consume NO stack word in the oracle but are absent from " +
      `SEAM_TAIL_NO_RET, so the seam would over-pop for them: ${list(missingTail)}`,
  );
  const wrongTail = tailRet.filter((a) => SEAM_TAIL_NO_RET.has(a));
  assert.deepEqual(
    wrongTail.map(hex), [],
    `SEAM_TAIL_NO_RET claims these never ret, but the oracle consumed a word: ${list(wrongTail)}`,
  );

  // COVERAGE, STATED RATHER THAN IMPLIED (this is the half a "table matches" claim usually hides).
  // The attract run reaches only some of each table; the rest are asserted by NOTHING here.
  const skipSeen = [...SEAM_CALLER_SKIP].filter((a) => skipObserved.includes(a));
  const tailSeen = [...SEAM_TAIL_NO_RET].filter((a) => tailZero.includes(a));
  assert.ok(
    skipSeen.length > 0 && tailSeen.length > 0,
    "no table entry was reached at all — this check would be vacuous; the attract run must " +
      "exercise at least one caller-skip and one non-returning `jp` tail",
  );
  // Non-vacuous but PARTIAL, and the numbers say by how much. SEAM_CALLER_SKIP's unreached entries
  // are gameplay-only guards (0x1783/0x1A2A/0x1E85/0x2257/0x236E/0x2913/0x2B74/0x2B91/0x311B/
  // 0x3126/0x3131/0x33A1 — twelve as of decompile batch 3, which added 0x33A1); they are
  // justified in machine.js from the frozen oracle's source, not here.
  assert.equal(
    tailSeen.length, SEAM_TAIL_NO_RET.size,
    "every SEAM_TAIL_NO_RET entry is reached by attract, so a shortfall means the board-layout " +
      "walk changed shape",
  );
});
