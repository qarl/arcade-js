// SPDX-License-Identifier: GPL-3.0-only
/**
 * tools/raw_dumps.py deletes raw capture dumps (*.rgb, state.bin) once a verdict is in, on EVERY exit path,
 * and every script that drives a producer (mame_golden.py, render.js/emit.js, a raw -aviwrite) goes through
 * it. No ROM or MAME: a stub suite writes small synthetic dumps through the real helper.
 *   - a PASS run, a FAIL verdict, a crash mid-compare and a SIGTERM leave none behind; --keep-frames keeps them;
 *   - the `run` wrapper (ad-hoc drivers) does the same and passes the command's exit code through;
 *   - a SIGTERM while a producer child holds a temp capture leaves nothing there either (the child is
 *     stopped and runs its own cleanup first), in-process and through the wrapper;
 *   - a sweep refuses '', $HOME, the repo root and their ancestors (dummy files, a stand-in HOME and repo);
 *   - every producer-driving script uses the helper, and every pixel suite takes --keep-frames.
 * Run: node --test tools/test/raw-dumps.test.js
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = dirname(TOOLS);
const HELPER = join(TOOLS, "raw_dumps.py");
const SCRATCH = mkdtempSync(join(tmpdir(), "raw-dumps-test-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

// A stub suite shaped like the real ones: capture into golden/ + js/, then judge, inside raw_dumps.
const STUB = join(SCRATCH, "stub_suite.py");
writeFileSync(STUB, `import os, sys, time
sys.path.insert(0, ${JSON.stringify(TOOLS)})
from raw_dumps import raw_dumps
work, mode = sys.argv[1], sys.argv[2]
summary = {"suite": "stub", "verdict": "CRASH"}
def gate():
    for sub, names in (("golden", ("frames.rgb", "state.bin", "frames.json")), ("js", ("frames.rgb", "frames.json"))):
        os.makedirs(os.path.join(work, sub), exist_ok=True)
        for n in names:
            open(os.path.join(work, sub, n), "wb").write(bytes(4096))
    if mode == "crash":
        raise RuntimeError("compare crashed mid-diff")
    if mode == "hang":
        print("READY", flush=True)
        time.sleep(60)
    summary["verdict"] = "PASS" if mode == "pass" else "FAIL"
    print("stub_suite: " + summary["verdict"])
    return 0 if mode == "pass" else 1
with raw_dumps(work, keep="--keep-frames" in sys.argv, summary=summary):
    sys.exit(gate())
`);

// A producer for the wrapper: writes dumps into argv[1], then exits with argv[2] (or hangs).
const PRODUCER = join(SCRATCH, "producer.py");
writeFileSync(PRODUCER, `import os, sys, time
out, how = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
for n in ("frames.rgb", "state.bin", "frames.json"):
    open(os.path.join(out, n), "wb").write(bytes(4096))
if how == "hang":
    print("READY", flush=True)
    time.sleep(60)
sys.exit(int(how))
`);

let n = 0;
const freshWork = () => join(SCRATCH, `w${n++}`);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const raw = (dir) => walk(dir).filter((p) => p.endsWith(".rgb") || p.endsWith("state.bin"));
const summaryOf = (dir) => JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));

function runStub(mode, ...extra) {
  const work = freshWork();
  const r = spawnSync("python3", [STUB, work, mode, ...extra], { encoding: "utf8" });
  return { work, r };
}

// Start `argv`, wait for its READY line, SIGTERM it, and resolve with its exit {code, signal}.
function termAfterReady(argv, env = process.env) {
  return new Promise((resolve, reject) => {
    const c = spawn("python3", argv, { stdio: ["ignore", "pipe", "pipe"], env });
    let out = "";
    const t = setTimeout(() => { c.kill("SIGKILL"); reject(new Error("never became READY: " + out)); }, 20000);
    c.stdout.on("data", (d) => {
      out += d;
      if (out.includes("READY")) c.kill("SIGTERM");
    });
    c.on("exit", (code, signal) => { clearTimeout(t); resolve({ code, signal }); });
  });
}

test("a PASS run leaves no raw dumps, keeps the small artifacts and a PASS summary", () => {
  const { work, r } = runStub("pass");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(raw(work), []);
  assert.ok(existsSync(join(work, "golden", "frames.json")), "frames.json hashes stay");
  assert.equal(summaryOf(work).verdict, "PASS");
  assert.equal(summaryOf(work).raw_frames_kept, false);
});

test("a FAIL verdict leaves no raw dumps and records the FAIL", () => {
  const { work, r } = runStub("fail");
  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(raw(work), []);
  assert.equal(summaryOf(work).verdict, "FAIL");
});

test("a crash mid-compare leaves no raw dumps and records CRASH", () => {
  const { work, r } = runStub("crash");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /compare crashed/);
  assert.deepEqual(raw(work), []);
  assert.equal(summaryOf(work).verdict, "CRASH");
});

test("a SIGTERM mid-run leaves no raw dumps", async () => {
  const work = freshWork();
  const { code } = await termAfterReady([STUB, work, "hang"]);
  assert.equal(code, 128 + 15, "exits 128+SIGTERM through the cleanup, not killed past it");
  assert.ok(existsSync(join(work, "golden")), "the stub did produce before the signal");
  assert.deepEqual(raw(work), []);
});

test("--keep-frames keeps the raw dumps (and says so in the summary)", () => {
  const { work, r } = runStub("fail", "--keep-frames");
  assert.equal(r.status, 1, r.stderr);
  assert.equal(raw(work).length, 3);
  assert.equal(summaryOf(work).raw_frames_kept, true);
});

test("rmtree mode removes a private temp dir whole; keep leaves it", () => {
  for (const keep of [false, true]) {
    const work = freshWork();
    const r = spawnSync("python3", ["-c", `import os, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
from raw_dumps import raw_dumps
os.makedirs(${JSON.stringify(work)})
with raw_dumps(${JSON.stringify(work)}, keep=${keep ? "True" : "False"}, rmtree=True):
    open(os.path.join(${JSON.stringify(work)}, "frames.rgb"), "wb").write(bytes(64))
    sys.exit(1)`], { encoding: "utf8" });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(existsSync(work), keep);
  }
});

test("run wrapper: PASS and FAIL commands leave no dumps and keep the command's exit code", () => {
  for (const code of [0, 3]) {
    const out = freshWork();
    const r = spawnSync("python3", [HELPER, "run", "--dir", out, "--", "python3", PRODUCER, out, String(code)],
      { encoding: "utf8" });
    assert.equal(r.status, code, r.stderr);
    assert.deepEqual(raw(out), []);
    assert.ok(existsSync(join(out, "frames.json")), "small artifacts stay");
  }
});

test("run wrapper: a SIGTERM to the wrapper reaches the command and still cleans up", async () => {
  const out = freshWork();
  const { code } = await termAfterReady([HELPER, "run", "--dir", out, "--", "python3", PRODUCER, out, "hang"]);
  assert.equal(code, 128 + 15);
  assert.ok(existsSync(join(out, "frames.json")), "the producer did produce before the signal");
  assert.deepEqual(raw(out), []);
});

test("run wrapper: --keep-frames keeps the dumps", () => {
  const out = freshWork();
  const r = spawnSync("python3", [HELPER, "run", "--dir", out, "--keep-frames", "--", "python3", PRODUCER, out, "0"],
    { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(raw(out).length, 2);
});

// ── a producer holding a temp capture when its caller is SIGTERMed ─────────────────────────────────
// Shaped like mame_golden.py: signals_to_exit() around main, a temp capture dir (out.avi, state.raw) in
// $TMPDIR removed by main's `finally`, a long-running grandchild (MAME) and a frames.rgb into the caller's dir.
const HOLDER = join(SCRATCH, "holder.py");
writeFileSync(HOLDER, `import os, subprocess, shutil, sys, tempfile
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import raw_dumps
def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="mame_golden_")
    try:
        for n in ("out.avi", "state.raw"):
            open(os.path.join(tmp, n), "wb").write(bytes(4096))
        open(os.path.join(out, "frames.rgb"), "wb").write(bytes(4096))
        mame = subprocess.Popen(["sleep", "60"])
        open(os.path.join(os.path.dirname(os.path.abspath(out)), "grandchild.pid"), "w").write(str(mame.pid))
        print("READY", flush=True)
        return mame.wait()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
with raw_dumps.signals_to_exit():
    sys.exit(main())
`);
const CALLER = join(SCRATCH, "caller.py");
writeFileSync(CALLER, `import os, subprocess, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
from raw_dumps import raw_dumps
work = sys.argv[1]
with raw_dumps(work):
    subprocess.run([sys.executable, ${JSON.stringify(HOLDER)}, os.path.join(work, "golden")])
`);

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function holderScenario(argvFor) {
  const root = freshWork();
  const tmp = join(root, "tmp");
  const work = join(root, "work");
  mkdirSync(tmp, { recursive: true });
  const { code } = await termAfterReady(argvFor(work), { ...process.env, TMPDIR: tmp });
  const gpid = Number(readFileSync(join(work, "grandchild.pid"), "utf8"));
  return { code, tmpLeft: readdirSync(tmp), raw: raw(work), grandchildAlive: alive(gpid) };
}

test("SIGTERM to a suite while its producer holds a temp capture leaves nothing anywhere", async () => {
  const r = await holderScenario((work) => [CALLER, work]);
  assert.equal(r.code, 128 + 15);
  assert.deepEqual(r.tmpLeft, [], "the producer's temp capture dir (out.avi/state.raw) was removed");
  assert.deepEqual(r.raw, []);
  assert.equal(r.grandchildAlive, false, "the producer stopped its own child (MAME) too");
});

test("SIGTERM to the run wrapper while a driver's producer holds a temp capture leaves nothing anywhere", async () => {
  const r = await holderScenario((work) => [HELPER, "run", "--dir", work, "--", "bash", "-c",
    `python3 ${JSON.stringify(HOLDER)} ${JSON.stringify(join(work, "golden"))}; echo driver-done`]);
  assert.equal(r.code, 128 + 15);
  assert.deepEqual(r.tmpLeft, []);
  assert.deepEqual(r.raw, []);
  assert.equal(r.grandchildAlive, false);
});

test("mame_golden.py runs under signals_to_exit, so a SIGTERM reaches its temp-dir cleanup", () => {
  assert.match(readFileSync(join(TOOLS, "mame_golden.py"), "utf8"), /with raw_dumps\.signals_to_exit\(\):\n\s+sys\.exit\(main\(\)\)/);
});

// ── a sweep never reaches outside a run's own dirs ──────────────────────────────────────────────────
function seed(dir) {
  mkdirSync(join(dir, "sub"), { recursive: true });
  for (const f of ["state.bin", "frames.rgb", join("sub", "keepme.avi")]) writeFileSync(join(dir, f), "x");
}

test("sweep('') (the cwd) deletes nothing", () => {
  const cwd = freshWork();
  seed(cwd);
  const r = spawnSync("python3", [HELPER, "sweep", ""], { cwd, encoding: "utf8" });
  assert.match(r.stderr, /refusing/);
  assert.equal(raw(cwd).length, 2);
  assert.ok(existsSync(join(cwd, "sub", "keepme.avi")));
  const s = spawnSync("python3", [STUB, "", "pass"], { cwd, encoding: "utf8" });
  assert.match(s.stderr, /refusing/, "a suite given --work '' refuses to clean up the cwd");
  for (const f of ["state.bin", "frames.rgb", join("sub", "keepme.avi")]) assert.ok(existsSync(join(cwd, f)), f);
});

test("sweep and rmtree refuse $HOME, the repo root, and their ancestors; a dir below them is swept", () => {
  const root = freshWork();
  const home = join(root, "h", "home");
  const repo = join(root, "fakerepo");
  mkdirSync(join(repo, "tools"), { recursive: true });
  copyFileSync(HELPER, join(repo, "tools", "raw_dumps.py"));
  for (const d of [home, repo, join(repo, "games", "g", "out", "pixelwork")]) seed(d);
  const env = { ...process.env, HOME: home };
  const helper = join(repo, "tools", "raw_dumps.py");
  for (const d of [home, join(root, "h"), repo, root]) {
    const r = spawnSync("python3", [helper, "sweep", d], { env, encoding: "utf8" });
    assert.match(r.stderr, /refusing/, d);
    const rm = spawnSync("python3", ["-c", `import sys; sys.path.insert(0, ${JSON.stringify(join(repo, "tools"))})
from raw_dumps import raw_dumps
with raw_dumps(${JSON.stringify(d)}, rmtree=True):
    pass`], { env, encoding: "utf8" });
    assert.equal(rm.status, 0, rm.stderr);
  }
  assert.equal(raw(home).length, 2);
  assert.ok(existsSync(join(home, "sub", "keepme.avi")));
  assert.ok(existsSync(join(repo, "state.bin")) && existsSync(join(repo, "sub", "keepme.avi")));
  const below = join(repo, "games", "g", "out", "pixelwork");
  const ok = spawnSync("python3", [helper, "sweep", below], { env, encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(raw(below), [], "positive control: a work dir below the repo root IS swept");
  assert.ok(existsSync(join(repo, "state.bin")), "... without touching the repo root's own files");
});

// ── every producer-driving script goes through the helper ─────────────────────────────────────────
// A script drives a producer if a CODE line names mame_golden.py / render.js / emit.js as a string or
// passes MAME a raw -aviwrite. Excluded, with the reason: the producer itself, and the gate that only
// runs the suites (its selftest writes a stand-in render.js; it owns no dumps).
const PRODUCER_RE = /mame_golden\.py["']|["']render\.js["']|emit\.js["']|["']-aviwrite["']/;
const NOT_CALLERS = new Set(["tools/mame_golden.py", "tools/pixel_gate_required.py"]);

function producerCallers() {
  const files = execFileSync("git", ["ls-files", "games/*/tools/*.py", "tools/*.py"], { cwd: REPO, encoding: "utf8" })
    .split("\n").filter(Boolean);
  return files.filter((f) => !NOT_CALLERS.has(f) && readFileSync(join(REPO, f), "utf8").split("\n")
    .some((l) => !l.trimStart().startsWith("#") && PRODUCER_RE.test(l)));
}

test("every script that drives a producer cleans up through raw_dumps", () => {
  const callers = producerCallers();
  for (const known of ["games/timeplt/tools/pixel_suite.py", "games/dkong/tools/move_suite.py",
    "games/tempest/tools/vector_gate.py"]) {
    assert.ok(callers.includes(known), `positive control: the scan must find ${known}`);
  }
  const missing = callers.filter((f) => !/raw_dumps\(/.test(readFileSync(join(REPO, f), "utf8")));
  assert.deepEqual(missing, [], "these drive a producer without `with raw_dumps(...)` (tools/raw_dumps.py)");
});

// Per work dir, not just per file: a suite with a temp-dir path AND a --work path must guard both.
test("every temp dir is guarded where it is made, and a --work dir is swept", () => {
  const bad = [];
  for (const f of producerCallers()) {
    const lines = readFileSync(join(REPO, f), "utf8").split("\n");
    lines.forEach((l, i) => {
      if (!/mkdtemp\(|TemporaryDirectory\(/.test(l) || l.trimStart().startsWith("#")) return;
      if (!lines.slice(i, i + 3).some((x) => /raw_dumps\(/.test(x))) bad.push(`${f}:${i + 1} temp dir without raw_dumps`);
    });
    const src = lines.join("\n");
    if (src.includes('"--work"') && ![...src.matchAll(/raw_dumps\(([^)]*)\)/g)].some((m) => !m[1].includes("rmtree=True"))) {
      bad.push(`${f}: takes --work but never sweeps it`);
    }
  }
  assert.deepEqual(bad, []);
});

test("every pixel suite offers --keep-frames", () => {
  const suites = producerCallers().filter((f) => /\/(pixel|distant|move|prize)_suite\.py$|\/vector_gate\.py$/.test(f));
  assert.ok(suites.length > 0);
  const missing = suites.filter((f) => !readFileSync(join(REPO, f), "utf8").includes("--keep-frames"));
  assert.deepEqual(missing, []);
});
