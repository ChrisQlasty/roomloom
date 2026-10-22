"""Filesystem locations shared by tests."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
EXAMPLE_PROJECT = REPO_ROOT / "projects" / "example-l-house"
