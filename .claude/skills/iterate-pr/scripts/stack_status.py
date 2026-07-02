#!/usr/bin/env python3
"""Report the health of a git-town stack — shell-agnostic (no zsh gotchas).

For every branch with a recorded git-town parent (lineage in local .git/config),
prints:
  - parent (lineage edge)
  - ahead/behind vs origin/<branch>
  - own-commit count (commits unique to the branch above its parent)
  - whether it is CLEANLY STACKED (parent tip is an ancestor of the branch) or
    DIVERGED (parent tip is NOT an ancestor — the branch was never rebased onto
    the current parent and needs a restack before propagation is meaningful)

Run from anywhere in the repo; operates purely on refs, independent of the
currently checked-out branch.

    uv run .claude/skills/iterate-pr/scripts/stack_status.py [--root <branch>]
"""

from __future__ import annotations

import argparse
import subprocess
import sys


def git(*args: str) -> str:
    """Run a git command, returning stripped stdout. Never goes through a shell,
    so branch names with slashes/dots and unmatched globs are non-issues."""
    result = subprocess.run(
        ["git", *args], capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def lineage() -> dict[str, str]:
    """child -> parent, from git-town's local config."""
    raw = git("config", "--get-regexp", r"^git-town-branch\..*\.parent$")
    edges: dict[str, str] = {}
    for line in raw.splitlines():
        if not line.strip():
            continue
        key, _, parent = line.partition(" ")
        # key = git-town-branch.<branch>.parent ; <branch> may contain dots/slashes
        branch = key[len("git-town-branch.") : -len(".parent")]
        edges[branch] = parent.strip()
    return edges


def ref_exists(ref: str) -> bool:
    return (
        subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", ref],
            capture_output=True,
            check=False,
        ).returncode
        == 0
    )


def ahead_behind(a: str, b: str) -> tuple[int, int]:
    """Return (behind, ahead) of b relative to a, i.e. counts for a...b."""
    out = git("rev-list", "--left-right", "--count", f"{a}...{b}")
    if not out:
        return (-1, -1)
    left, _, right = out.partition("\t")
    try:
        return (int(left), int(right))
    except ValueError:
        return (-1, -1)


def is_ancestor(ancestor: str, descendant: str) -> bool:
    return (
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", ancestor, descendant],
            capture_output=True,
            check=False,
        ).returncode
        == 0
    )


def count(range_expr: str) -> int:
    out = git("rev-list", "--count", range_expr)
    return int(out) if out.isdigit() else -1


def descendants(root: str, edges: dict[str, str]) -> set[str]:
    children: dict[str, list[str]] = {}
    for child, parent in edges.items():
        children.setdefault(parent, []).append(child)
    seen: set[str] = set()
    stack = [root]
    while stack:
        b = stack.pop()
        for c in children.get(b, []):
            if c not in seen:
                seen.add(c)
                stack.append(c)
    return seen


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--root",
        help="Only show this branch's subtree (default: every branch with lineage)",
    )
    args = ap.parse_args()

    edges = lineage()
    if not edges:
        print("No git-town lineage found. Run scripts/rebuild-stack-lineage.sh first.")
        return 1

    branches = sorted(edges)
    if args.root:
        subtree = descendants(args.root, edges) | {args.root}
        branches = [b for b in branches if b in subtree]

    diverged: list[str] = []
    print(f"{'branch':40} {'parent':28} {'behind/ahead':>12}  {'own':>4}  state")
    print("-" * 100)
    for b in branches:
        parent = edges[b]
        if not ref_exists(b):
            print(f"{b:40} {parent:28} {'(no local)':>12}")
            continue
        behind, ahead = ahead_behind(f"origin/{b}", b) if ref_exists(f"origin/{b}") else (-1, -1)
        ab = f"{behind}/{ahead}" if behind >= 0 else "no-origin"
        clean = is_ancestor(parent, b) if ref_exists(parent) else False
        own = count(f"{parent}..{b}") if ref_exists(parent) else -1
        state = "clean" if clean else "DIVERGED (restack)"
        if not clean:
            diverged.append(b)
        print(f"{b:40} {parent:28} {ab:>12}  {own:>4}  {state}")

    print("-" * 100)
    if diverged:
        print(f"\n⚠  {len(diverged)} branch(es) diverged from their parent (need a restack):")
        for b in diverged:
            print(f"     {b}  (parent {edges[b]} is not an ancestor)")
    else:
        print("\n✓ every branch is cleanly stacked on its parent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
