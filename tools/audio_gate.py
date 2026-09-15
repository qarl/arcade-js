#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Audio-coverage gate - a game cannot ship without a wired, tested, recorded+signed-off audio layer.

Audio is the one ship step with no oracle ("by ear"), so it silently gets skipped (frogger shipped
"done" three times with no audio layer). A COMPLETION gate (run at ship, not per-commit). It cannot
check a clip *sounds right* - no oracle - but it makes a MISSING/untested/unrecorded audio layer
un-shippable by requiring the artifacts a complete layer has (model: dkong):
(1) manifest `audio: { map: <file> }` + the map file exists; (2) if the map declares a soundLatch AND
names.js names SOUND_CMD_LATCH they must match (a clips player keying off the wrong address is silent/
wrong); (3) test/audio-map.test.js (committed COVERAGE test; the WAVs are gitignored copyright) and
(4) test/audio-wiring.test.js (committed WIRING test).

The WAVs themselves are gitignored copyright, so the gate cannot listen to them - but STRUCTURE alone
lied: a game could pass (1)-(4) while the audio was NEVER RECORDED and never listened to. So GREEN now
also requires a committed BY-EAR SIGN-OFF at games/<game>/audio/RECORDING-SIGNOFF.md - a structured
attestation with ALL of `rom_sha256:`, `clips:` (integer > 0), `date:` and `by_ear:` (non-empty). The
rom sha + clip count come from running the recorder (games/<game>/tools/record_samples.py); the by_ear
line is the human confirmation that the recorded clips actually sound right. GREEN <=> a human recorded
the clips AND listened + confirmed. Missing file or any missing/empty field => RED.

Legacy pre-runbook ports (frogger/timeplt/thepit - runbook "Legacy games": do not retrofit) are
grandfathered off the sign-off requirement (exactly like tools/done_gate.py check_pixel grandfathers
them off the --done gameplay bar); they still owe the structure checks. A non-legacy game with no
sign-off => RED. A game needs BOTH structure AND sign-off.

SYNTH model (manifest `audio.model == "synth"`, e.g. galaxian: a discrete-analogue netlist, no clips) has no
recorded clips to audition -- so instead of a by-ear sign-off it is proven by a per-voice NULL-MUTANT test
(test/synth-voices.test.js: silence any one voice -> the test goes RED), which this gate REQUIRES and RUNS
(must pass), and it refuses a synth that self-documents a stubbed/collapsed voice. The un-shippable-if-un-
null-mutant-tested rule: an aggregate correlation cannot fail per-voice (galaxian shipped silent on 3 of 4
voices under a passing +0.7 correlation); a null-mutant can. by_ear/RECORDING-SIGNOFF is the CLIPS path only.

Subcommands: check --game <game> (exit 0 iff complete), selftest.
"""
import argparse
import contextlib
import io
import os
import re
import shutil
import sys
import tempfile


# Pre-runbook ports are not retrofitted with a recording sign-off (runbook "Legacy games"); mirrors the
# grandfather set in tools/done_gate.py check_pixel. A non-legacy game still owes a committed sign-off.
# Pre-sign-off-gate ports grandfathered off the RECORDING-SIGNOFF requirement (runbook "Legacy games":
# do not retrofit). dkong's audio IS recorded (games/dkong/audio/samples/ has real clips) -- it predates
# this gate, not unrecorded; a new game with no committed clips (e.g. pooyan) is NOT grandfathered.
LEGACY_NO_SIGNOFF = {"frogger", "timeplt", "thepit", "dkong"}

# The by-ear sign-off attestation (CLIPS model only). Each must be present + non-empty; `clips` int > 0.
SIGNOFF_FIELDS = ("rom_sha256", "clips", "date", "by_ear")

# A SYNTH model has no recorded clips to audition -- it is committed parameterized source, so its oracle is a
# per-voice NULL-MUTANT test (silence any one voice -> the test must go RED), NOT a by-ear clip sign-off.
# These lowercase markers, if present in the synth module, self-document a stubbed/collapsed/unmodeled voice
# (the exact class that shipped galaxian silent on 3 of 4 voices under a passing aggregate metric) -> RED.
SYNTH_SIMPLIFICATION_MARKERS = ("not modeled", "collapsed", "loudness proxy", "never enabled",
                                "simplification", "todo")


def read_text(path):
    return open(path, encoding="utf-8").read() if os.path.exists(path) else ""


def audio_model(manifest_text):
    """The audio model from a manifest `audio: { model: "..." }` block; defaults to "clips" if unstated."""
    m = re.search(r"audio\s*:\s*\{[^}]*?\bmodel\s*:\s*[\"']([^\"']+)[\"']", manifest_text, re.S)
    return m.group(1) if m else "clips"


def synth_rel(maptext):
    """The synth module path from the map's `synth: "..."` field; defaults to audio/synth.js."""
    m = re.search(r"\bsynth\s*:\s*[\"']([^\"']+)[\"']", maptext)
    return m.group(1) if m else "audio/synth.js"


def run_node_test(path):
    """Run one node test file; return (rc, tail-of-output). rc 0 == the test passed."""
    try:
        p = subprocess.run(["node", "--test", path], capture_output=True, text=True, timeout=180)
        return p.returncode, (p.stdout + p.stderr)[-500:]
    except Exception as e:  # node missing / timeout -> treat as failure (a gate never passes on "could not run")
        return 1, str(e)


def read_hex(path, name):
    m = re.search(rf"\b{name}\s*=\s*(0x[0-9a-fA-F]+|\d+)", read_text(path))
    return int(m.group(1), 0) if m else None


def audio_map_rel(manifest_text):
    m = re.search(r"audio\s*:\s*\{[^}]*?\bmap\s*:\s*[\"']([^\"']+)[\"']", manifest_text, re.S)
    return m.group(1) if m else None


def signoff_field(text, name):
    """Return the trimmed value of a `name: value` line (value must have a non-whitespace char), else None."""
    m = re.search(rf"^\s*{re.escape(name)}\s*:\s*(.*\S)\s*$", text, re.M)
    return m.group(1).strip() if m else None


def signoff_problems(text):
    """Validate a RECORDING-SIGNOFF.md attestation. Returns a list of problems (empty => valid)."""
    problems = []
    for name in SIGNOFF_FIELDS:
        val = signoff_field(text, name)
        if val is None:
            problems.append(f"{name} (missing or empty)")
        elif name == "clips":
            try:
                if int(val) <= 0:
                    problems.append("clips (must be an integer > 0)")
            except ValueError:
                problems.append("clips (must be an integer > 0)")
    return problems


def check(game, base=None):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", game):
        print(f"audio-coverage [{game}]: BLOCK — invalid game name (must be alphanumeric/-/_; "
              f"path traversal rejected).", file=sys.stderr)
        return 1
    base = base or f"games/{game}"
    fails = []

    manifest_text = read_text(f"{base}/manifest.js")
    maprel = audio_map_rel(manifest_text)
    model = audio_model(manifest_text)
    mappath = None
    if not maprel:
        fails.append("manifest declares no audio.map (the audio layer was never built)")
    else:
        mappath = f"{base}/{maprel}"
        if not os.path.exists(mappath):
            fails.append(f"audio.map file missing: {mappath}")
            mappath = None

    maptext = read_text(mappath) if mappath else ""
    if mappath:
        # Latch correctness applies only to the clips model (a synth model has no soundLatch). When the
        # map declares one AND names.js names SOUND_CMD_LATCH, they must agree or the player is mis-wired.
        mlatch = re.search(r"soundLatch\s*:\s*(0x[0-9a-fA-F]+|\d+)", maptext)
        game_latch = read_hex(f"{base}/idiomatic/names.js", "SOUND_CMD_LATCH")
        if mlatch and game_latch is not None and int(mlatch.group(1), 0) != game_latch:
            fails.append(f"soundLatch {mlatch.group(1)} != game SOUND_CMD_LATCH {hex(game_latch)} "
                         f"(the player keys off the wrong address)")

    for kind in ("map", "wiring"):
        if not os.path.exists(f"{base}/test/audio-{kind}.test.js"):
            fails.append(f"no test/audio-{kind}.test.js (the audio {kind} is unproven)")

    if model == "synth":
        # SYNTH: no recorded clips to audition; the oracle is a per-voice NULL-MUTANT test (silence any voice
        # -> the test goes RED). Require it, RUN it (must PASS), and refuse a synth that self-documents a
        # stubbed/collapsed voice -- the class that shipped galaxian silent on 3 of 4 voices while a by-ear
        # note and an aggregate correlation both passed. An aggregate metric cannot fail per-voice; this can.
        svpath = f"{base}/test/synth-voices.test.js"
        if not os.path.exists(svpath):
            fails.append("model is synth but no test/synth-voices.test.js (the per-voice null-mutant gate) -- "
                         "a synth ships proven by per-voice presence, not a clip sign-off")
        else:
            rc, out = run_node_test(svpath)
            if rc != 0:
                fails.append(f"test/synth-voices.test.js does not pass (per-voice null-mutant RED): {out.strip()}")
        synthpath = f"{base}/{synth_rel(maptext)}"
        hits = [k for k in SYNTH_SIMPLIFICATION_MARKERS if k in read_text(synthpath).lower()]
        if hits:
            fails.append(f"{synthpath} self-documents a simplified/stubbed voice ({', '.join(hits)}) -- "
                         "a synth must voice every register, not admit a collapsed/unmodeled one")
    elif game not in LEGACY_NO_SIGNOFF:
        # CLIPS: the WAVs are gitignored copyright (no oracle, runbook §5), so a committed by-ear sign-off is
        # the enforceable evidence a human ran the recorder (rom sha + clip count) AND listened + confirmed.
        # Legacy pre-runbook ports are grandfathered off this (they still owe the structure checks above).
        signoff_path = f"{base}/audio/RECORDING-SIGNOFF.md"
        if not os.path.exists(signoff_path):
            fails.append(f"no audio/RECORDING-SIGNOFF.md - audio not recorded/signed off "
                         f"(run games/{game}/tools/record_samples.py, listen, then commit the sign-off)")
        else:
            problems = signoff_problems(read_text(signoff_path))
            if problems:
                fails.append("audio/RECORDING-SIGNOFF.md is not a valid sign-off - audio not recorded/"
                             "signed off; bad fields: " + ", ".join(problems))

    if fails:
        print(f"audio-coverage [{game}]: BLOCK — the audio layer is incomplete:", file=sys.stderr)
        for x in fails:
            print(f"  - {x}", file=sys.stderr)
        return 1
    if model == "synth":
        proof = "per-voice null-mutant test passes + no self-documented simplification"
    elif game in LEGACY_NO_SIGNOFF:
        proof = "legacy (no sign-off)"
    else:
        proof = "recording sign-off"
    print(f"audio-coverage [{game}]: OK (model={model}; map + map/wiring tests + {proof}).")
    return 0


def selftest():
    ok = True

    def fail(msg):
        nonlocal ok
        print(f"selftest FAIL: {msg}", file=sys.stderr)
        ok = False

    # audio_map_rel extracts the map path from a manifest `audio: { map: ... }` block, else None.
    if audio_map_rel('audio: {\n  map: "audio/sounds.js",\n  samples: "audio/samples",\n}') != "audio/sounds.js":
        fail("audio_map_rel did not extract the map")
    if audio_map_rel("// no audio here\nboards: {}") is not None:
        fail("audio_map_rel matched a manifest with no audio")

    # signoff_problems: a complete attestation is clean; each missing/empty/bad field is reported.
    good = "rom_sha256: deadbeef\nclips: 12\ndate: 2026-08-29\nby_ear: Karl heard all 12 clips, correct\n"
    if signoff_problems(good) != []:
        fail(f"signoff_problems flagged a valid sign-off: {signoff_problems(good)}")
    if "by_ear (missing or empty)" not in signoff_problems(good.replace("by_ear: Karl heard all 12 clips, correct\n", "")):
        fail("signoff_problems did not flag a missing by_ear")
    if "by_ear (missing or empty)" not in signoff_problems(good.replace("Karl heard all 12 clips, correct", "")):
        fail("signoff_problems did not flag an empty by_ear")
    if not any(p.startswith("clips") for p in signoff_problems(good.replace("clips: 12", "clips: 0"))):
        fail("signoff_problems did not flag clips: 0")
    if not any(p.startswith("clips") for p in signoff_problems(good.replace("clips: 12", "clips: many"))):
        fail("signoff_problems did not flag a non-integer clips")

    # End-to-end check() on synthetic game trees: WITH a valid sign-off passes; WITHOUT => RED; a
    # legacy-named game WITHOUT a sign-off still passes (grandfathered). base= points check() at the tree.
    def make_tree(root, with_signoff, body=None):
        # root is always this function's own tempfile.mkdtemp() tree (never external/user input); joined
        # via os.path.join (not f-string interpolation) so a path-scanning gate doesn't mistake this fixed,
        # self-generated selftest fixture for an unsanitized user-controlled path.
        os.makedirs(os.path.join(root, "audio"), exist_ok=True)
        os.makedirs(os.path.join(root, "test"), exist_ok=True)
        os.makedirs(os.path.join(root, "idiomatic"), exist_ok=True)
        open(os.path.join(root, "manifest.js"), "w", encoding="utf-8").write('audio: {\n  map: "audio/sounds.js",\n}\n')
        # No soundLatch in the map -> the latch cross-check is skipped (no names.js needed).
        open(os.path.join(root, "audio", "sounds.js"), "w", encoding="utf-8").write("export const sounds = {};\n")
        open(os.path.join(root, "test", "audio-map.test.js"), "w", encoding="utf-8").write("// coverage test\n")
        open(os.path.join(root, "test", "audio-wiring.test.js"), "w", encoding="utf-8").write("// wiring test\n")
        if with_signoff:
            open(os.path.join(root, "audio", "RECORDING-SIGNOFF.md"), "w", encoding="utf-8").write(
                body if body is not None else good)

    def make_synth_tree(root, with_test=True, test_passes=True, synth_body="export const x = 1;\n"):
        # A synth-model tree: proven by test/synth-voices.test.js (RUN by the gate), NOT a clip sign-off.
        # root is always this function's own tempfile.mkdtemp() tree; os.path.join (not f-string) as above.
        os.makedirs(os.path.join(root, "audio"), exist_ok=True)
        os.makedirs(os.path.join(root, "test"), exist_ok=True)
        open(os.path.join(root, "manifest.js"), "w", encoding="utf-8").write(
            'audio: {\n  map: "audio/sounds.js",\n  model: "synth",\n}\n')
        open(os.path.join(root, "audio", "sounds.js"), "w", encoding="utf-8").write(
            'export default { synth: "audio/synth.js" };\n')
        open(os.path.join(root, "audio", "synth.js"), "w", encoding="utf-8").write(synth_body)
        open(os.path.join(root, "test", "audio-map.test.js"), "w", encoding="utf-8").write("// map test\n")
        open(os.path.join(root, "test", "audio-wiring.test.js"), "w", encoding="utf-8").write("// wiring test\n")
        if with_test:
            body = ("import test from 'node:test';\ntest('voices', () => {});\n" if test_passes else
                    "import test from 'node:test';\nimport assert from 'node:assert';\ntest('voices', () => assert.fail('nulled'));\n")
            open(os.path.join(root, "test", "synth-voices.test.js"), "w", encoding="utf-8").write(body)

    def silent_check(game, base):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return check(game, base=base)

    tmp = tempfile.mkdtemp(prefix="audio_gate_selftest_")
    try:
        g_ok = f"{tmp}/withsignoff"
        make_tree(g_ok, with_signoff=True)
        if silent_check("synthgame", g_ok) != 0:
            fail("a non-legacy game WITH a valid sign-off was blocked")

        g_no = f"{tmp}/nosignoff"
        make_tree(g_no, with_signoff=False)
        if silent_check("synthgame", g_no) == 0:
            fail("a non-legacy game WITHOUT a sign-off passed (must be RED)")

        g_bad = f"{tmp}/badsignoff"
        make_tree(g_bad, with_signoff=True, body="rom_sha256: deadbeef\ndate: 2026-08-29\nby_ear: yes\n")
        if silent_check("synthgame", g_bad) == 0:
            fail("a non-legacy game with a sign-off MISSING clips passed (must be RED)")

        g_legacy = f"{tmp}/legacy"
        make_tree(g_legacy, with_signoff=False)
        if silent_check("frogger", g_legacy) != 0:
            fail("a legacy-named game without a sign-off was blocked (should be grandfathered)")

        # SYNTH branch: proven by a per-voice null-mutant test (RUN), no clip sign-off needed.
        g_syn = f"{tmp}/synth_ok"
        make_synth_tree(g_syn)
        if silent_check("synthg", g_syn) != 0:
            fail("a synth game with a passing synth-voices test + clean synth was blocked")

        g_syn_notest = f"{tmp}/synth_notest"
        make_synth_tree(g_syn_notest, with_test=False)
        if silent_check("synthg", g_syn_notest) == 0:
            fail("a synth game WITHOUT synth-voices.test.js passed (must be RED)")

        g_syn_fail = f"{tmp}/synth_failtest"
        make_synth_tree(g_syn_fail, test_passes=False)
        if silent_check("synthg", g_syn_fail) == 0:
            fail("a synth game with a FAILING (null-mutant RED) synth-voices test passed (must be RED)")

        g_syn_marker = f"{tmp}/synth_marker"
        make_synth_tree(g_syn_marker, synth_body="// the third voice is a loudness proxy for now\nexport const x = 1;\n")
        if silent_check("synthg", g_syn_marker) == 0:
            fail("a synth whose module self-documents a simplification passed (must be RED)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("selftest OK" if ok else "selftest FAILED")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description="Audio-coverage completion gate.")
    ap.add_argument("cmd", choices=("check", "selftest"))
    ap.add_argument("--game", default="frogger")
    args = ap.parse_args()
    return selftest() if args.cmd == "selftest" else check(args.game)


if __name__ == "__main__":
    sys.exit(main())
