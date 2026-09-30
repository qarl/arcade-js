#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Delete raw capture dumps once the verdict is in -- the one mechanism every pixel/state caller uses.

A MAME golden (tools/mame_golden.py) and a JS render (games/<g>/tools/render.js) each leave a raw
frames.rgb (~170KB per frame) and the golden a state.bin; a 10-minute run is several GB. Nothing reads
them after the verdict (gates key on the printed verdict line, never on the files), so they are deleted
on PASS, FAIL, an exception, Ctrl-C and SIGTERM/SIGHUP alike. Small artifacts stay: frames.json hashes,
manifests, tapes, reach.json, summary.json.

A signal first stops this process's children (SIGTERM, then wait; SIGKILL after STOP_GRACE seconds), so a
producer mid-capture runs its own cleanup (mame_golden.py removes its temp capture dir the same way)
before the sweep. What can still strand dumps: a SIGKILL of the caller, a child that ignores SIGTERM for
STOP_GRACE seconds, power loss. The scheduled backstop for those is `sweep-stale` below.

A sweep never touches an empty path, the filesystem root, $HOME, the repo root, or any ancestor of
those; it prints a refusal and deletes nothing there.

In a suite:
    with raw_dumps(work, keep=a.keep_frames):            # sweep dumps under `work` afterwards
    with raw_dumps(tmp, keep=a.keep_frames, rmtree=True): # a private temp dir: remove it whole
    with raw_dumps(work, keep=..., summary=summary):      # also write summary.json into `work`
A producer with its own temp dir wraps itself in `signals_to_exit()` so its `finally` runs on a signal.

An ad-hoc driver (a shell loop over mame_golden.py + render.js + a differ) wraps itself instead:
    python3 tools/raw_dumps.py run --dir OUT_G --dir OUT_J [--keep-frames] -- CMD ARGS...
which runs CMD in its own process group, sweeps every --dir once that group is gone (forwarding
SIGTERM/SIGINT/SIGHUP to it), and exits with CMD's code. `sweep DIR...` deletes the dumps under DIRs now.

The scheduled backstop sweeps directories that hold other agents' clones and work dirs:
    python3 tools/raw_dumps.py sweep-stale ROOT [ROOT...] --min-age-hours 3 [--below-gi N] [--dry-run]
Each immediate child dir of ROOT is one unit, and a LIVE unit is skipped whole: the newest stamp of any
file or directory in its tree (the later of mtime and ctime: cp -p and tar -x leave an old mtime on a file
made just now) is younger than --min-age-hours, or a running process has its cwd or an open file under it
(lsof), or its tree could not be walked within the time bound. A dump lying between its write and its
compare is held by no process, so "unheld" alone never means "finished": the tree's age is what decides.
Only in a non-live unit are dumps deleted, and only those themselves older than --min-age-hours; the unit's
whole liveness check is re-run right before its deletions, and each dump is re-checked right before its
own. A file directly in ROOT is judged by its own age and open-file check. If lsof cannot be run nothing
is deleted.
"""
import argparse
import contextlib
import json
import os
import shutil
import signal
import stat
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_SUFFIXES = (".rgb", ".avi")
RAW_NAMES = ("state.bin",)
# Dumps sit in the dir a caller names or at most two levels below it (work/<tape>/golden/frames.rgb).
# The walk stops there, so a mistaken --work (a network mount) cannot turn into a tree crawl.
MAX_DEPTH = 2
TRAPPED = (signal.SIGTERM, signal.SIGHUP)
STOP_GRACE = 15
_stopping = False


def is_raw(name):
    return name in RAW_NAMES or name.endswith(RAW_SUFFIXES)


def _refused(top):
    """Why `top` must never be swept or removed, or None. '' is the cwd to os.walk and to rmtree's
    callers; / , $HOME and the repo root (and their ancestors) hold things that are not this run's."""
    if not str(top).strip():
        return "an empty path"
    real = os.path.realpath(top)
    for label, guard in (("the filesystem root", os.sep), ("$HOME", os.path.expanduser("~")),
                         ("the repo root", REPO)):
        g = os.path.realpath(guard)
        if real == g or g.startswith(real.rstrip(os.sep) + os.sep):
            return f"{label} or an ancestor of it"
    return None


def _allowed(top):
    why = _refused(top)
    if why:
        print(f"raw_dumps: refusing to clean {top!r}: {why}", file=sys.stderr)
    return why is None


def raw_files(*dirs):
    """Every raw dump under `dirs` (to MAX_DEPTH, symlinks not followed); a missing or refused dir has none."""
    found = []
    for top in dirs:
        if not _allowed(top) or not os.path.isdir(top):
            continue
        top = os.path.abspath(top)
        base = top.rstrip(os.sep).count(os.sep)
        for root, subdirs, files in os.walk(top, followlinks=False):
            if root.rstrip(os.sep).count(os.sep) - base >= MAX_DEPTH:
                subdirs[:] = []
            found += [os.path.join(root, f) for f in files if is_raw(f)]
    return found


def sweep(*dirs):
    """Delete the raw dumps under `dirs`; returns the paths removed."""
    gone = []
    for path in raw_files(*dirs):
        with contextlib.suppress(FileNotFoundError):
            os.remove(path)
            gone.append(path)
    return gone


def _exited(pid):
    """True once child `pid` has exited (without reaping it: its Popen still collects the status)."""
    try:
        return os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT) is not None
    except ChildProcessError:
        return True


def stop_children(grace=STOP_GRACE):
    """SIGTERM every direct child and wait for it to exit (running its own cleanup); SIGKILL after `grace`."""
    try:
        out = subprocess.run(["pgrep", "-P", str(os.getpid())], capture_output=True, text=True,
                             timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return
    kids = [int(x) for x in out.split()]
    for pid in kids:
        with contextlib.suppress(ProcessLookupError):
            os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + grace
    while kids and time.monotonic() < deadline:
        kids = [pid for pid in kids if not _exited(pid)]
        time.sleep(0.05)
    for pid in kids:
        with contextlib.suppress(ProcessLookupError):
            os.kill(pid, signal.SIGKILL)


def _on_signal(signum, _frame):
    global _stopping
    if _stopping:
        return
    _stopping = True
    try:
        stop_children()
    finally:
        _stopping = False
    if signum == signal.SIGINT:
        raise KeyboardInterrupt
    raise SystemExit(128 + signum)


@contextlib.contextmanager
def signals_to_exit():
    """SIGTERM/SIGHUP/SIGINT stop the children, then raise (SystemExit / KeyboardInterrupt) so `finally`
    runs; SIGTERM's default action would skip it. A handler someone else installed (an outer
    signals_to_exit already does this) is left alone."""
    saved = {}
    for sig, default in ((signal.SIGTERM, signal.SIG_DFL), (signal.SIGHUP, signal.SIG_DFL),
                         (signal.SIGINT, signal.default_int_handler)):
        try:
            if signal.getsignal(sig) == default:
                saved[sig] = signal.signal(sig, _on_signal)
        except ValueError:
            break
    try:
        yield
    finally:
        for sig, handler in saved.items():
            signal.signal(sig, handler)


def write_summary(work, summary, keep):
    summary["raw_frames_kept"] = bool(keep)
    try:
        os.makedirs(work, exist_ok=True)
        with open(os.path.join(work, "summary.json"), "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=1, default=str)
            fh.write("\n")
    except OSError as e:
        print(f"  warning: could not write summary.json: {e}")


@contextlib.contextmanager
def raw_dumps(*dirs, keep=False, summary=None, rmtree=False):
    """Run the body, then (unless `keep`) delete the raw dumps under `dirs` -- or the dirs themselves
    when `rmtree` -- on every exit path. `summary` (a dict the body fills in) is written to the first
    dir as summary.json before the sweep."""
    with signals_to_exit():
        try:
            yield
        finally:
            if summary is not None and _allowed(dirs[0]):
                write_summary(dirs[0], summary, keep)
            if keep:
                print(f"  raw dumps kept (--keep-frames): {', '.join(dirs)}")
            elif rmtree:
                for d in dirs:
                    if _allowed(d):
                        shutil.rmtree(d, ignore_errors=True)
            else:
                sweep(*dirs)


def _group_alive(pgid):
    try:
        os.killpg(pgid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def run(cmd, dirs, keep=False, grace=STOP_GRACE):
    """Run `cmd` in its own process group inside raw_dumps(dirs). A signal to this wrapper goes to the whole
    group; the sweep waits until every process in it is gone (SIGKILL after `grace`), so nothing it
    started is still writing. Returns `cmd`'s exit code (or 128+signal)."""
    child = None

    def forward(signum, _frame):
        if child is not None:
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(child.pid, signum)

    with raw_dumps(*dirs, keep=keep):
        prev = {s: signal.signal(s, forward) for s in (*TRAPPED, signal.SIGINT)}
        try:
            child = subprocess.Popen(cmd, start_new_session=True)
            rc = child.wait()
        finally:
            if child is not None:
                if child.poll() is None:
                    forward(signal.SIGTERM, None)
                deadline = time.monotonic() + grace
                while (child.poll() is None or _group_alive(child.pid)) and time.monotonic() < deadline:
                    time.sleep(0.05)
                if child.poll() is None or _group_alive(child.pid):
                    forward(signal.SIGKILL, None)
                    child.wait()
            for s, h in prev.items():
                signal.signal(s, h)
    return rc if rc >= 0 else 128 - rc


# sweep-stale: how long one unit's tree walk may take before the unit is called LIVE (not judged).
WALK_SECONDS = 60
LSOF_TIMEOUT = 120


def _under(path, prefixes):
    return any(path == p or path.startswith(p.rstrip(os.sep) + os.sep) for p in prefixes)


def _held_paths():
    """{path: (pid, command, fd)} for every cwd and open file of every process lsof can see, or None when
    lsof could not be run (then nothing may be judged unheld)."""
    try:
        r = subprocess.run(["lsof", "-n", "-P", "-w", "-F", "pcfn"], capture_output=True, text=True,
                           timeout=LSOF_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as e:
        print(f"sweep-stale: lsof failed ({e}); deleting nothing", file=sys.stderr)
        return None
    if not r.stdout.strip():
        print(f"sweep-stale: lsof printed nothing (exit {r.returncode}); deleting nothing", file=sys.stderr)
        return None
    held, pid, cmd, fd = {}, "?", "?", "?"
    for line in r.stdout.splitlines():
        tag, val = line[:1], line[1:]
        if tag == "p":
            pid, cmd, fd = val, "?", "?"
        elif tag == "c":
            cmd = val
        elif tag == "f":
            fd = val
        elif tag == "n" and val.startswith(os.sep):
            held.setdefault(val, (pid, cmd, fd))
    return held


def _holder(prefixes, held):
    """A 'pid N (cmd) has <fd> <path>' line for the first held path under `prefixes`, or None."""
    for path, (pid, cmd, fd) in held.items():
        if _under(path, prefixes):
            what = "its cwd at" if fd == "cwd" else f"fd {fd} open on"
            return f"pid {pid} ({cmd}) has {what} {path}"
    return None


def _forms(path):
    """The spellings lsof may report `path` under (it resolves /tmp -> /private/tmp on macOS)."""
    return sorted({os.path.abspath(path), os.path.realpath(path)})


def _now():
    """The sweep's clock. Tests set RAW_DUMPS_NOW (epoch seconds, in the future) because a file's ctime
    cannot be set back, so the only way to make a file old is to move the clock forward."""
    v = os.environ.get("RAW_DUMPS_NOW")
    if v:
        print(f"sweep-stale: clock overridden by RAW_DUMPS_NOW={v} (tests only)", file=sys.stderr)
    return float(v) if v else time.time()


def _stamp(st):
    """A file's age stamp: the later of mtime and ctime. cp -p, tar -x and `git archive | tar -x` set an old
    mtime on a file created just now; its ctime (which nothing can set back) says when it arrived."""
    return max(st.st_mtime, st.st_ctime)


def _scan_unit(unit, cutoff, budget=WALK_SECONDS):
    """Walk `unit` (symlinks not followed): (newest_stamp, newest_path, dumps, None), where newest_path is
    the file or directory with the latest _stamp and dumps are the raw files older than `cutoff`; or
    (None, None, [], reason) when the walk ran past `budget` seconds and the unit was not judged."""
    newest, newest_path, dumps = 0.0, None, []
    deadline = time.monotonic() + budget
    for root, _subdirs, files in os.walk(unit, followlinks=False):
        if time.monotonic() > deadline:
            return None, None, [], f"tree walk ran past {budget}s; not judged"
        with contextlib.suppress(OSError):
            st = os.lstat(root)
            if _stamp(st) > newest:
                newest, newest_path = _stamp(st), root
        for f in files:
            path = os.path.join(root, f)
            try:
                st = os.lstat(path)
            except OSError:
                continue
            if _stamp(st) > newest:
                newest, newest_path = _stamp(st), path
            if is_raw(f) and stat.S_ISREG(st.st_mode) and _stamp(st) < cutoff:
                dumps.append(path)
    return newest, newest_path, dumps, None


def _remove_if_still_stale(path, cutoff, dry_run):
    """Delete one dump after re-checking it right now (still a regular file, still older than the cutoff)."""
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return False
    if not stat.S_ISREG(st.st_mode) or _stamp(st) >= cutoff:
        print(f"  skip {path}: changed since the scan")
        return False
    if dry_run:
        print(f"  would remove {path} ({(_now() - _stamp(st)) / 3600:.1f}h old)")
        return True
    with contextlib.suppress(FileNotFoundError):
        os.remove(path)
        print(f"  removed {path} ({(_now() - _stamp(st)) / 3600:.1f}h old)")
        return True
    return False


def _test_pause(stage):
    """Tests only: with RAW_DUMPS_TEST_PAUSE=<stage>, print PAUSED <stage> and wait for a line on stdin, so
    a test can change the tree between a check and the deletion it guards."""
    if os.environ.get("RAW_DUMPS_TEST_PAUSE") == stage:
        print(f"PAUSED {stage}", flush=True)
        sys.stdin.readline()


def _unit_live(unit, scan, held, cutoff, min_age_hours):
    """Why `unit` is LIVE, given its _scan_unit result and a _held_paths snapshot, or None when stale."""
    newest, newest_path, _dumps, unjudged = scan
    if unjudged:
        return unjudged
    if newest_path and newest >= cutoff:
        age = (_now() - newest) / 3600
        return f"newest entry {newest_path} is {age:.2f}h old (< {min_age_hours}h)"
    return _holder(_forms(unit), held)


def sweep_stale(roots, min_age_hours, below_gi=None, dry_run=False, walk_seconds=WALK_SECONDS):
    """The scheduled backstop (see the module doc). Returns 0, or 2 if a root was refused or lsof failed."""
    rc = 0
    tag = " (dry run)" if dry_run else ""
    min_age = min_age_hours * 3600
    for top in roots:
        if not _allowed(top):
            rc = 2
            continue
        if os.path.islink(top) or not os.path.isdir(top):
            print(f"raw_dumps: refusing to clean {top!r}: not a directory (or a symlink)", file=sys.stderr)
            rc = 2
            continue
        top = os.path.abspath(top)
        free = shutil.disk_usage(top).free / 2**30
        if below_gi is not None and free >= below_gi:
            print(f"{top}: {free:.1f} GiB free, not below {below_gi} GiB; nothing to do")
            continue
        print(f"{top}: {free:.1f} GiB free{tag}")
        cutoff = _now() - min_age
        units, loose = [], []
        with os.scandir(top) as it:
            for e in sorted(it, key=lambda e: e.name):
                if e.is_symlink():
                    print(f"  SKIP {e.path}: a symlink, not followed")
                elif e.is_dir(follow_symlinks=False):
                    units.append(e.path)
                elif e.is_file(follow_symlinks=False) and is_raw(e.name):
                    loose.append(e.path)
        scans = {u: _scan_unit(u, cutoff, walk_seconds) for u in units}
        held = _held_paths()   # after the walks, so it is as close to the deletions as it can be
        if held is None:
            rc = 2
            continue
        _test_pause("scanned")
        for unit in units:
            why = _unit_live(unit, scans[unit], held, cutoff, min_age_hours)
            if why:
                print(f"  LIVE {unit}: {why}")
                continue
            print(f"  stale {unit}: nothing in it younger than {min_age_hours}h, no process in it")
            if not scans[unit][2]:
                continue
            # Re-judge the unit now, not as of the scan: other units' deletions took time, and an agent may
            # have started in this one since.
            again = _scan_unit(unit, cutoff, walk_seconds)
            now_held = _held_paths()
            why = "lsof failed on the re-check" if now_held is None else \
                _unit_live(unit, again, now_held, cutoff, min_age_hours)
            if why:
                print(f"  LIVE {unit} on the re-check before deleting: {why}")
                continue
            _test_pause("rechecked")
            for path in again[2]:
                _remove_if_still_stale(path, cutoff, dry_run)
        for path in loose:
            who = _holder(_forms(path), held)
            if who:
                print(f"  SKIP {path}: {who}")
            elif _stamp(os.lstat(path)) >= cutoff:
                print(f"  SKIP {path}: younger than {min_age_hours}h")
            else:
                _remove_if_still_stale(path, cutoff, dry_run)
    return rc


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="run CMD, then delete the raw dumps under every --dir")
    r.add_argument("--dir", action="append", required=True, help="a dir CMD writes dumps into")
    r.add_argument("--keep-frames", action="store_true", help="keep the dumps (debugging)")
    r.add_argument("argv", nargs=argparse.REMAINDER, help="-- CMD ARGS...")
    s = sub.add_parser("sweep", help="delete the raw dumps under DIRs now")
    s.add_argument("dirs", nargs="+")
    t = sub.add_parser("sweep-stale", help="scheduled backstop: delete old dumps in every non-live child of ROOTs")
    t.add_argument("roots", nargs="+", metavar="ROOT")
    t.add_argument("--min-age-hours", type=float, required=True,
                   help="a child with any file younger than this is live; only dumps older than this go")
    t.add_argument("--below-gi", type=float, help="do nothing unless ROOT's filesystem has less free (GiB)")
    t.add_argument("--dry-run", action="store_true", help="print what would go; delete nothing")
    t.add_argument("--walk-seconds", type=float, default=WALK_SECONDS,
                   help="a child whose tree walk takes longer is live (not judged)")
    a = p.parse_args(argv)
    if a.cmd == "sweep-stale":
        if a.min_age_hours <= 0:
            p.error("--min-age-hours must be positive")
        return sweep_stale(a.roots, a.min_age_hours, a.below_gi, a.dry_run, a.walk_seconds)
    if a.cmd == "sweep":
        for path in sweep(*a.dirs):
            print(f"removed {path}")
        return 0
    cmd = a.argv[1:] if a.argv[:1] == ["--"] else a.argv
    if not cmd:
        p.error("run needs a command after --")
    return run(cmd, a.dir, a.keep_frames)


if __name__ == "__main__":
    sys.exit(main())
