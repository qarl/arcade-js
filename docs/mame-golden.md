# mame_golden.py — rationale

`tools/mame_golden.py` captures golden reference frames and state dumps from MAME, the ground-truth
side of the arcade-js validation harness. The tool keeps terse pointers in the source; the
derivations and war stories live here so the source stays under the comment_gate density cap.

## Determinism (proven — see docs/integration-testing.md)

Two independent runs under this command line produce BYTE-IDENTICAL AVI output. The controls that
matter:

- a fresh, empty `-nvram_directory` per run (DK writes high scores)
- `-nonvram_save`, `-noautosave`, `-nocheat`
- `-frameskip 0`, `-nothrottle`
- `-video none` (headless; proven byte-identical to `-video soft`)

## MAME command-line gotchas

Every flag in `build_mame_argv` is load-bearing. Gotchas encoded there so nobody rediscovers them:

- MAME boolean options take the `-noX` form. `-nocheat 0` is a parse error.
- `-aviwrite` appends `.avi` itself, so pass `out`, not `out.avi`.
- `-aviwrite`'s path is relative to `-snapshot_directory`.
- `-norotate` — the frame contract compares unrotated WxH.
- A Lua script is ALWAYS installed: it certifies the machine configuration (DSW0). Skipping it on
  some paths certified those captures green with DSW0 unverified.

### ffmpeg extract (`extract_frames`)

- MAME's AVI is **bgr24**. Dumping it raw silently swaps R and B, which looks like a palette bug.
  `-pix_fmt rgb24` is what prevents that.
- `-map 0:v:0` is required: MAME writes an AUDIO stream into the AVI even under `-sound none`, and
  unfiltered ffmpeg output interleaves both streams.
- `-fps_mode passthrough`: no frame duplication/drop; 1:1 with emulated frames.

## DSW0 / cfg-directory hazard

Same hazard class as NVRAM, and proven not theoretical: MAME persists DIPSWITCH changes to
`cfg/<game>.cfg` and defaults `cfg_directory` to `cfg` relative to cwd. A stray cfg silently changes
what the golden ran with, and the value never appears in the capture. Mitigation: a fresh empty
`-cfg_directory` per run, plus certifying DSW0 from a Lua config probe on every non-`--writes`
capture.

## Z80 reset-state certification

The CPU reset state is an input to everything the ROM computes, exactly like DSW0. Only IX/IY are
ever observable, because the ROM overwrites every other register before the first NMI — so a drifted
AF or SP would be invisible in the data and wrong wherever it eventually mattered. The config probe
reads the reset registers and pins them against `scope.Z80_RESET_STATE`.

## Poison philosophy

A capture we have ourselves identified as suspect must HARD-FAIL (exit 1), not warn and exit 0.
Quietly wrong reference data is worse than no reference data, and in a `mame_golden.py &&
framediff.py` pipeline a warning flows straight through to the consumer. Every invariant appends to
`poison`; any non-empty `poison` refuses certification. Corollaries applied throughout: an EMPTY
write trace verifies nothing, a never-reached `--at-pc` PC is a poison, and an unverified
configuration is not a verified one.

## Frame-count formula: `avi_frame_count = floor(refresh*seconds) + 2`

The obvious formula is wrong. MAME appends one AVI frame per video update at t = 0, T, 2T, … and
exits at the FIRST update at or after t = seconds — and that frame is still recorded. So the last
frame lands PAST t = seconds, not on it, and the count is `ceil(seconds/T) + 1`.

The step to `floor(hz*sec)+2` is the part worth writing down. T is the frame period in whole
attoseconds, and on every board here it lands strictly BELOW the ideal period, so seconds/T sits a
shade above hz*sec and off an exact integer. That makes `ceil(seconds/T)` equal `floor(hz*sec)+1`
for a fractional AND a whole-number product alike — hence the uniform +2.

SCOPED DELIBERATELY: "below the ideal period" is a property of these boards, not a law. A board
whose period divides 1e18 evenly — a plain 50Hz `set_refresh_hz` would — puts seconds/T exactly on
an integer and costs this formula one frame. **Re-measure T before trusting the +2 on a fourth
board.**

NOT `ceil(hz*sec)+1`: that is short by one whenever hz*sec is a whole number, which a 60.000000Hz
board hits at every integer duration. It agrees for a fractional product. A capture that misses the
formula was truncated or mis-run, and is the exact input that makes a short-run false PASS possible
downstream.

### State dump: same +2, and where the check must live

The +2 is one power-on sample taken at Lua script load (before any instruction runs) plus the
`floor(hz*sec)+1` samples the frame notifier supplies. That power-on sample is what makes state[N]
mean "after N frames" rather than "after N+1". The check must NOT live under `if not
args.no_frames` — a state-only capture would then have no length validation, and the Lua dumper's
documented failure mode (GC-unsubscribe → exactly one frame, plausible-looking truncated file) would
sail through certified. A PC-triggered `--at-pc` capture is one sample by design, so this invariant
does not apply to it.

### AVI/state delta is 0, not 1

AVI frame 0 is the machine-init framebuffer and state[0] is the power-on sample — the SAME instant —
so the two clocks are aligned.

## Tape parameters travel WITH the golden, not only with the tape

A Lua tape reads its timings from the environment so they can be SWEPT without editing the contract.
That means a golden captured from one is uninterpretable without the values it was captured under —
"coin at frame 10" is a property of THIS ARTIFACT, and env defaults are exactly the kind of thing
that drifts silently. So the manifest records `tape`, `tape_sha256`, and every `TAPE_*` env var. This
is the same argument that refused to re-time a tape rather than add a second one, applied to the
artifact instead of the source.

## Raw dumps are deleted once the verdict is in

`frames.rgb` and `state.bin` are multi-GB for a long capture, and nothing reads them after the verdict.
Every script that drives this tool (or `render.js`/`emit.js`, or a raw `-aviwrite`) wraps its work in
`tools/raw_dumps.py`'s `raw_dumps(...)`, which deletes them on PASS, FAIL, an exception, Ctrl-C and
SIGTERM/SIGHUP, keeping the small artifacts; `--keep-frames` opts out. On a signal it first SIGTERMs its
child processes and waits for them, and this tool runs under `signals_to_exit()`, so a capture in flight
stops MAME and removes its own temp dir (`out.avi`, `state.raw` under `$TMPDIR/mame_golden_*`) before the
caller sweeps. A sweep refuses an empty path, `/`, `$HOME`, the repo root and their ancestors.

An ad-hoc driver wraps itself: `python3 tools/raw_dumps.py run --dir <out> [--dir <out2>] -- <command>`
runs the command in its own process group, forwards signals to the whole group, sweeps every `--dir`
once the group is gone, and returns the command's exit code. The producer does not delete its own output:
a verdict needs two producers' dumps at once, so cleanup belongs to whoever runs the comparison.

Still able to strand dumps: a SIGKILL of the caller (nothing runs), a child that ignores SIGTERM past the
`STOP_GRACE` (it is then SIGKILLed, skipping its own cleanup), and a producer run by hand outside both. The
scheduled disk sweep is the backstop. `tools/test/raw-dumps.test.js` holds every producer-driving script
to this.
