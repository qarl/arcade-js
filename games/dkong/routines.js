/**
 * The routine registry — the swap layer over the whole ROM address space.
 *
 * A `Map<romAddr, fn>` holding every translated routine. Every inter-routine call
 * in translated/ and optimized/ is written `m.call(0xADDR, ...args)` rather than a
 * direct `sub_ADDR(m)`; `m.call` looks the address up in `m.routines` — this base
 * table with the manifest's proven-equal optimized routines laid over the top — and
 * invokes it. With no overrides the table returns the oracle, so behaviour is
 * byte-identical; with an override it returns the optimized rewrite. That is the
 * whole mechanism: the registry IS the patch table over the address space, exactly
 * like patched ROM, and it makes ANY routine independently swappable rather than
 * only the two dispatch targets the old override map could reach.
 *
 * The base table is built ONCE from the translated modules' exports. A routine's
 * address is parsed from its name (`sub_0874` → 0x0874). Only names of the exact
 * shape `prefix_hhhh` sit at a distinct ROM address; the helper splits the
 * translator introduced (`sub_25f2_body`, `loc_18c6_wrap`, `sub_2207_body`) and the
 * non-underscore tail labels (`tail12cb`, `reject2b9b`, `tail2398`, …) do not match
 * that shape and are left out automatically — they stay direct-called inside their
 * parent. The one name that matches the shape but must NOT claim its address is
 * `tail_23de` (the tail of `sub_23de`, which owns 0x23de); it is listed explicitly.
 */
import * as boot from "./translated/boot.js";
import * as mainloop from "./translated/mainloop.js";
import * as nmi from "./translated/nmi.js";
import * as state0 from "./translated/state0.js";

/**
 * Names that match `prefix_hhhh` yet are NOT the canonical routine at that address.
 * `tail_23de` is a tail fragment of `sub_23de`; letting it claim 0x23de would make
 * `m.call(0x23de)` resolve to the wrong half of the routine.
 */
const NON_CANONICAL = new Set(["tail_23de"]);

const ADDR_NAME = /^[a-z]+_([0-9a-f]+)$/;

function build() {
  const byAddr = new Map();
  const byName = new Map();
  const owner = new Map(); // addr -> name, for a precise collision message
  for (const mod of [boot, mainloop, nmi, state0]) {
    for (const [name, fn] of Object.entries(mod)) {
      if (typeof fn !== "function") continue;
      const m = ADDR_NAME.exec(name);
      if (!m || NON_CANONICAL.has(name)) continue;
      const addr = parseInt(m[1], 16);
      if (byAddr.has(addr)) {
        throw new Error(
          `routine registry: 0x${addr.toString(16).padStart(4, "0")} claimed by ` +
            `both ${owner.get(addr)} and ${name} — one is a helper/tail, add it to ` +
            "NON_CANONICAL in routines.js",
        );
      }
      byAddr.set(addr, fn);
      byName.set(name, addr);
      owner.set(addr, name);
    }
  }
  return { byAddr, byName };
}

const built = build();

/** Oracle table, addr → fn, built once. Each Machine starts from a copy. */
export const ORACLE_ROUTINES = built.byAddr;

/**
 * Canonical routine name → address, for the retrofit tool: it converts a call
 * `NAME(m…)` to `m.call(0xADDR…)` only when NAME is a key here, so helper splits
 * and tail fragments (absent from this map) are left as direct calls.
 */
export const NAME_TO_ADDR = built.byName;
