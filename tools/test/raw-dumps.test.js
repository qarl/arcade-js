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
 *   - every producer-driving script uses the helper, and every pixel suite takes --keep-frames;
 *   - sweep-stale (the scheduled backstop) skips every child dir that is live: a file in its tree younger
 *     than --min-age-hours (by the later of mtime and ctime), or a process with its cwd or an open file
 *     under it, re-judged right before deleting; --below-gi, --dry-run, symlinks and refused roots.
 * Run: node --test tools/test/raw-dumps.test.js
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync, utimesSync, symlinkSync } from "node:fs";
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

// ── sweep-stale: the scheduled backstop never touches a still-running agent's work dir ─────────────
// Liveness is decided mechanically per child dir of ROOT: any file in its tree younger than
// --min-age-hours, or a process with its cwd or an open file under it. A dump between its write and its
// compare is held by nobody, so the tree's age is what protects it (the incident this guards).
const HOUR = 3600;
// ctime cannot be set back, so "old" is made by running the sweep's clock 24h ahead (RAW_DUMPS_NOW) and a
// "young" file gets a future mtime; a file written now reads as 24h old.
const NOW = Math.floor(Date.now() / 1000) + 24 * HOUR;
const CLOCK = { ...process.env, RAW_DUMPS_NOW: String(NOW) };
function aged(path, hours, body = "x") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  const t = Math.max(NOW - hours * HOUR, Date.now() / 1000);
  utimesSync(path, t, t);
  return path;
}
function sweepStale(roots, ...flags) {
  return spawnSync("python3", [HELPER, "sweep-stale", ...roots, "--min-age-hours", "3", ...flags], { env: CLOCK, encoding: "utf8" });
}
// Spawn `argv` in `cwd`, wait for its READY line (or for it to be up), run `fn`, then kill it.
async function whileRunning(argv, cwd, fn) {
  const c = spawn(argv[0], argv.slice(1), { cwd, stdio: ["ignore", "pipe", "ignore"] });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("never became READY")), 20000);
      c.stdout.on("data", (d) => { if (String(d).includes("READY")) { clearTimeout(t); resolve(); } });
      c.on("exit", () => { clearTimeout(t); reject(new Error("exited before READY")); });
    });
    return fn();
  } finally {
    c.kill("SIGKILL");
  }
}
const HOLD = ["python3", "-c", "import sys, time; f = open(sys.argv[1], 'rb') if len(sys.argv) > 1 else None; print('READY', flush=True); time.sleep(30)"];

test("sweep-stale: a child with a fresh non-dump file keeps its OLD state.bin (write..compare gap)", () => {
  const root = freshWork();
  const bin = aged(join(root, "auditor", "work", "golden", "state.bin"), 10);
  aged(join(root, "auditor", "work", "golden", "frames.json"), 0);
  const r = sweepStale([root]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(bin), r.stdout);
  assert.match(r.stdout, /LIVE .*auditor: newest entry .*frames\.json/);
});

test("sweep-stale: a child whose whole tree is old loses its old dumps, keeps everything else", () => {
  const root = freshWork();
  const dumps = ["a/golden/state.bin", "a/games/g/out/w/golden/frames.rgb", "a/x/out.avi"].map((f) => aged(join(root, f), 10));
  const keep = ["a/golden/frames.json", "a/summary.json", "a/tape.txt"].map((f) => aged(join(root, f), 10));
  const r = sweepStale([root]);
  assert.equal(r.status, 0, r.stderr);
  for (const d of dumps) assert.ok(!existsSync(d), `${d} should be gone\n${r.stdout}`);
  for (const k of keep) assert.ok(existsSync(k), k);
  assert.match(r.stdout, /removed .*state\.bin/);
});

test("sweep-stale: a child that a running process has as its cwd is kept even when all files are old", async () => {
  const root = freshWork();
  const bin = aged(join(root, "busy", "state.bin"), 10);
  const r = await whileRunning(HOLD, join(root, "busy"), () => sweepStale([root]));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(bin), r.stdout);
  assert.match(r.stdout, /LIVE .*busy: pid \d+ .*cwd/);
  const again = sweepStale([root]);
  assert.ok(!existsSync(bin), "positive control: with the process gone the same dump IS swept\n" + again.stdout);
});

test("sweep-stale: a child with an old dump held open by a process is kept", async () => {
  const root = freshWork();
  const bin = aged(join(root, "held", "deep", "frames.rgb"), 10);
  const r = await whileRunning([...HOLD, bin], SCRATCH, () => sweepStale([root]));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(bin), r.stdout);
  assert.match(r.stdout, /LIVE .*held: pid \d+ .*open on .*frames\.rgb/);
});

test("sweep-stale: files directly in ROOT go by their own age and open-file check", async () => {
  const root = freshWork();
  const old = aged(join(root, "old.rgb"), 10);
  const fresh = aged(join(root, "fresh.rgb"), 0);
  const open = aged(join(root, "state.bin"), 10);
  const r = await whileRunning([...HOLD, open], SCRATCH, () => sweepStale([root]));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(old), r.stdout);
  assert.ok(existsSync(fresh) && existsSync(open), r.stdout);
});

test("sweep-stale: --below-gi not met (more free than the threshold) deletes nothing and prints the free space", () => {
  const root = freshWork();
  const bin = aged(join(root, "a", "state.bin"), 10);
  const r = sweepStale([root], "--below-gi", "0.001");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(bin), r.stdout);
  assert.match(r.stdout, /GiB free, not below/);
  const met = sweepStale([root], "--below-gi", "1e9");
  assert.ok(!existsSync(bin), "positive control: a threshold that IS met sweeps\n" + met.stdout);
  assert.match(met.stdout, /GiB free/);
});

test("sweep-stale: a clone extracted just now with OLD mtimes (git archive | tar -x, cp -p) is live by ctime", () => {
  const root = freshWork();
  const bin = join(root, "clone", "state.bin");
  aged(bin, 0);
  const t = Date.now() / 1000 - 48 * HOUR;
  utimesSync(bin, t, t);   // mtime 48h back, as cp -p / tar -x leave it; ctime stays now
  utimesSync(join(root, "clone"), t, t);   // tar -x restores directory mtimes too
  const r = spawnSync("python3", [HELPER, "sweep-stale", root, "--min-age-hours", "3"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(bin), r.stdout);
  assert.match(r.stdout, /LIVE .*clone: newest entry/);
});

test("sweep-stale: a directory changed just now (an entry renamed or deleted in it) makes its unit live", () => {
  const root = freshWork();
  const bin = aged(join(root, "u", "golden", "state.bin"), 10);
  aged(join(root, "u", "work", "frames.json"), 10);
  utimesSync(join(root, "u", "work"), NOW, NOW);   // as a rename/delete in work/ leaves it: no file is newer
  const r = sweepStale([root]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(bin), r.stdout);
  assert.match(r.stdout, /LIVE .*u: newest entry .*u\/work is 0\.00h old/);
});

test("sweep-stale: --dry-run deletes nothing", () => {
  const root = freshWork();
  const bin = aged(join(root, "a", "state.bin"), 10);
  const loose = aged(join(root, "frames.rgb"), 10);
  const r = sweepStale([root], "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(bin) && existsSync(loose), r.stdout);
  assert.match(r.stdout, /would remove .*state\.bin/);
});

test("sweep-stale: a symlinked child dir (and a symlinked ROOT) is not followed", () => {
  const root = freshWork();
  const elsewhere = freshWork();
  const bin = aged(join(elsewhere, "target", "state.bin"), 10);
  mkdirSync(root);
  symlinkSync(join(elsewhere, "target"), join(root, "link"));
  const r = sweepStale([root]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(bin), r.stdout);
  assert.match(r.stdout, /SKIP .*link: a symlink/);
  const viaLink = sweepStale([join(root, "link")]);
  assert.notEqual(viaLink.status, 0);
  assert.match(viaLink.stderr, /refusing/);
  assert.ok(existsSync(bin));
});

test("sweep-stale refuses '', /, $HOME, the repo root, their ancestors and a non-directory", () => {
  const root = freshWork();
  const home = join(root, "h", "home");
  const repo = join(root, "fakerepo");
  mkdirSync(join(repo, "tools"), { recursive: true });
  copyFileSync(HELPER, join(repo, "tools", "raw_dumps.py"));
  const bins = [home, repo].map((d) => aged(join(d, "child", "state.bin"), 10));
  const file = aged(join(root, "plain.txt"), 10);
  const env = { ...CLOCK, HOME: home };
  const helper = join(repo, "tools", "raw_dumps.py");
  for (const d of ["", "/", home, join(root, "h"), repo, root, file]) {
    const r = spawnSync("python3", [helper, "sweep-stale", d, "--min-age-hours", "3"], { env, encoding: "utf8" });
    assert.equal(r.status, 2, `${d}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /refusing/, d);
  }
  for (const b of bins) assert.ok(existsSync(b), b);
  const below = join(repo, "scratchpad");
  const ok = aged(join(below, "clone", "state.bin"), 10);
  const r = spawnSync("python3", [helper, "sweep-stale", below, "--min-age-hours", "3"], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(ok), "positive control: a scratchpad below the repo root IS swept\n" + r.stdout);
});

test("sweep-stale: when lsof cannot run, nothing is judged unheld and nothing is deleted", () => {
  const root = freshWork();
  const bin = aged(join(root, "a", "state.bin"), 10);
  const python = execFileSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim();
  const r = spawnSync(python, [HELPER, "sweep-stale", root, "--min-age-hours", "3"],
    { env: { ...CLOCK, PATH: join(SCRATCH, "no-such-bin") }, encoding: "utf8" });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /lsof failed.*deleting nothing/);
  assert.ok(existsSync(bin));
});

// The unit is judged again right before its deletions, and each dump right before its own: a sweep that
// pauses (RAW_DUMPS_TEST_PAUSE) between a check and the deletion lets the test change the tree there.
function sweepPausedAt(stage, root, during) {
  return new Promise((resolve, reject) => {
    const c = spawn("python3", [HELPER, "sweep-stale", root, "--min-age-hours", "3"],
      { env: { ...CLOCK, RAW_DUMPS_TEST_PAUSE: stage }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "", paused = false;
    const t = setTimeout(() => { c.kill("SIGKILL"); reject(new Error("never paused: " + out + err)); }, 30000);
    c.stdout.on("data", async (d) => {
      out += d;
      if (!paused && out.includes(`PAUSED ${stage}`)) {
        paused = true;
        try { await during(); } catch (e) { reject(e); }
        c.stdin.end("\n");
      }
    });
    c.stderr.on("data", (d) => { err += d; });
    c.on("exit", (code) => { clearTimeout(t); resolve({ status: code, stdout: out, stderr: err }); });
  });
}

test("sweep-stale: a unit that turns live between the scan and its deletions is re-judged and kept", async () => {
  const root = freshWork();
  const bin = aged(join(root, "u", "golden", "state.bin"), 10);
  const r = await sweepPausedAt("scanned", root, () => aged(join(root, "u", "golden", "frames.json"), 0));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(bin), r.stdout);
  assert.match(r.stdout, /stale .*u: /, "the first pass judged it stale");
  assert.match(r.stdout, /LIVE .*u on the re-check before deleting: newest entry .*frames\.json/);
});

test("sweep-stale: a process that starts in a unit after the scan keeps it (the re-check re-runs lsof)", async () => {
  const root = freshWork();
  const bin = aged(join(root, "u", "state.bin"), 10);
  let holder;
  const r = await sweepPausedAt("scanned", root, () => new Promise((resolve, reject) => {
    holder = spawn(HOLD[0], HOLD.slice(1), { cwd: join(root, "u"), stdio: ["ignore", "pipe", "ignore"] });
    holder.stdout.on("data", (d) => { if (String(d).includes("READY")) resolve(); });
    holder.on("error", reject);
  }));
  holder.kill("SIGKILL");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(bin), r.stdout);
  assert.match(r.stdout, /LIVE .*u on the re-check before deleting: pid \d+ .*cwd/);
});

test("sweep-stale: a dump rewritten after the unit's re-check is skipped; its old sibling still goes", async () => {
  const root = freshWork();
  const bin = aged(join(root, "u", "state.bin"), 10);
  const rgb = aged(join(root, "u", "golden", "frames.rgb"), 10);
  const r = await sweepPausedAt("rechecked", root, () => { utimesSync(bin, NOW, NOW); });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(bin), r.stdout);
  assert.match(r.stdout, /skip .*state\.bin: changed since the scan/);
  assert.ok(!existsSync(rgb), "positive control: the untouched old dump in the same unit IS removed\n" + r.stdout);
});

test("sweep-stale: when lsof fails on the re-check before deleting, the unit is kept", () => {
  const root = freshWork();
  const bin = aged(join(root, "a", "state.bin"), 10);
  const shim = join(SCRATCH, `lsof-once-${n++}`);
  mkdirSync(shim, { recursive: true });
  const real = execFileSync("sh", ["-c", "command -v lsof"], { encoding: "utf8" }).trim();
  writeFileSync(join(shim, "lsof"), `#!/bin/sh\nif [ -e "${shim}/used" ]; then exit 1; fi\n: > "${shim}/used"\nexec "${real}" "$@"\n`, { mode: 0o755 });
  const r = spawnSync("python3", [HELPER, "sweep-stale", root, "--min-age-hours", "3"],
    { env: { ...CLOCK, PATH: `${shim}:${process.env.PATH}` }, encoding: "utf8" });
  assert.ok(existsSync(join(shim, "used")), "positive control: the first lsof ran\n" + r.stdout + r.stderr);
  assert.ok(existsSync(bin), r.stdout + r.stderr);
  assert.match(r.stdout, /LIVE .*a on the re-check before deleting: lsof failed on the re-check/);
});
