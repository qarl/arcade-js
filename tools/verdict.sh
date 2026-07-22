#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# One-command verdict: diff the translated JS against MAME golden.
#
# Runs state-diff FIRST, then pixel-diff, because that ordering is what makes a
# failure interpretable:
#   * state fails            -> the CPU translation is wrong; the renderer is irrelevant
#   * state passes, pixels fail -> the translation is right; the bug is in the video model
# Running pixels first would conflate those and can cost hours debugging a
# renderer when the real bug was a mistranslated ADD.
#
# Usage:
#   ./verdict.sh out/emit                 # diff against golden/boot
#   ./verdict.sh out/emit golden/jump     # diff against a specific golden set
#
# Exit: 0 all pass | 1 a diff failed | 3 incomplete (PARTIAL -- never a pass)

# No `set -e`: both diffs must run and have their codes collected, which -e would
# abort on the first non-zero. The cd is checked explicitly instead.
set -uo pipefail
cd "$(dirname "$0")" || { echo "cannot cd to script dir" >&2; exit 2; }

ACTUAL="${1:-}"
GOLDEN="${2:-golden/boot}"

if [ -z "$ACTUAL" ]; then
  echo "usage: $0 <js-output-dir> [golden-dir]" >&2
  exit 2
fi

if [ ! -d "$GOLDEN" ]; then
  echo "no golden at '$GOLDEN'. Capture it first (docs/04-integration-testing.md):" >&2
  echo "  tools/mame_golden.py --out $GOLDEN --seconds 12" >&2
  exit 2
fi

rc_state=0
rc_frames=0
rc_writes=0
# Count what ACTUALLY ran. Without this, a missing/empty output dir skips both
# diffs, nothing sets a failure code, and the script reports PASS -- the exact
# false-green class the differs themselves were hardened against. Caught by this
# script's own smoke test, which is the argument for having one.
ran=0
ran_state=0
ran_frames=0
ran_writes=0
gate_unavailable=0

echo "=============================================================="
echo " STATE DIFF   golden=$GOLDEN  actual=$ACTUAL"
echo "=============================================================="
if [ -f "$ACTUAL/state.bin" ]; then
  python3 tools/statediff.py --golden "$GOLDEN" --actual "$ACTUAL"
  rc_state=$?
  ran=$((ran + 1)); ran_state=1
else
  echo "  (skipped: no state.bin in $ACTUAL)"
fi

echo
echo "=============================================================="
echo " WRITE DIFF   golden=$GOLDEN  actual=$ACTUAL"
echo "=============================================================="
if [ -f "$ACTUAL/writes.txt" ]; then
  if [ -f "$GOLDEN/writes.txt" ]; then
    python3 tools/writediff.py --golden "$GOLDEN" --actual "$ACTUAL"
    rc_writes=$?
    ran=$((ran + 1)); ran_writes=1
  else
    # NOT a silent skip: the JS emitted writes we have no reference for, so this
    # gate could not run. An unavailable gate must not read as a passed one.
    echo "  *** GATE UNAVAILABLE: $ACTUAL/writes.txt exists but $GOLDEN/writes.txt"
    echo "      does not. The write trace was NOT verified. Capture a reference:"
    echo "        tools/mame_golden.py --out $GOLDEN --seconds N --no-frames --writes"
    gate_unavailable=1
  fi
else
  echo "  (skipped: no writes.txt in $ACTUAL)"
fi

echo
echo "=============================================================="
echo " PIXEL DIFF   golden=$GOLDEN  actual=$ACTUAL"
echo "=============================================================="
if [ -f "$ACTUAL/frames.rgb" ]; then
  python3 tools/framediff.py --golden "$GOLDEN" --actual "$ACTUAL" --report diffout
  rc_frames=$?
  ran=$((ran + 1)); ran_frames=1
else
  echo "  (skipped: no frames.rgb in $ACTUAL -- expected until the renderer exists)"
fi

echo
echo "=============================================================="
# A failure anywhere dominates; PARTIAL dominates a pass. PARTIAL is never
# reported as green -- an incomplete comparison is inconclusive, not a pass.
if [ "$ran" -eq 0 ]; then
  echo " VERDICT: NOTHING COMPARED -- no state.bin and no frames.rgb in '$ACTUAL'."
  echo "          This is NOT a pass. Nothing was verified."
  exit 2
fi

# WHITELIST the codes we understand before interpreting them. Blacklisting only
# the failure codes means any UNANTICIPATED code -- 137 SIGKILL (the OOM killer,
# a live risk since frames.rgb is ~125MB and framediff builds numpy arrays over
# it), 139 SIGSEGV, 143 SIGTERM from a CI timeout, 127 python3 missing -- falls
# through to PASS. A differ that was killed before comparing a single byte would
# then produce a green gate. `ran` proves a differ was INVOKED; it does not prove
# one REACHED A VERDICT. Fail closed on anything unrecognized.
for rc in "$rc_state" "$rc_frames" "$rc_writes"; do
  case "$rc" in
    0 | 1 | 2 | 3) ;;
    *)
      echo " VERDICT: HARNESS ERROR -- a differ exited $rc (crashed, killed, or"
      echo "          python3 missing). This is NOT a pass. Nothing was verified."
      exit 4
      ;;
  esac
done

if [ "$rc_state" = 1 ] || [ "$rc_frames" = 1 ] || [ "$rc_writes" = 1 ]; then
  echo " VERDICT: FAIL"
  exit 1
elif [ "$gate_unavailable" -eq 1 ]; then
  echo " VERDICT: PARTIAL -- a gate could not run (no golden write trace)."
  echo "          What ran passed, but the write trace is UNVERIFIED, not verified."
  exit 3
elif [ "$rc_state" = 3 ] || [ "$rc_frames" = 3 ] || [ "$rc_writes" = 3 ]; then
  # Checked before rc==2 so an incomplete comparison keeps its more informative
  # signal rather than being downgraded to "nothing to compare".
  echo " VERDICT: PARTIAL -- incomplete coverage, NOT a pass"
  exit 3
elif [ "$rc_state" = 2 ] || [ "$rc_frames" = 2 ] || [ "$rc_writes" = 2 ]; then
  echo " VERDICT: nothing to compare"
  exit 2
else
  # Name the gates that actually RAN. A bare "PASS" invites the reader to assume
  # everything was checked -- scope applied to the wrapper, not just the differs.
  gates=""
  [ "$ran_state" -eq 1 ] && gates="${gates}state "
  [ "$ran_writes" -eq 1 ] && gates="${gates}writes "
  [ "$ran_frames" -eq 1 ] && gates="${gates}pixels "
  missing=""
  [ "$ran_state" -eq 0 ] && missing="${missing}state "
  [ "$ran_writes" -eq 0 ] && missing="${missing}writes "
  [ "$ran_frames" -eq 0 ] && missing="${missing}pixels "

  if [ "$ran_state" -eq 0 ]; then
    # A pass without the state gate is the case the state-first ordering warns
    # against mistaking for a verified translation.
    echo " VERDICT: PASS (gates run: ${gates}) -- but the STATE diff never ran,"
    echo "          so the CPU translation is UNVERIFIED. Emit state.bin."
  else
    echo " VERDICT: PASS (gates run: ${gates})"
    [ -n "$missing" ] && echo "          NOT run: ${missing}-- unverified, not verified."
  fi
  exit 0
fi
