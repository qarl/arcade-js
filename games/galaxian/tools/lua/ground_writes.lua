-- SPDX-License-Identifier: GPL-3.0-only
-- Grounding write-tap: record every write into work RAM (0x4000-0x43ff) with the writing PC, so a cell's
-- producer routine and value trajectory can be observed on the real machine (stage-B [code]->[seen]).
-- CURPC on a write tap is the NEXT instruction. Output CSV: curpc,addr,value.  Env: GROUND_OUT.
local out = io.open(os.getenv("GROUND_OUT") or "ground_writes.csv", "w")
out:setvbuf("no"); out:write("curpc,addr,value\n")
local cpu = manager.machine.devices[":maincpu"]
local prog = cpu.spaces["program"]
-- Retain the subscription in a global: a collected MAME tap handle unsubscribes silently.
_G.__ground_tap = prog:install_write_tap(0x4000, 0x43ff, "groundw", function(offset, data, mask)
  out:write(string.format("%04x,%04x,%02x\n", cpu.state["CURPC"].value, offset, data))
end)
