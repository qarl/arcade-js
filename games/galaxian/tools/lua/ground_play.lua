-- SPDX-License-Identifier: GPL-3.0-only
-- Grounding capture WITH input injection: force coin -> start -> hold-fire on the memory-mapped input
-- ports (IP_ACTIVE_HIGH: coin=IN0 0x6000 bit0, start1=IN1 0x6800 bit0, fire=IN0 bit4) via read-tap
-- overrides, while recording every work-RAM write (0x4000-0x43ff) with time+PC. Lets the grounding fan
-- observe the coin/credit/play leaves attract never reaches. CURPC is the NEXT instruction.
-- Output CSV: t,curpc,addr,value (t = emu seconds).  Env: GROUND_OUT.
local out = io.open(os.getenv("GROUND_OUT") or "ground_play.csv", "w")
out:setvbuf("no"); out:write("t,curpc,addr,value\n")
local cpu = manager.machine.devices[":maincpu"]
local prog = cpu.spaces["program"]
local function now() return manager.machine.time:as_double() end

_G.__wtap = prog:install_write_tap(0x4000, 0x43ff, "gw", function(off, data, mask)
  out:write(string.format("%.3f,%04x,%04x,%02x\n", now(), cpu.state["CURPC"].value, off, data))
end)

-- Coin pulse ~2.0-2.4s, a second coin ~2.7-3.1s (>=2 credits), start1 pulse ~3.6-4.0s, hold fire from 5s.
_G.__in0 = prog:install_read_tap(0x6000, 0x6000, "in0", function(off, data, mask)
  local t = now(); local v = data
  if (t >= 2.0 and t < 2.4) or (t >= 2.7 and t < 3.1) then v = v | 0x01 end
  if t >= 5.0 then v = v | 0x10 end
  return v
end)
_G.__in1 = prog:install_read_tap(0x6800, 0x6800, "in1", function(off, data, mask)
  local t = now(); local v = data
  if t >= 3.6 and t < 4.0 then v = v | 0x01 end
  return v
end)
