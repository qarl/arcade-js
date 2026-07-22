# 5. The pixel gate

The final arbiter is the picture: does our frame look like MAME's frame? But "look like" needs a
precise definition, and there are two, used in different places.

## Byte-exact, where it must be

For deterministic stretches — the boot sequence, and any window where the two machines must agree
to the pixel — `tools/framediff.py` compares **byte for byte**. It applies a frozen frame offset
(the AVI lags the state by one frame; the offset is pinned, never auto-calibrated, because a
free offset can manufacture a green result over identical boot frames), compares raw bytes rather
than trusting any stored hash, and requires completeness in both directions (a short run can report
`PARTIAL` but never `PASS`). On the first divergence it reports the pixel count, the bounding box,
the tiles touched, and names likely whole-frame modes (a red/blue swap, a vertical flip, a row
shift) so the failing routine is easy to find.

## Rough tolerance, where reality is jittery

Requiring byte-exact equality *everywhere* is wrong. A single sprite one frame early — an artefact
of sub-frame timing that no player could see — would fail an otherwise-perfect translation. But
*unbounded* divergence (the screens drifting further and further apart) is always a real bug. The
rough gate distinguishes them:

> A frame may differ from MAME by a few pixels and still pass, **as long as the pixels don't
> diverge arbitrarily.** Concretely (`games/dkong/tools/move_suite.py`): PASS iff the maximum per-frame
> difference stays **under 5%** of the frame **and no single frame exceeds ~5%**.

The key word is *reconverge*. A translation that's right will differ from MAME only in brief,
bounded transients and then snap back to identical; a translation that's wrong will diverge and
stay diverged. The percent-of-frame threshold accepts the former and rejects the latter. (In
practice the bar is met with enormous margin — e.g. Donkey Kong's attract sequence runs
byte-identical to MAME on 727 of 728 frames, with a single 3-pixel, 0.005% transient.)

`games/dkong/tools/prize_suite.py` runs the same rough gate over the bonus-item pickups — Pauline's dropped
parasol/hat/purse, worth level-scaled points — across the boards that carry them (50m/75m/100m).
It applies the identical rule (max per-frame difference under 5%, no single frame over ~5%, from
frame ~1600) plus a pickup assertion the movement gate doesn't need: the prize slot at RAM
`0x6A0C` clears (its X byte drops to 0) and the BCD score at `0x60B2` grows by the level's point
value. Nine scenarios — `{50m,75m,100m} × {hat,parasol,purse}` — each with its own committed tape
in `games/dkong/tapes/`.

## The discipline around the gate

Three rules keep the gate honest, each learned the hard way:

- **Never lower the floor.** If a frame fails, fix the engine — don't widen the tolerance to make
  it pass. The threshold is a property of the hardware's jitter, not a knob to reach green.
- **Calibrate once.** Constants like the frame offset are pinned and committed; re-deriving them
  per-run lets a bug hide inside a "recalibration".
- **Instrument for falsifiability.** A check that cannot fail proves nothing. Prefer diffs that
  would catch a planted error (that's what mutation testing verifies for the unit tests, and what
  the both-directions and no-auto-offset rules verify for the pixel gate).
