#!/usr/bin/env python3
"""claude-harness: deterministic verification gate.

Modes
  mark    PostToolUse(Edit|Write|MultiEdit|NotebookEdit): note that Claude changed files.
  stop    Stop: if Claude changed files since the last check and the working tree has not
          passed yet, run HARNESS_VERIFY_CMD. On failure, keep Claude working with the
          failure output. Claude can still end the turn by replying without further edits
          (e.g. to explain a pre-existing failure or to ask the user a question).
          A pass is reported to the user only (systemMessage), not added to Claude's context.
  verify  Command line: run HARNESS_VERIFY_CMD now and print a condensed result.
          Exit code is the command's (2 = not configured, 124 = timed out).

Configuration: environment variables, normally set in the "env" block of
.claude/settings.json (team) or .claude/settings.local.json (personal). The verify mode
also reads those files directly, so `python3 .claude/hooks/quality_gate.py verify`
works in a plain terminal or CI.
  HARNESS_VERIFY_CMD      fast project checks, e.g. "npm run -s lint && npm test -s". Unset = gate off.
  HARNESS_VERIFY_TIMEOUT  seconds, default 300 (capped at 540; the Stop hook timeout is 600).
  HARNESS_STOP_GATE       "off" keeps verify mode but never blocks at Stop.

The project is the session's project (CLAUDE_PROJECT_DIR), or a worktree of the same
repository when Claude works in one. State lives in a private per-user cache directory
(~/.cache/claude-harness), never in the repository. A pass is recorded for the exact
working tree and command that were checked. Bash-only file changes (code generators,
sed -i) do not mark the session; see README.
"""
from __future__ import annotations

import contextlib
import getpass
import hashlib
import json
import os
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time

try:
    import fcntl
except ImportError:                                 # Windows: updates are not locked
    fcntl = None

EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
BUSY_TASK_TYPES = {"subagent", "workflow", "teammate"}
MAX_BLOCKS_PER_PROMPT = 3
DEFAULT_TIMEOUT = 300
MAX_TIMEOUT = 540
TAIL_LINES = 60
TAIL_CHARS = 4000
ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


# ---------------------------------------------------------------- configuration
def read_settings_env(root: str) -> dict:
    merged: dict = {}
    for rel in (".claude/settings.json", ".claude/settings.local.json"):   # later wins
        try:
            with open(os.path.join(root, rel), encoding="utf-8") as fh:
                env = json.load(fh).get("env") or {}
            merged.update({k: str(v) for k, v in env.items()})
        except (OSError, ValueError, AttributeError):
            continue
    return merged


def setting(name: str, root: str, default: str = "") -> str:
    value = os.environ.get(name)
    if value is None:
        value = read_settings_env(root).get(name, default)
    return value.strip()


def is_off(value: str) -> bool:
    return value.lower() in ("off", "0", "false", "no")


def verify_timeout(root: str) -> int:
    try:
        seconds = int(setting("HARNESS_VERIFY_TIMEOUT", root, str(DEFAULT_TIMEOUT)))
    except ValueError:
        seconds = DEFAULT_TIMEOUT
    return max(5, min(seconds, MAX_TIMEOUT))


# ---------------------------------------------------------------- git helpers
def git(args: list[str], cwd: str, timeout: int = 30) -> bytes | None:
    try:
        proc = subprocess.run(["git", "--no-optional-locks", *args], cwd=cwd, capture_output=True,
                              timeout=timeout, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return proc.stdout if proc.returncode == 0 else None


def git_toplevel(path: str) -> str | None:
    if not path or not os.path.isdir(path):
        return None
    out = git(["rev-parse", "--show-toplevel"], path)
    return out.decode().strip() if out else None


def git_common_dir(top: str) -> str | None:
    out = git(["rev-parse", "--git-common-dir"], top)
    if not out:
        return None
    path = out.decode().strip()
    return os.path.realpath(path if os.path.isabs(path) else os.path.join(top, path))


def project_root(cwd: str) -> tuple[str, bool]:
    """(root, is_git): the session's project, or a worktree of the same repository Claude moved into.

    A `cd` into a nested, independent repository (a submodule or vendored checkout) does not
    change the project, because its own settings and checks are not this session's.
    """
    here = git_toplevel(cwd)
    base = os.environ.get("CLAUDE_PROJECT_DIR")
    if not base:
        return (here, True) if here else (cwd, False)
    base_top = git_toplevel(base)
    if not base_top:
        return base, False
    if here and os.path.realpath(here) != os.path.realpath(base_top) \
            and git_common_dir(here) == git_common_dir(base_top):
        return here, True
    return base_top, True


def fingerprint(root: str) -> str | None:
    """Identity of the working tree: HEAD + status + size/mtime of every changed path."""
    status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], root)
    if status is None:
        return None
    head = git(["rev-parse", "-q", "--verify", "HEAD"], root) or b"(no commits)"
    digest = hashlib.sha256(head + b"\0" + status)
    entries = status.split(b"\0")
    i = 0
    while i < len(entries):
        entry = entries[i]
        i += 1
        if len(entry) < 4:
            continue
        if entry[:1] in (b"R", b"C"):
            i += 1                                  # skip the rename/copy source path
        path = os.path.join(root, entry[3:].decode("utf-8", "surrogateescape"))
        try:
            st = os.lstat(path)
            digest.update(f"{path}\0{st.st_size}\0{st.st_mtime_ns}\0".encode("utf-8", "surrogateescape"))
        except OSError:
            digest.update(f"{path}\0missing\0".encode("utf-8", "surrogateescape"))
    return digest.hexdigest()


def pass_key(tree: str | None, command: str) -> str | None:
    """A pass only counts for the same working tree checked with the same command."""
    if not tree:
        return None
    return hashlib.sha256(f"{tree}\0{command}".encode("utf-8", "surrogateescape")).hexdigest()


# ---------------------------------------------------------------- state
def state_dir() -> str:
    """Private per-user directory; refuses one that someone else owns or that is a symlink."""
    base = os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache")
    directory = os.path.join(base, "claude-harness")
    os.makedirs(directory, mode=0o700, exist_ok=True)
    st = os.lstat(directory)
    if not stat.S_ISDIR(st.st_mode) or (hasattr(os, "getuid") and st.st_uid != os.getuid()):
        raise RuntimeError(f"{directory} is not a directory owned by {getpass.getuser()}")
    if hasattr(os, "getuid") and st.st_mode & 0o077:
        os.chmod(directory, 0o700)
    return directory


def state_path(root: str) -> str:
    key = hashlib.sha256(os.path.realpath(root).encode("utf-8", "surrogateescape")).hexdigest()[:16]
    return os.path.join(state_dir(), f"{key}.json")


def load_state(root: str) -> dict:
    try:
        with open(state_path(root), encoding="utf-8") as fh:
            state = json.load(fh)
        if isinstance(state, dict):
            return state
    except (OSError, ValueError):
        pass
    return {}


def save_state(root: str, state: dict) -> None:
    sessions = state.get("sessions", {})
    if len(sessions) > 50:                          # keep the most recently touched sessions
        newest = sorted(sessions.items(), key=lambda kv: kv[1].get("t", 0))[-50:]
        state["sessions"] = dict(newest)
    state["passed"] = state.get("passed", [])[-20:]
    path = state_path(root)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".state-")   # O_EXCL: no planted files
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(state, fh)
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


@contextlib.contextmanager
def locked_state(root: str):
    """Read-modify-write the shared state under an exclusive lock.

    Several sessions can work in one repository, so every update re-reads the file inside
    the lock. Keep the critical section short: never run the checks while holding it.
    """
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(state_path(root) + ".lock", flags, 0o600)
    try:
        if fcntl:
            fcntl.flock(fd, fcntl.LOCK_EX)
        state = load_state(root)
        yield state
        save_state(root, state)
    finally:
        os.close(fd)                                # also releases the lock


def session_state(state: dict, session_id: str) -> dict:
    sess = state.setdefault("sessions", {}).setdefault(session_id or "unknown", {})
    sess["t"] = time.time()
    return sess


# ---------------------------------------------------------------- running the checks
def run_checks(command: str, root: str, timeout: int) -> dict:
    """Run the checks with output in a temp file, so background jobs that keep stdout open
    cannot stall or disguise the result. Leftover processes of the check are stopped."""
    start = time.monotonic()
    posix = os.name == "posix"
    with tempfile.TemporaryFile() as output:
        proc = subprocess.Popen(command, shell=True, cwd=root, stdin=subprocess.DEVNULL,
                                stdout=output, stderr=subprocess.STDOUT, start_new_session=posix)
        timed_out = False
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
        if posix:
            with contextlib.suppress(OSError):
                os.killpg(proc.pid, signal.SIGTERM)  # stragglers, or the whole tree after a timeout
            if timed_out:
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    with contextlib.suppress(OSError):
                        os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()
        elif timed_out:
            proc.kill()
            proc.wait()
        seconds = time.monotonic() - start
        output.seek(0)
        text = ANSI.sub("", output.read().decode("utf-8", "replace"))
    lines = text.rstrip().splitlines()
    tail = "\n".join(lines[-TAIL_LINES:])[-TAIL_CHARS:]
    return {"ok": not timed_out and proc.returncode == 0, "code": 124 if timed_out else proc.returncode,
            "timed_out": timed_out, "seconds": seconds, "tail": tail}


# ---------------------------------------------------------------- modes
def read_hook_input() -> dict:
    try:
        data = json.load(sys.stdin)
        return data if isinstance(data, dict) else {}
    except (ValueError, OSError):
        return {}


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj))


def mode_mark(data: dict) -> int:
    if data.get("tool_name") not in EDIT_TOOLS:
        return 0
    root, _ = project_root(data.get("cwd") or os.getcwd())
    if not setting("HARNESS_VERIFY_CMD", root):
        return 0
    with locked_state(root) as state:
        sess = session_state(state, data.get("session_id", ""))
        sess["dirty"] = True
        sess["marks"] = sess.get("marks", 0) + 1
    return 0


def mode_stop(data: dict) -> int:
    root, is_git = project_root(data.get("cwd") or os.getcwd())
    command = setting("HARNESS_VERIFY_CMD", root)
    if not command or is_off(setting("HARNESS_STOP_GATE", root)):
        return 0
    if any((t or {}).get("type") in BUSY_TASK_TYPES for t in data.get("background_tasks") or []):
        return 0                                    # agents still working: check when they finish
    session_id = data.get("session_id", "")
    with locked_state(root) as state:
        sess = session_state(state, session_id)
        if not sess.get("dirty"):
            return 0
        marks = sess.get("marks", 0)
        prompt = data.get("prompt_id") or ""
        if prompt != sess.get("prompt"):
            sess["prompt"], sess["blocks"] = prompt, 0
        blocks = sess.get("blocks", 0)
        passed = list(state.get("passed", []))

    key = pass_key(fingerprint(root) if is_git else None, command)
    if key and key in passed:
        result = None                               # this exact tree already passed this command
    else:
        result = run_checks(command, root, verify_timeout(root))   # no lock held while checks run

    with locked_state(root) as state:
        sess = session_state(state, session_id)
        if sess.get("marks", 0) == marks:
            sess["dirty"] = False                   # nothing new arrived while we were checking
        if result and result["ok"]:
            # Only the tree the check started from counts: changes made while it ran were not checked.
            if key and key not in state.setdefault("passed", []):
                state["passed"].append(key)
            sess["blocks"] = 0
        elif result and not result["timed_out"]:
            sess["blocks"] = sess.get("blocks", 0) + 1

    if result is None:
        return 0
    if result["ok"]:
        emit({"systemMessage": f"claude-harness: checks passed ({result['seconds']:.1f}s)"})   # user-facing only
        return 0
    if result["timed_out"]:
        emit({"systemMessage": f"claude-harness: verification timed out after {result['seconds']:.0f}s; the gate was skipped. "
                               "Make HARNESS_VERIFY_CMD faster or raise HARNESS_VERIFY_TIMEOUT."})
        return 0
    if blocks >= MAX_BLOCKS_PER_PROMPT:
        emit({"systemMessage": f"claude-harness: verification is still failing after {MAX_BLOCKS_PER_PROMPT} attempts; "
                               "the gate let this turn end. Run the checks yourself before relying on these changes."})
        return 0
    reason = (
        f"claude-harness verification gate: `{command}` failed (exit {result['code']}, {result['seconds']:.1f}s) "
        f"on the current working tree.\n--- output (last lines) ---\n{result['tail']}\n--- end of output ---\n"
        "The task is not complete while this check fails. Fix the cause without weakening or skipping the check. "
        "If the failure is pre-existing or outside this task, or you are pausing to ask the user something, "
        "say so plainly in your reply instead of editing further; the turn can then end."
    )
    emit({"hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": reason}})
    return 0


def mode_verify() -> int:
    root, is_git = project_root(os.getcwd())
    command = setting("HARNESS_VERIFY_CMD", root)
    if not command:
        print("claude-harness verify: HARNESS_VERIFY_CMD is not set. Add it to the \"env\" block of "
              ".claude/settings.json (or run /harness-setup in Claude Code).", file=sys.stderr)
        return 2
    key = pass_key(fingerprint(root) if is_git else None, command)
    result = run_checks(command, root, verify_timeout(root))
    if result["ok"]:
        if key:
            try:
                with locked_state(root) as state:
                    if key not in state.setdefault("passed", []):
                        state["passed"].append(key)
            except (OSError, RuntimeError) as exc:      # e.g. a sandbox that cannot write the cache
                print(f"claude-harness verify: result not cached ({exc})", file=sys.stderr)
        print(f"claude-harness verify: PASS ({result['seconds']:.1f}s) `{command}`")
        return 0
    status = "TIMEOUT" if result["timed_out"] else f"FAIL (exit {result['code']})"
    print(f"claude-harness verify: {status} after {result['seconds']:.1f}s `{command}`\n{result['tail']}")
    return result["code"] or 1


def main(argv: list[str]) -> int:
    mode = argv[1] if len(argv) > 1 else ""
    if mode == "mark":
        return mode_mark(read_hook_input())
    if mode == "stop":
        return mode_stop(read_hook_input())
    if mode == "verify":
        return mode_verify()
    print("usage: quality_gate.py {mark|stop|verify}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except Exception as exc:                        # visible, non-blocking hook error
        print(f"claude-harness quality gate: internal error: {exc!r}", file=sys.stderr)
        sys.exit(1)
