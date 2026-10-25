#!/usr/bin/env python3
"""claude-harness: PreToolUse guard for the Bash tool.

A deterministic floor for high-impact shell commands that Claude Code's native
permission rules cannot match robustly (reordered or abbreviated flags, `git -C dir push`,
pipelines such as `curl ... | sh`, commands hidden in `sh -c`, `$(...)`, heredocs or
`if ...; then` blocks). It never approves anything: it returns "deny" or "ask", or stays
silent so the normal permission flow applies.

Deliberately NOT duplicated here, because Claude Code already enforces them:
  * rm/rmdir on critical paths (root, home, working directory, ...)
  * writes to protected paths (.git, .claude, shell rc files, ...)
  * Read deny rules for secrets on cat/head/tail/sed/tee and redirects

Input:  PreToolUse hook JSON on stdin.
Output: one PreToolUse decision JSON object on stdout, or nothing.
Errors: a command it cannot parse gets "ask"; an unexpected internal error blocks the
        command (exit 2, fail closed). If python3 itself is missing the hook cannot start;
        Claude Code then treats it as a non-blocking error and only the native rules apply.
Opt out per person with HARNESS_GUARD=off (e.g. in .claude/settings.local.json "env").
Residual risk (documented in ARCHITECTURE.md): aliases, shell functions defined elsewhere,
scripts that call git internally, and commands assembled from variables are not visible here.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import sys

DENY = "deny"
ASK = "ask"

PIPE = {"|", "|&"}
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
PROTECTED_BRANCH = re.compile(r"^(main|master|trunk|production|prod|release([/-].*)?)$")
BLOCK_DEVICE = re.compile(r"^of=/dev/(r?disk\d|sd[a-z]|hd[a-z]|vd[a-z]|xvd[a-z]|nvme\d|mmcblk\d|loop\d|md\d|dm-\d|mapper/)")
# Words that start or continue a compound command; the command that follows them still runs.
RESERVED = {"if", "then", "elif", "else", "do", "while", "until", "!", "{", "}"}

# Wrappers that run their arguments as a command, with the options that take a value.
WRAPPERS = {
    "sudo": {"-u", "-g", "-h", "-p", "-C", "-D", "-r", "-t", "-T", "-U",
             "--user", "--group", "--host", "--prompt", "--chdir"},
    "doas": {"-u", "-C"},
    "env": {"-u", "--unset", "-C", "--chdir", "-S", "--split-string"},
    "timeout": {"-s", "-k", "--signal", "--kill-after"},
    "nice": {"-n", "--adjustment"},
    "xargs": {"-n", "-P", "-L", "-I", "-s", "-d", "-E", "-a"},
    "stdbuf": {"-i", "-o", "-e", "--input", "--output", "--error"},
    "nohup": set(), "time": set(), "command": set(), "builtin": set(), "exec": set(), "noglob": set(),
}
ELEVATE = {"sudo", "doas"}

# Outward-facing or hard-to-reverse commands: program -> words that need approval.
# Any argument position counts, so global flags such as `terraform -chdir=x apply`
# or `kubectl --context c delete` cannot hide the verb.
OUTWARD = {
    "npm": {"publish", "unpublish", "deprecate"},
    "pnpm": {"publish"},
    "yarn": {"publish"},
    "bun": {"publish"},
    "cargo": {"publish", "yank"},
    "twine": {"upload"},
    "uv": {"publish"},
    "poetry": {"publish"},
    "gem": {"push", "yank"},
    "docker": {"push"},
    "podman": {"push"},
    "terraform": {"apply", "destroy", "import"},
    "tofu": {"apply", "destroy", "import"},
    "pulumi": {"up", "destroy"},
    "kubectl": {"apply", "delete", "replace", "patch", "scale", "drain", "create"},
    "helm": {"install", "upgrade", "uninstall", "rollback", "delete"},
}
INTERPRETERS = {"sh", "bash", "zsh", "dash", "ksh", "fish", "python", "python3", "perl", "ruby",
                "node", "pwsh", "powershell", "iex"}
POSIX_SHELLS = {"sh", "bash", "zsh", "dash", "ksh"}
SHELL_WORD = re.compile(r"(^|[\s;&|(/])(sh|bash|zsh|dash|ksh)(\s|$)")
DOWNLOADERS = {"curl", "wget", "fetch", "iwr", "irm", "invoke-webrequest", "invoke-restmethod"}
SECRET_NAME = re.compile(
    r"(^|/)(\.env(\.[\w.-]+)?|\.envrc|\.netrc|\.pgpass|\.git-credentials|credentials(\.json)?|"
    r"id_(rsa|dsa|ecdsa|ed25519)|[^/]*\.(pem|key|p12|pfx|keystore|jks))$")
SECRET_OK = re.compile(r"\.(example|sample|template|dist|defaults?)$")
NAME_ONLY = {"ls", "stat", "test", "[", "touch", "file", "wc", "du", "echo", "printf",
             "basename", "dirname", "realpath", "readlink", "which", "type"}
WORD_BREAK = set(" \t\n;&|()")                    # after these, a new shell word starts


class Unparseable(Exception):
    pass


# ---------------------------------------------------------------- bash lexing
def _arith_end(text: str, i: int) -> int:
    """`i` points just after `((` (or `$((`); return the index after the matching `))`."""
    depth = 2
    while i < len(text):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise Unparseable("unclosed arithmetic expression")


def _ansi_c(text: str, i: int) -> tuple[str, int]:
    """Decode $'...' starting at the opening quote index `i`; return (value, index after it)."""
    simple = {"n": "\n", "t": "\t", "r": "\r", "a": "\a", "b": "\b", "e": "\x1b", "E": "\x1b",
              "f": "\f", "v": "\v", "\\": "\\", "'": "'", '"': '"', "?": "?"}
    out, i = [], i + 1
    while i < len(text):
        ch = text[i]
        if ch == "'":
            return "".join(out), i + 1
        if ch == "\\" and i + 1 < len(text):
            nxt = text[i + 1]
            if nxt in simple:
                out.append(simple[nxt])
                i += 2
                continue
            m = re.match(r"x([0-9A-Fa-f]{1,2})|u([0-9A-Fa-f]{1,4})|U([0-9A-Fa-f]{1,8})|([0-7]{1,3})", text[i + 1:])
            if m:
                out.append(chr(int(next(g for g in m.groups() if g), 8 if m.group(4) else 16)))
                i += 1 + m.end()
                continue
        out.append(ch)
        i += 1
    raise Unparseable("unclosed $'...'")


def _substitutions(text: str) -> list[str]:
    """Commands run by $(...) and `...` inside text that bash expands (unquoted heredocs)."""
    found, i = [], 0
    while i < len(text):
        if text[i] == "\\":
            i += 2
        elif text.startswith("$((", i):
            i = _arith_end(text, i + 3)
        elif text.startswith("$(", i):
            end = _scan(text, i + 2, nested=True)[0]
            found.append(text[i + 2:end - 1])
            i = end
        elif text[i] == "`":
            end = text.find("`", i + 1)
            if end == -1:
                raise Unparseable("unclosed backtick")
            found.append(text[i + 1:end])
            i = end + 1
        else:
            i += 1
    return found


def _scan(text: str, i: int, nested: bool) -> tuple[int, str, list[str], dict[str, str]]:
    """Scan bash text from index i. When `nested`, stop at the `)` that closes a $( or <(.

    Returns (index after the scanned part, flat text, inner scripts, process substitutions).
    """
    out: list[str] = []
    inner: list[str] = []
    procsubs: dict[str, str] = {}
    pending: list[tuple[str, bool, bool]] = []    # heredocs waiting for end of line: (delim, strip tabs, expands)
    line_start = 0
    quote = None
    word_start = True                             # an unquoted `#` here starts a comment
    depth = 0                                     # plain ( ) groups inside a nested scan
    n = len(text)
    while i < n:
        ch = text[i]
        if quote == "'":
            out.append(ch)
            quote = None if ch == "'" else quote
            i += 1
            continue
        if ch == "\\" and i + 1 < n:
            if text[i + 1] == "\n" and quote is None:
                i += 2                            # line continuation
                continue
            out.append(text[i:i + 2])
            word_start = False
            i += 2
            continue
        if text.startswith("$((", i):             # arithmetic: no commands, and `<<` is a shift
            i = _arith_end(text, i + 3)
            out.append("__ARITH__")
            word_start = False
            continue
        if text.startswith("$(", i):
            end, _flat, _inner, _procs = _scan(text, i + 2, nested=True)
            inner.append(text[i + 2:end - 1])     # analyzed on its own (bash resets quoting inside)
            out.append("__SUBST__")
            word_start = False
            i = end
            continue
        if ch == "`":
            end = text.find("`", i + 1)
            if end == -1:
                raise Unparseable("unclosed backtick")
            inner.append(text[i + 1:end])
            out.append("__SUBST__")
            word_start = False
            i = end + 1
            continue
        if quote == '"':
            out.append(ch)
            quote = None if ch == '"' else quote
            i += 1
            continue
        # ---- unquoted from here on
        if word_start and text.startswith("((", i):    # arithmetic command: (( x << 2 ))
            i = _arith_end(text, i + 2)
            out.append("__ARITH__")
            word_start = False
            continue
        if nested and ch == "(":
            depth += 1
        elif nested and ch == ")":
            if depth == 0:
                return i + 1, "".join(out), inner, procsubs
            depth -= 1
        if text.startswith("$'", i):              # ANSI-C quoting: decode so flags stay visible
            value, i = _ansi_c(text, i + 1)
            out.append(shlex.quote(value))
            word_start = False
            continue
        if text.startswith('$"', i):              # locale string: same as a double-quoted string
            i += 1
            continue
        if ch in "'\"":
            quote = ch
            out.append(ch)
            word_start = False
            i += 1
            continue
        if ch in "<>" and text.startswith("(", i + 1):            # process substitution
            end, _flat, _inner, _procs = _scan(text, i + 2, nested=True)
            key = f"__PROCSUB{len(procsubs)}__"
            procsubs[key] = text[i + 2:end - 1]
            inner.append(text[i + 2:end - 1])
            out.append(f" {key} ")
            word_start = False
            i = end
            continue
        if ch == "#" and word_start:
            while i < n and text[i] != "\n":
                i += 1                            # comment up to end of line
            continue
        if text.startswith("<<<", i):             # here-string, not a heredoc
            out.append("<<<")
            word_start = True
            i += 3
            continue
        if text.startswith("<<", i):
            j = i + 2
            strip_tabs = text.startswith("-", j)
            j += 1 if strip_tabs else 0
            while j < n and text[j] in " \t":
                j += 1
            k, delim, quoted = j, [], False
            while k < n and text[k] not in " \t\n;&|()<>":
                if text[k] in "'\"\\":
                    quoted = True
                else:
                    delim.append(text[k])
                k += 1
            if delim:
                pending.append(("".join(delim), strip_tabs, not quoted))
                out.append(" ")
                word_start = True
                i = k
                continue
        if ch == "\n" and pending:
            owner = "".join(out[line_start:])
            i += 1
            for delim, strip_tabs, expands in pending:
                body: list[str] = []
                while i < n:
                    end = text.find("\n", i)
                    line = text[i:] if end == -1 else text[i:end]
                    i = n if end == -1 else end + 1
                    if (line.lstrip("\t") if strip_tabs else line) == delim:
                        break
                    body.append(line)
                text_body = "\n".join(body)
                if SHELL_WORD.search(owner):
                    inner.append(text_body)       # the heredoc is a script fed to a shell
                elif expands:
                    inner.extend(_substitutions(text_body))   # unquoted heredocs run $(...)
            pending = []
            out.append("\n")
            line_start = len(out)
            word_start = True
            continue
        if ch == "\n":
            line_start = len(out) + 1
        out.append(ch)
        word_start = ch in WORD_BREAK
        i += 1
    if nested:
        raise Unparseable("unclosed parenthesis")
    if quote:
        raise Unparseable("unclosed quote")
    return n, "".join(out), inner, procsubs


def scan(command: str) -> tuple[str, list[str], dict[str, str]]:
    """Reduce a bash command to a flat string that shlex can tokenize safely.

    Removes comments, line continuations and heredoc bodies; pulls out the contents of
    $(...), `...` and <(...)/>(...) as separate scripts to analyze (heredoc bodies when the
    line feeding them runs a shell, and the substitutions inside unquoted heredocs).
    Decodes $'...'. Returns (flat command, inner scripts, {placeholder: process substitution}).
    Raises Unparseable on unclosed quotes or substitutions.
    """
    _end, flat, inner, procsubs = _scan(command, 0, nested=False)
    return flat, inner, procsubs


def tokenize(command: str) -> list[str] | None:
    """Shell-aware tokens; operators such as | && ; ( ) become separate tokens."""
    lexer = shlex.shlex(command.replace("\n", " \n "), posix=True, punctuation_chars=True)
    lexer.whitespace = " \t\r"           # newlines stay as tokens: they separate commands
    lexer.whitespace_split = True
    lexer.commenters = ""
    try:
        return list(lexer)
    except ValueError:                    # unbalanced quotes etc.
        return None


def is_separator(tok: str) -> bool:
    return tok == "\n" or (bool(tok) and set(tok) <= set(";&|()"))


def split_commands(tokens: list[str]) -> list[tuple[list[str], str, str]]:
    """Simple commands as (argv, operator before, operator after)."""
    out: list[tuple[list[str], str, str]] = []
    current: list[str] = []
    before = ""
    for tok in tokens:
        if is_separator(tok):
            if current:
                out.append((current, before, tok))
            current, before = [], tok
        else:
            current.append(tok)
    if current:
        out.append((current, before, ""))
    return out


def strip_prefixes(argv: list[str]) -> tuple[list[str], list[str], bool, str]:
    """Drop reserved words, env assignments and wrappers.

    Returns (argv, assignments, elevated, last wrapper).
    """
    assignments: list[str] = []
    elevated = False
    last = ""
    i = 0
    while i < len(argv):
        word = argv[i]
        base = os.path.basename(word)
        if word in RESERVED:
            i += 1
            continue
        if word == "function":                   # function name { ...
            i += 2
            continue
        if ASSIGNMENT.match(word):
            assignments.append(word)
            i += 1
            continue
        if base not in WRAPPERS:
            break
        last = base
        elevated = elevated or base in ELEVATE
        i += 1
        takes_value = WRAPPERS[base]
        while i < len(argv) and argv[i].startswith("-") and argv[i] != "-":
            i += 2 if argv[i] in takes_value else 1
        if base == "timeout" and i < len(argv):
            i += 1                        # the duration
    return argv[i:], assignments, elevated, last


# ---------------------------------------------------------------- option helpers
def short_flags(args: list[str]) -> str:
    """Concatenate single-dash flag clusters (-fdx -> 'fdx'); long options are ignored."""
    out = []
    for a in args:
        if a == "--":
            break
        if a.startswith("-") and not a.startswith("--") and len(a) > 1:
            out.append(a[1:])
    return "".join(out)


def has_long(args: list[str], full: str, min_len: int = 4) -> bool:
    """True if any argument is `full` or an abbreviation git would accept (git takes unique prefixes)."""
    for a in args:
        if a == "--":
            break
        if a.startswith("--"):
            name = a.split("=", 1)[0]
            if len(name) >= min_len and full.startswith(name):
                return True
    return False


def git_split(args: list[str]) -> tuple[list[str], str, list[str]]:
    """Separate git's global options (-C dir, -c k=v, ...) from the subcommand."""
    takes_value = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path",
                   "--config-env", "--super-prefix"}
    i = 0
    while i < len(args) and args[i].startswith("-"):
        i += 2 if args[i] in takes_value else 1
    if i >= len(args):
        return args, "", []
    return args[:i], args[i], args[i + 1:]


COMMIT_VALUE_SHORT = set("mFCct")
COMMIT_VALUE_LONG = ("--message", "--file", "--template", "--author", "--date", "--reuse-message",
                     "--reedit-message", "--fixup", "--squash", "--trailer", "--cleanup",
                     "--pathspec-from-file")


def commit_skips_hooks(args: list[str]) -> bool:
    """`git commit --no-verify` or `-n`, without mistaking a message value for flags."""
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--":
            break
        if a.startswith("--"):
            name = a.split("=", 1)[0]
            if len(name) >= 7 and "--no-verify".startswith(name):
                return True
            if "=" not in a and len(name) >= 4 and any(opt.startswith(name) for opt in COMMIT_VALUE_LONG):
                i += 1                                    # the next argument is the value
        elif a.startswith("-") and len(a) > 1:
            for j, ch in enumerate(a[1:], start=1):
                if ch == "n":
                    return True
                if ch in COMMIT_VALUE_SHORT:
                    if j == len(a) - 1:
                        i += 1                            # value in the next argument
                    break
        i += 1
    return False


def push_targets(rest: list[str]) -> list[str]:
    """Destination branch names of `git push <remote> <refspec>...`."""
    positional = [a for a in rest if not a.startswith("-")]
    targets = []
    for spec in positional[1:]:
        dst = spec.lstrip("+").split(":")[-1]
        targets.append(re.sub(r"^refs/heads/", "", dst))
    return targets


# ---------------------------------------------------------------- per-program checks
def check_git(args: list[str], assignments: list[str]) -> list[tuple[str, str]]:
    global_opts, sub, rest = git_split(args)
    findings: list[tuple[str, str]] = []
    if not sub:
        return findings
    hook_env = {"HUSKY", "HUSKY_SKIP_HOOKS", "SKIP", "PRE_COMMIT_ALLOW_NO_CONFIG"}
    if sub in ("commit", "push", "merge") and (
            any(a.split("=", 1)[0] in hook_env for a in assignments)
            or any(v.lower().startswith("core.hookspath") for v in global_opts)):
        findings.append((ASK, "git hooks are being disabled for this command"))
    if sub == "commit" and commit_skips_hooks(rest):
        findings.append((DENY, "`git commit --no-verify/-n` bypasses the project's commit hooks; fix the failing check instead"))
    if sub in ("push", "merge", "rebase", "cherry-pick", "am", "pull") and has_long(rest, "--no-verify", 7):
        findings.append((DENY, f"`git {sub} --no-verify` bypasses the project's git hooks; fix the failing check instead"))

    flags = short_flags(rest)
    force = "f" in flags or has_long(rest, "--force")
    if sub == "push":
        forced = (force or any(has_long(rest, opt) for opt in ("--force-with-lease", "--force-if-includes", "--mirror"))
                  or any(a.startswith("+") for a in rest))
        deleting = ("d" in flags or has_long(rest, "--delete") or has_long(rest, "--prune", 5)
                    or any(a.startswith(":") and len(a) > 1 for a in rest))
        protected = any(PROTECTED_BRANCH.match(ref) for ref in push_targets(rest))
        # A plain push is left to the native `Bash(git push *)` ask rule, which teams can relax in settings.
        if forced and protected:
            findings.append((DENY, "force-pushing to a protected branch (main/master/release/production) is not allowed from Claude"))
        elif forced or deleting:
            findings.append((ASK, "this push rewrites or deletes remote history"))
    elif sub == "reset" and has_long(rest, "--hard"):
        findings.append((ASK, "`git reset --hard` discards uncommitted changes"))
    elif sub == "clean" and force:
        findings.append((ASK, "`git clean -f` deletes untracked files"))
    elif sub == "checkout" and ("--" in rest or "." in rest or force):
        findings.append((ASK, "this checkout can discard local changes"))
    elif sub == "restore" and (not has_long(rest, "--staged") or has_long(rest, "--worktree")):
        findings.append((ASK, "`git restore` discards working-tree changes"))
    elif sub == "switch" and (has_long(rest, "--discard-changes") or force):
        findings.append((ASK, "this switch discards local changes"))
    elif sub == "branch" and ("D" in flags or (("d" in flags or has_long(rest, "--delete")) and force)):
        findings.append((ASK, "force-deleting a branch can lose unmerged commits"))
    elif sub == "stash" and rest[:1] in (["drop"], ["clear"]):
        findings.append((ASK, "dropping stashes loses saved work"))
    elif sub in ("filter-branch", "filter-repo"):
        findings.append((ASK, "this rewrites repository history"))
    elif (sub == "reflog" and rest[:1] == ["expire"]) or (sub == "update-ref" and "-d" in rest):
        findings.append((ASK, "this removes recovery points from the repository"))
    if sub == "add":
        findings += check_secret_access("git add", rest)
    return findings


def has_sequence(words: list[str], seq: list[str]) -> bool:
    return any(words[i:i + len(seq)] == seq for i in range(len(words)))


def check_gh(args: list[str]) -> list[tuple[str, str]]:
    words = [a for a in args if not a.startswith("-")]
    if has_sequence(words, ["pr", "merge"]):
        return [(ASK, "merging a pull request is visible to others")]
    if any(has_sequence(words, ["release", verb]) for verb in ("create", "delete", "edit", "upload", "delete-asset")):
        return [(ASK, "this changes a published release")]
    if any(has_sequence(words, ["repo", verb]) for verb in ("delete", "archive", "rename", "edit", "create")):
        return [(ASK, "this creates or changes a repository")]
    if "secret" in words[:2] or "variable" in words[:2]:
        return [(ASK, "this reads or changes repository secrets/variables")]
    if "api" in words[:2]:
        joined = " ".join(args)
        if (re.search(r"(-X|--method)[ =]?(POST|PUT|PATCH|DELETE)\b", joined, re.I)
                or re.search(r"(^| )(-f|-F|--field|--raw-field|--input)( |=)", joined)):
            return [(ASK, "`gh api` call that writes to GitHub")]
    return []


def check_secret_access(program: str, args: list[str]) -> list[tuple[str, str]]:
    if program in NAME_ONLY:
        return []
    for arg in args:
        candidate = arg
        if "=" in candidate and not candidate.startswith("."):
            candidate = candidate.split("=", 1)[1]           # --env-file=.env, -F file=@.env
        if "@" in candidate:
            candidate = candidate.rsplit("@", 1)[1]          # curl -d @.env, -d@.env
        candidate = candidate.lstrip("<")
        if SECRET_NAME.search(candidate) and not SECRET_OK.search(candidate):
            return [(ASK, f"`{program}` touches a file that usually holds secrets ({candidate})")]
    return []


def first_word(script: str) -> str:
    words = script.split()
    while words and ASSIGNMENT.match(words[0]):
        words.pop(0)
    return os.path.basename(words[0]).lower() if words else ""


def inline_script(program: str, args: list[str]) -> str | None:
    """The command string passed to `sh -c '...'` (also -lc, -ec, ...) or to `eval`."""
    if program == "eval":
        return " ".join(args)
    if program in POSIX_SHELLS:
        for i, a in enumerate(args):
            if a.startswith("-") and not a.startswith("--") and "c" in a[1:]:
                return args[i + 1] if i + 1 < len(args) else None
    return None


# ---------------------------------------------------------------- analysis
def analyze(command: str, depth: int = 0) -> list[tuple[str, str]]:
    findings: list[tuple[str, str]] = []
    if depth > 4:
        return [(ASK, "the command nests too deeply to check")]
    if re.search(r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:", command):
        findings.append((DENY, "fork bomb"))
    if re.search(r"\b(eval|sh|bash|zsh|dash|ksh)\s+(-c\s+)?[\"']?\$\((curl|wget)\b", command):
        findings.append((ASK, "runs a script downloaded from the network"))

    try:
        flat, inner, procsubs = scan(command)
    except Unparseable as exc:
        return findings + [(ASK, f"the command could not be parsed reliably ({exc})")]
    for script in inner:                  # $(...), `...`, <(...), heredocs fed to a shell
        findings += analyze(script, depth + 1)
    tokens = tokenize(flat)
    if tokens is None:                    # never wave through what could not be read
        return findings + [(ASK, "the command could not be parsed reliably")]
    downloaded = False                    # a downloader appeared earlier in the current pipeline
    for raw_argv, before, _after in split_commands(tokens):
        if before not in PIPE:
            downloaded = False
        argv, assignments, elevated, last_wrapper = strip_prefixes(raw_argv)
        if elevated:
            findings.append((ASK, "runs a command with elevated privileges (sudo/doas)"))
        if not argv:
            if last_wrapper == "env":     # bare `env` prints the environment
                findings.append((ASK, "prints environment variables, which may contain secrets"))
            continue
        program = os.path.basename(argv[0]).lower()
        args = argv[1:]

        if program in DOWNLOADERS:
            downloaded = True
        elif downloaded and before in PIPE and program in INTERPRETERS:
            findings.append((ASK, "pipes a network download into an interpreter"))
        if program in INTERPRETERS | {"source", "."} and any(
                first_word(procsubs.get(a.strip(), "")) in DOWNLOADERS for a in args):
            findings.append((ASK, "runs a script downloaded from the network"))   # bash <(curl ...)
        script = inline_script(program, args)
        if script:
            findings += analyze(script, depth + 1)

        if program == "git":
            findings += check_git(args, assignments)
            continue
        if program == "gh":
            findings += check_gh(args)
        elif program in OUTWARD and OUTWARD[program] & set(args):
            verb = sorted(OUTWARD[program] & set(args))[0]
            findings.append((ASK, f"`{program} {verb}` publishes, deploys or changes shared infrastructure"))
        elif (program == "printenv"
              or (program in ("export", "declare", "typeset") and (not args or args[0] in ("-p", "-x", "-px")))
              or (program == "set" and not args)):
            findings.append((ASK, "prints environment variables, which may contain secrets"))
        elif program.startswith("mkfs") or (program == "dd" and any(BLOCK_DEVICE.match(a) for a in args)):
            findings.append((DENY, "writes directly to a block device"))
        elif program == "diskutil" and any(a.lower().startswith(("erase", "partition", "zerodisk", "secureerase")) for a in args):
            findings.append((DENY, "erases or repartitions a disk"))
        elif program in ("shutdown", "reboot", "halt", "poweroff"):
            findings.append((DENY, "shuts down or restarts the machine"))
        findings += check_secret_access(program, args)
    return findings


def decide(findings: list[tuple[str, str]]) -> dict | None:
    if not findings:
        return None
    level = DENY if any(lvl == DENY for lvl, _ in findings) else ASK
    reasons: list[str] = []
    for lvl, reason in findings:
        if lvl == level and reason not in reasons:
            reasons.append(reason)
    text = "; ".join(reasons[:3])
    if level == DENY:
        text = (f"claude-harness blocked this command: {text}. "
                "If it is genuinely required, explain why and ask the user to run it themselves.")
    else:
        text = f"claude-harness: confirmation required: {text}."
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                   "permissionDecision": level,
                                   "permissionDecisionReason": text}}


def main() -> int:
    if os.environ.get("HARNESS_GUARD", "").strip().lower() in ("off", "0", "false", "no"):
        return 0
    try:
        data = json.load(sys.stdin)
    except (ValueError, OSError) as exc:
        print(f"claude-harness guard: could not read hook input ({exc}); the command was blocked.", file=sys.stderr)
        return 2
    if data.get("tool_name") != "Bash":
        return 0
    command = (data.get("tool_input") or {}).get("command")
    if not isinstance(command, str) or not command.strip():
        return 0
    decision = decide(analyze(command))
    if decision:
        sys.stdout.write(json.dumps(decision))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:              # fail closed: a broken guard must not wave commands through
        print(f"claude-harness guard: internal error ({exc!r}); the command was blocked. "
              "Tell the user; they can set HARNESS_GUARD=off in .claude/settings.local.json until it is fixed.",
              file=sys.stderr)
        sys.exit(2)
