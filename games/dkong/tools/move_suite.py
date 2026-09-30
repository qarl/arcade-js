# SPDX-License-Identifier: GPL-3.0-only
import subprocess, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..','..','..','tools'))
import pixel_gate
from raw_dumps import raw_dumps
S=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(S)
REPO=os.path.dirname(os.path.dirname(ROOT))  # repo root (games/dkong/tools -> ../../..)
WORK=os.path.join(ROOT,"out","movework"); os.makedirs(WORK,exist_ok=True)
BPTR={2:0x74,3:0x76,4:0x78}
FIELD={0x01:"P1 Right",0x02:"P1 Left",0x04:"P1 Up",0x08:"P1 Down",0x10:"P1 Button 1"}
# (name, board, mario_x, mario_y, input_bits, hold_frames)
TESTS=[
 ("b1_walk_right",1,0x60,0x90,0x01,140),
 ("b1_walk_left", 1,0xa0,0x90,0x02,140),
 ("b1_climb_up",  1,0x60,0x90,0x04,140),
 ("b1_jump",      1,0x60,0xd0,0x10,140),
 ("b3_walk_right",3,0x60,0x90,0x01,140),
 ("b4_walk_right",4,0x60,0x90,0x01,140),
]
def lua(name,b,x,y,bits,hold):
    bp=""
    if b>1:
        p=BPTR[b]
        bp=f"  if f>=464 and f<=1463 then mem:write_u8(0x604A,0x{p:02x});mem:write_u8(0x604B,0x3A);mem:write_u8(0x6049,0x0{b});mem:write_u8(0x622A,0x{p:02x});mem:write_u8(0x622B,0x3A);mem:write_u8(0x6227,0x0{b});mem:write_u8(0x6229,0x0{b}) end\n"
    fld=FIELD[bits]
    t=f'''local M=manager.machine
local mem=M.devices[":maincpu"].spaces["program"]
local I2=M.ioport.ports[":IN2"];local I0=M.ioport.ports[":IN0"]
local coin=I2.fields["Coin 1"];local start=I2.fields["1 Player Start"];local inp=I0.fields["{fld}"]
assert(coin and start and inp,"fields")
local f=0
_G.__ts=emu.add_machine_frame_notifier(function()
 f=f+1
 coin:set_value((f>=399 and f<400) and 1 or 0)
 start:set_value((f>=459 and f<460) and 1 or 0)
{bp} if f>=1600 and f<=1601 then mem:write_u8(0x6203,0x{x:02x});mem:write_u8(0x6205,0x{y:02x}) end
 inp:set_value((f>=1600 and f<{1600+hold}) and 1 or 0)
end)'''
    path=f"{WORK}/test_{name}.lua"; open(path,"w").write(t); return path
def emit_cmd(out,b,x,y,bits,hold):
    c=["node","tools/emit.js","--frames-out",out,"--frames","1820",
       "--input","0x7d00=0x80@400:once","--input","0x7d00=0x04@460:once",
       "--input",f"0x7c00=0x{bits:02x}@1601:hold{hold}",
       "--poke",f"0x6203=0x{x:02x}@1601:hold2","--poke",f"0x6205=0x{y:02x}@1601:hold2"]
    if b>1:
        p=BPTR[b]
        for a,v in [(0x6049,b),(0x604a,p),(0x604b,0x3a),(0x622a,p),(0x622b,0x3a),(0x6227,b),(0x6229,b)]:
            c+=["--poke",f"0x{a:04x}=0x{v:02x}@465:hold1000"]
    return c
HW=os.path.join(REPO,"boards","dkong","hardware.json")
def diff(js,gd):
    # Geometry, the pinned AVI offset and the reconvergence rule all live in tools/pixel_gate.py.
    # Return the VERDICT, never just the numbers: an empty window has max 0 and 0 frames over,
    # so a caller re-deriving PASS from those reads a run that compared nothing as clean.
    d=pixel_gate.frame_diffs(js,gd,HW)
    return pixel_gate.rough_verdict(d,HW,from_frame=1600)
print(f"{'test':16} {'emit':10} {'max%':>6} {'>5%':>4} {'verdict'}")
KEEP="--keep-frames" in sys.argv  # else each test's raw dumps go once its verdict prints
for name,b,x,y,bits,hold in TESTS:
    lp=lua(name,b,x,y,bits,hold)
    go=f"{WORK}/g_{name}"; eo=f"{WORK}/e_{name}"
    with raw_dumps(go,eo,keep=KEEP):
        r=subprocess.run(["python3",f"{REPO}/tools/mame_golden.py",
           "--hardware",f"{REPO}/boards/dkong/hardware.json","--lua-dir",f"{REPO}/games/dkong/tools/lua",
           "--rompath",f"{REPO}/games/dkong/rom",
           "--out",go,"--seconds","30","--tape",lp],capture_output=True,text=True,timeout=150)
        er=subprocess.run(emit_cmd(eo,b,x,y,bits,hold),cwd=ROOT,capture_output=True,text=True)
        stopped = "GAP" if "not impl" in (er.stdout+er.stderr).lower() else "ran"
        if stopped=="ran" and os.path.exists(f"{eo}/frames.rgb") and os.path.exists(f"{go}/frames.rgb"):
            r=diff(f"{eo}/frames.rgb",f"{go}/frames.rgb")
            print(f"{name:16} {'ran':10} {r['max_pct']:6.2f} {r['frames_over']:4d} {r['verdict']}")
        else:
            print(f"{name:16} {stopped:10} {'--':>6} {'--':>4} {'GAP-FOUND' if stopped=='GAP' else 'NO-FRAMES'}")
