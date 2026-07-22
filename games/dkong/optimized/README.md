# games/dkong/optimized/ — idiomatic-JS rewrites (room for future work)

The translation in `../translated/` is deliberately close to the original Z80 assembly:
each routine mirrors the instruction sequence, T-state charges and all. That faithfulness is
what makes it validate against MAME — but it is not idiomatic JavaScript.

This directory is where individual routines get **rewritten as ordinary, higher-level
JavaScript** — same behavior, clearer code, faster. The rule that makes this safe:

> An optimized routine may replace its `translated/` counterpart **only after it passes the
> same gates that prove equivalence** — the unit suite, the mutation gate, and the pixel
> gate against MAME. Equivalence is proven, never assumed.

The manifest selects, per routine, whether the machine dispatches into `translated/` or
`optimized/`, so the two can coexist and the optimized set can grow one proven routine at a
time.

Nothing here yet — this is the seam, reserved now so the optimization project has a home when
it starts.
