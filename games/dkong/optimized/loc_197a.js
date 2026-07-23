// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_197a — hand-optimized rewrite of the translated routine at ROM 0x197A,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (~24 of them) is reached through `m.call`, the
 * routine registry (games/dkong/routines.js), so each resolves to the oracle or to
 * a future optimized rewrite — none is imported. Only the RAM name MARIO_ACTIVE is
 * imported (from ram.js); 0x6082 has no evidenced name and stays hex.
 */

import { MARIO_ACTIVE } from "./ram.js";

/**
 * loc_197a -- THE per-frame in-game update cascade.
 * [ROM 0x197A-0x19D1, then falls through into tail_19d2 @ 0x19D2]
 *
 * WHAT IT DOES. This is the shared per-frame "run one frame of the game" cascade:
 * a straight run of ~24 `call`s that tick every in-game subsystem in order --
 * animation counters, the player/movement engine (0x1AC3 = entry_1ac3), enemy and
 * object updates (0x1F72, 0x30ED, ...), collision/scoring, sprite emit, etc. It is
 * reached two ways, which share this ONE tail:
 *   - its own task-table entry (dw 0x197a @ 0x071A), dispatched during a credited
 *     game; and
 *   - as the fall-through tail of handler_1977 (ROM 0x1977), which does the extra
 *     `call sub_21ee` animation tick first and then drops straight into 0x197A.
 * Empirically (coin+start boot) it dispatches every frame from ~f1033 while the
 * live game runs.
 *
 * CONTROL FLOW. The cascade is mostly PLAIN calls (each callee's `ret` returns here
 * to run the next), but three of them use the rst caller-skip idiom -- a callee can
 * unwind PAST loc_197a and return to loc_197a's OWN caller, which the translation
 * models as the callee returning false:
 *   - 0x1E8C (@0x1980): entry_1e94's non-zero path skip-tail -- returns false -> abort.
 *   - 0x1E57 (@0x19B9): sub_1e57's pop-hl unwind -- returns false -> abort.
 *   - 0x1A07 (@0x19BF): idx3 WAIT+EXIT (loc_1a2a) jumps to the shared tail & rets --
 *                       returns false -> abort.
 * Each is `if (!m.call(addr)) return;` -- a genuine data-dependent branch. In the
 * driven run all three stay TRUE (never abort) for all 198 dispatches; the FALSE
 * arms are proven by synthesis in the test (stub the callee false, diff oracle vs
 * optimized incl. cycle total).
 *
 * After the cascade, a final gate: `ld a,(MARIO_ACTIVE) / and a / ret nz`. When
 * MARIO_ACTIVE (0x6200) is NON-zero the routine returns WITHOUT running the tail
 * (the common arm -- 197/198 dispatches); when it is ZERO it calls sub_011c, writes
 * 0x6082 = 3, and FALLS THROUGH into tail_19d2 (0x19D2), whose `ret` returns to
 * loc_197a's caller. `and a` sets the Z flag the `ret nz` consumes; A is left =
 * MARIO_ACTIVE and read by nothing before the tail (which reloads its own regs), so
 * the `and a` is kept verbatim to match A and F in the unit register diff.
 *
 * INPUTS.  RAM: MARIO_ACTIVE (0x6200), read at the gate. Plus everything the ~24
 *   callees read. Registers on entry: none consumed by loc_197a itself.
 * OUTPUTS. The cumulative writes of every callee; on the fall-through arm 0x6082 = 3
 *   and (via tail_19d2) 0x600A++ and 0x6009 = 0x40. On the ret-nz arm, none of its
 *   own beyond the callees'. Return value: undefined on every early/ret-nz arm;
 *   tail_19d2's return on the fall-through -- mirrored exactly (the caller-skip
 *   convention makes the boolean load-bearing).
 *
 * ATOMIC? NO -- decisively, and PROVEN so. This cascade dispatches the LONGEST
 * per-frame work in the game (the movement/enemy/collision engine, entry_1ac3 and
 * friends), all of it NMI-interruptible; a vblank frame boundary routinely lands
 * mid-cascade. So the per-instruction m.step charges are NOT collapsed -- each call
 * keeps its own 17t (and the gate/tail their exact charges), byte-identical to the
 * oracle. Same decision as loc_06fe (the state-3 sub-state dispatcher) -- but where
 * loc_06fe's collapse merely HAPPENED to stay EQUAL in the tested window, loc_197a's
 * has TEETH: collapsing the branch to a single front-loaded total (the handler_05c6-
 * style collapse) DIVERGES at frame 1035, stack 0x6BF6 (base 131 vs collapsed 192) --
 * the NMI lands at a different instruction inside the cascade and pushes a different
 * PC into diffed stack RAM (the entry_0611 mechanism, made concrete here). So this is
 * the routine that turns "keep per-instruction for a non-atomic cascade" from a
 * conservative choice into a measured requirement. Harness-verified the other way
 * too: with per-instruction charges the whole-machine gate stays EQUAL over 1300
 * frames. loc_197a writes NO hardware latch of its own (only work RAM: 0x6082, and
 * 0x600A/0x6009 via the tail), so there is no 0x7Dxx bus-cycle position to preserve
 * and no write-trace gate is needed.
 *
 * FLAGS. The only flag loc_197a computes is the Z from `and a`, consumed by its own
 * `ret nz` one instruction later -- kept. It sets no flag that a CALLER consumes;
 * every early/abort arm returns with whatever flags the last callee left, matched
 * because those callees run identically (via m.call) on both sides.
 */
export function loc_197a(m) {
  const { regs, mem } = m;

  // A plain `call NNNN`: push the return address, charge the 17t call, dispatch
  // through the registry. Kept per-instruction (non-atomic cascade, see header).
  const call = (ret, target) => {
    m.push16(ret);
    m.step(target, 17);
    m.call(target);
  };

  // ---- head: one plain call, then the first caller-skip guard ----
  call(0x197d, 0x1dbd);

  m.push16(0x1980);
  m.step(0x1e8c, 17); // call 0x1e8c
  if (!m.call(0x1e8c)) return; // entry_1e94 non-zero skip-tail unwound to our caller

  // ---- the long plain run (0x1983-0x19B8): tick every in-game subsystem.
  // (0x198F onward is `defb`-hidden in dk.asm but is LIVE code.) ----
  for (const [ret, target] of [
    [0x1983, 0x1ac3], // entry_1ac3 -- the player/movement engine (the spine)
    [0x1986, 0x1f72],
    [0x1989, 0x2c8f],
    [0x198c, 0x2c03],
    [0x198f, 0x30ed],
    [0x1992, 0x2e04],
    [0x1995, 0x24ea],
    [0x1998, 0x2ddb],
    [0x199b, 0x2ed4],
    [0x199e, 0x2207],
    [0x19a1, 0x1a33],
    [0x19a4, 0x2a85],
    [0x19a7, 0x1f46],
    [0x19aa, 0x26fa],
    [0x19ad, 0x25f2],
    [0x19b0, 0x19da],
    [0x19b3, 0x03fb],
    [0x19b6, 0x2808],
    [0x19b9, 0x281d],
  ]) {
    call(ret, target);
  }

  // ---- two more caller-skip guards ----
  m.push16(0x19bc);
  m.step(0x1e57, 17); // call 0x1e57
  if (!m.call(0x1e57)) return; // sub_1e57 pop-hl unwind returned to our caller

  m.push16(0x19bf);
  m.step(0x1a07, 17); // call 0x1a07
  if (!m.call(0x1a07)) return; // idx3 WAIT+EXIT jumped to the tail & RETed

  call(0x19c2, 0x2fcb);

  // ---- 0x19C2: three nops -- a REMOVED call, its 12t is kept ----
  m.step(0x19c3, 4); // nop
  m.step(0x19c4, 4); // nop
  m.step(0x19c5, 4); // nop

  // ---- final gate: ld a,(MARIO_ACTIVE) / and a / ret nz ----
  regs.a = mem.read8(MARIO_ACTIVE);
  m.step(0x19c8, 13); // ld a,(0x6200)
  regs.and(regs.a); // and a -- set Z for the ret nz
  m.step(0x19c9, 4);
  if (regs.fNZ) {
    m.ret(11); // ret nz -- MARIO_ACTIVE != 0: return, skip the tail (common arm)
    return;
  }
  m.step(0x19ca, 5); // ret nz NOT taken -- MARIO_ACTIVE == 0

  // ---- fall-through tail: sub_011c, arm 0x6082, fall into tail_19d2 ----
  m.push16(0x19cd);
  m.step(0x011c, 17); // call 0x011c
  m.call(0x011c);
  regs.hl = 0x6082;
  m.step(0x19d0, 10); // ld hl,0x6082
  mem.write8(regs.hl, 0x03);
  m.step(0x19d2, 10); // ld (hl),0x03
  return m.call(0x19d2); // fall into tail_19d2; its ret returns to OUR caller
}
