// SPDX-License-Identifier: GPL-3.0-only
/**
 * DISTANT-TAPE REACH, MAME-free. Every games/timeplt/tapes/*.poke.json declares the routines it exists
 * to put on the glass (`reaches`); tools/distant_suite.py fails a tape whose pixel window those
 * routines never ran in, but only where MAME is installed. This runs the same check without MAME,
 * on every commit: each schedule is rendered through render-lib.js -- the setup render.js uses --
 * from the exact argv distant_suite.py builds (`--print-render-argv`), so the alignment is never
 * re-derived here. Asserts, per tape: the JS side reaches the schedule's `responded` state, and
 * every declared routine runs from that frame to the end of the compared window.
 *
 * The instrument counts a routine at its own BODY however it is entered (render-lib.js): an
 * override-map dispatch, a direct call from another idiomatic module, or the vblank subtree machine.js
 * fires directly.
 *
 * TEETH. Each declared routine has a mutant that must turn this red: its body is made a NO-OP in the
 * copied idiomatic tree (an inlined arm instead loses its call in the routine it is inlined into). A
 * routine no idiomatic module imports is also UNWIRED (its address falls back to the translated twin,
 * so the idiomatic routine never runs), which must turn it red too; one an idiomatic module calls
 * directly must still count when unwired -- that is the direct-entry path being seen. A routine whose
 * only entry is cut, body left intact, must count 0. Removing a tape's pokes must also turn it red.
 * `DISTANT_REACH_MUTANT=<routine>` applies that routine's no-op mutant to the main arm, to watch it go red.
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  GAME_DIR, DIRECT_PROBES, parseRenderArgs, createRenderMachine, runGeneratorFrames,
} from "../tools/render-lib.js";
import { ROUTINES } from "../idiomatic/names.js";

const REPO = join(GAME_DIR, "..", "..");
// BYO ROM: every arm that renders needs the four regions render.js loads; without them it SKIPS.
const ROM_PRESENT = ["maincpu", "tiles", "sprites", "proms"].every((r) => existsSync(join(GAME_DIR, "rom", `${r}.bin`)));
const test = nodeTest;
const romTest = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "ROM absent at games/timeplt/rom/ (BYO)" }, fn);
const TAPES = join(GAME_DIR, "tapes");
const TAPE_FILES = readdirSync(TAPES).filter((f) => f.endsWith(".poke.json")).sort();
const SCHED = Object.fromEntries(
  TAPE_FILES.map((f) => [f, JSON.parse(readFileSync(join(TAPES, f), "utf8"))]),
);
const ADDR = new Map(Object.entries(ROUTINES).map(([a, m]) => [m.name, Number(a)]));
const int = (v) => Number(v); // "0x7d" or 125

function match(byte, op, val) {
  if (op === "eq") return byte === val;
  if (op === "ne") return byte !== val;
  if (op === "ge") return byte >= val;
  if (op === "nonzero") return byte !== 0;
  throw new Error(`unknown responded op ${op}`);
}

/** distant_suite.py's own render argv + window end for this tape (idiomatic layer). */
function suiteArgv(file) {
  const out = execFileSync(
    "python3",
    ["games/timeplt/tools/distant_suite.py", "--schedule", `games/timeplt/tapes/${file}`,
      "--layer", "idiomatic", "--print-render-argv"],
    { cwd: REPO, encoding: "utf8" },
  );
  return JSON.parse(out);
}

// ── mutants: edits to the copied idiomatic tree render-lib.js runs the reach from ──

const IDIOMATIC = join(GAME_DIR, "idiomatic");
const MODULES = readdirSync(IDIOMATIC).filter((f) => f.endsWith(".js"));
/** Idiomatic modules that import `name` (so enter it directly, not through the override map). */
const importers = (name) => MODULES.filter((f) => f !== `${name}.js` &&
  readFileSync(join(IDIOMATIC, f), "utf8").includes(`from "./${name}.js"`));

/** A no-op body for `name` (a generator stays one), keeping the module's other exports. */
const noOp = (name) => (src) => {
  const gen = new RegExp(`^export function\\*\\s*${name}\\s*\\(`, "m").test(src);
  return src.replace(new RegExp(`^export function(\\*?)\\s*${name}\\s*\\(`, "m"), `function$1 __replaced_${name}(`) +
    `\nexport function${gen ? "*" : ""} ${name}() { return undefined; }\n`;
};

/** The mutant for one declared routine: its body never runs. */
function mutantFor(name) {
  if (name === "stepCountdownSlotThenCloseTurn") {
    // inlined into the sweep: the mutant drops the sweep's drifting-countdown arm
    return {
      idiomaticEdits: {
        "serviceSlotByMarkerThenCloseSweepTurn.js": (s) => s.replace("    stepDriftingCountdownObjectByEraFrames(m, record, entry);\n", ""),
      },
    };
  }
  return { idiomaticEdits: { [`${name}.js`]: noOp(name) } };
}

/** Unwire `name` from the override map: its address falls back to the translated twin. */
const unwire = (name) => ({
  editOverrides: (ov) => { assert.ok(ov.delete(ADDR.get(name)), `${name} was not in the override map`); },
});

/** Render one tape; return { stop, respondedAt, missing[], hits{} }. */
async function runTape(file, { mutant = {}, dropPokes = false, extraPokes = [], reachNames } = {}) {
  const sched = SCHED[file];
  const { argv, window_end: windowEnd } = suiteArgv(file);
  const args = parseRenderArgs(["node", "render.js", ...argv]);
  if (dropPokes) args.pokes = [];
  args.pokes.push(...extraPokes);
  if (reachNames) args.reach = reachNames;
  const { machine, reach } = await createRenderMachine(args, mutant);
  const r = sched.responded;
  const cell = int(r.cell), val = int(r.val), op = r.op ?? "eq";
  let respondedAt = null;
  runGeneratorFrames(machine, args.frames, args.tapeOrigin ?? 0, (i) => {
    // frame i-1's state is final here; code from now on belongs to frame i
    if (respondedAt === null && match(machine.mem8[cell], op, val)) respondedAt = i - 1;
    reach.frame = i;
  });
  const hits = {};
  const missing = [];
  for (const name of args.reach) {
    let n = 0;
    if (respondedAt !== null) {
      for (const [f, c] of reach.routines[name].hits) if (f >= respondedAt && f < windowEnd) n += c;
    }
    hits[name] = n;
    if (!n) missing.push(name);
  }
  return { stop: machine.stoppedBy ? String(machine.stoppedBy) : null, respondedAt, missing, hits, windowEnd };
}

const ENV_MUTANT = process.env.DISTANT_REACH_MUTANT || null;

test("SUITES and the tapes on disk agree, and every tape declares its reaches", () => {
  const out = execFileSync("python3", ["-c",
    "import json,sys; sys.path.insert(0,'tools'); import pixel_gate_required as g; " +
    "print(json.dumps([a[a.index('--schedule')+1] for a,_ in g.SUITES['timeplt'] if '--schedule' in a]))"],
    { cwd: REPO, encoding: "utf8" });
  assert.deepEqual(JSON.parse(out), TAPE_FILES.map((f) => `games/timeplt/tapes/${f}`));
  assert.ok(TAPE_FILES.length > 0, "no distant tapes on disk");
  for (const f of TAPE_FILES) {
    const s = SCHED[f];
    assert.equal(`${s.name}.poke.json`, f, `${f}: schedule name must match its file`);
    assert.ok(Array.isArray(s.reaches) && s.reaches.length, `${f}: no 'reaches' declared`);
    for (const n of s.reaches) assert.ok(ADDR.has(n), `${f}: ${n} is not a routine in names.js`);
  }
});

for (const file of TAPE_FILES) {
  romTest(`${SCHED[file].name}: responded state reached and every declared routine runs from it`, async () => {
    let mutant = {};
    if (ENV_MUTANT && SCHED[file].reaches.includes(ENV_MUTANT)) mutant = mutantFor(ENV_MUTANT);
    const r = await runTape(file, { mutant });
    assert.equal(r.stop, null, `${file}: render stopped: ${r.stop}`);
    assert.notEqual(r.respondedAt, null, `${file}: JS side never satisfied 'responded'`);
    assert.deepEqual(r.missing, [], `${file}: not reached in JS frames ${r.respondedAt}..${r.windowEnd - 1}: ` +
      `${r.missing.join(", ")} (hits ${JSON.stringify(r.hits)})`);
  });
}

// Each declared routine's mutant, on the first tape that declares it, must be reported missing.
const MUTANT_CASES = new Map();
for (const f of TAPE_FILES) for (const n of SCHED[f].reaches) if (!MUTANT_CASES.has(n)) MUTANT_CASES.set(n, f);
for (const [name, file] of MUTANT_CASES) {
  romTest(`mutant: ${name} disabled -> ${SCHED[file].name} reports it NOT reached`, async () => {
    const r = await runTape(file, { mutant: mutantFor(name) });
    assert.ok(r.missing.includes(name), `mutant of ${name} still counted ${r.hits[name]} hit(s) -- the reach ` +
      "check cannot fail for it");
  });
  if (name in DIRECT_PROBES) continue; // an inlined arm has no map entry of its own to unwire
  if (!importers(name).length) {
    romTest(`mutant: ${name} unwired -> ${SCHED[file].name} reports it NOT reached (the translated twin counts nothing)`, async () => {
      const r = await runTape(file, { mutant: unwire(name) });
      assert.ok(r.missing.includes(name), `unwired ${name} still counted ${r.hits[name]} hit(s) -- the translated ` +
        "twin is being counted as the idiomatic routine");
    });
  } else {
    romTest(`control: ${name} unwired -> ${SCHED[file].name} STILL counts it (entered directly by ${importers(name).join(", ")})`, async () => {
      const r = await runTape(file, { mutant: unwire(name) });
      assert.ok(!r.missing.includes(name), `unwired ${name} counted nothing, yet ${importers(name).join(", ")} ` +
        "call it directly -- the instrument is blind to direct entry");
    });
  }
}

romTest("control: removing a tape's pokes turns it red", async () => {
  for (const file of TAPE_FILES) {
    const r = await runTape(file, { dropPokes: true });
    const red = r.stop !== null || r.respondedAt === null || r.missing.length > 0;
    assert.ok(red, `${file}: still green with its pokes removed (responded@${r.respondedAt}, ` +
      `hits ${JSON.stringify(r.hits)}) -- the pokes are not what drives the distant state`);
  }
});

romTest("control: the inlined 0x4108 arm's probe fires on a planted drifting marker, and its mutant silences it", async () => {
  // era-advance does not reach the arm (countdown-slot does); planting a marker there proves the probe
  // fires on a planted marker and not on the unplanted tape.
  const file = "era-advance.poke.json";
  const plant = [{ addr: 0xa8c0, val: 0x20, frame: 960, dur: 1 }]; // slot 0's marker -> a drifting object
  const names = ["serviceSlotByMarkerThenCloseSweepTurn", "stepCountdownSlotThenCloseTurn"];
  const base = await runTape(file, { extraPokes: plant, reachNames: names });
  assert.ok(base.hits.stepCountdownSlotThenCloseTurn > 0, `planted marker: arm probe never fired ${JSON.stringify(base.hits)}`);
  const plain = await runTape(file, { reachNames: names });
  assert.equal(plain.hits.stepCountdownSlotThenCloseTurn, 0, "the arm is reached by the tape itself -- declare it");
  const mut = await runTape(file, { extraPokes: plant, reachNames: names, mutant: mutantFor("stepCountdownSlotThenCloseTurn") });
  assert.equal(mut.hits.stepCountdownSlotThenCloseTurn, 0, "arm mutant still counted hits");
});

romTest("control: a routine whose only entry is cut (body intact) counts 0, while its siblings still count", async () => {
  // postLifeStartCaptionsAndResetPlayfield is entered only as arm 4 of dispatchSequenceSubStepArm's switch
  // (asserted) or through its map entry. Unwire the entry and route arm 4 to the TRANSLATED twin the way
  // the frozen dispatch did (resume slot parked, then the ROM arm): the game runs the arm's ROM body and
  // plays on, but the idiomatic body is never entered and is left untouched -- so a nonzero count would
  // be the instrument inventing an execution.
  const name = "postLifeStartCaptionsAndResetPlayfield";
  const file = "boss-armed.poke.json";
  assert.deepEqual(importers(name), ["dispatchSequenceSubStepArm.js"], `${name} gained another direct caller`);
  const hex = (n) => `0x${n.toString(16)}`;
  const before = `    case 4: ${name}(m); break;\n`;
  const cut = (s) => {
    assert.ok(s.includes(before), "arm 4 of the switch moved -- update this control");
    return s.replace(before, `    case 4: m.push16(${hex(ADDR.get("advanceAttractTowardGameStart"))}); m.call(${hex(ADDR.get(name))}); break;\n`);
  };
  const r = await runTape(file, {
    mutant: { idiomaticEdits: { "dispatchSequenceSubStepArm.js": cut }, ...unwire(name) },
  });
  assert.equal(r.stop, null, `render stopped: ${r.stop}`);
  assert.notEqual(r.respondedAt, null, "vacuous: the tape never reached its responded state");
  assert.equal(r.hits[name], 0, `${name} counted ${r.hits[name]} with every entry to it cut`);
  for (const sibling of ["flyLifeStartHoldThenEraseLifeStartCaptions", "flyEnemyFreeLeadInThenStepSequence"]) {
    assert.ok(r.hits[sibling] > 0, `positive control: ${sibling} (same switch, same run) counted nothing`);
  }
});
