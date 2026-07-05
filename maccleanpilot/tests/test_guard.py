"""Test guard.py — copertura obbligatoria 100% (§7)."""

from __future__ import annotations

import subprocess

import pytest

from core import guard


# --- is_blocked ---------------------------------------------------------------

@pytest.mark.parametrize("path", [
    "~/Library/Application Support",
    "~/Library/Application Support/app1",
    "~/Library/Keychains/login.keychain-db",
    "~/Library/CloudStorage/Dropbox",
    "~/.ollama/models",
    "/System/Library",
    "/Library/Extensions/foo.kext",
])
def test_blocklist_prefixes(fake_home, path):
    verdict = guard.is_blocked(path)
    assert not verdict
    assert "blocklist" in verdict.reason


@pytest.mark.parametrize("path", [
    "~/Pictures/Foto.photoslibrary",
    "~/Pictures/Foto.photoslibrary/database",
    "/Volumes/TM/Backups.backupdb",
    "/Volumes/TM/mac.backupbundle/bands",
    "~/VMs/disk.qcow2",
    "~/Parallels/win.pvm",
    "~/VirtualBox/ubuntu.vdi",
])
def test_blocklist_patterns(fake_home, path):
    verdict = guard.is_blocked(path)
    assert not verdict
    assert "pattern" in verdict.reason


def test_blocklist_pattern_case_insensitive(fake_home):
    assert not guard.is_blocked("~/Pictures/FOTO.PHOTOSLIBRARY")


@pytest.mark.parametrize("path", [
    "~/Library/Caches",
    "~/Library/Logs",
    "/Library/Caches",
    "/private/var/log",
    "~/Downloads",
])
def test_blocklist_allows_whitelisted_areas(fake_home, path):
    assert guard.is_blocked(path)


def test_blocklist_follows_symlink_target(fake_home):
    """Un symlink che punta dentro un'area bloccata è bloccato (realpath)."""
    link = fake_home / "Library/Caches/sneaky"
    link.symlink_to(fake_home / "Library/Application Support")
    assert not guard.is_blocked(link)


# --- scope sudo e radici empty_children ----------------------------------------

def test_sudo_scope_allowed():
    assert guard.check_sudo_scope("/Library/Caches/com.apple.foo")
    assert guard.check_sudo_scope("/Library/Logs")
    assert guard.check_sudo_scope("/private/var/log/system.log.1.gz")


def test_sudo_scope_denied(fake_home):
    verdict = guard.check_sudo_scope(str(fake_home / "Library/Caches"))
    assert not verdict
    assert "sudo fuori scope" in verdict.reason


def test_empty_children_roots_allowed(fake_home):
    assert guard.check_empty_children_root("~/Library/Caches")
    assert guard.check_empty_children_root("~/Library/Developer/Xcode/DerivedData")
    assert guard.check_empty_children_root("/Library/Caches")
    assert guard.check_empty_children_root("/private/var/log")


def test_empty_children_root_denied(fake_home):
    verdict = guard.check_empty_children_root("~/Downloads")
    assert not verdict
    assert "empty_children rifiutato" in verdict.reason
    assert not guard.check_empty_children_root("~/Documents")
    assert not guard.check_empty_children_root("/usr/local")


# --- check_child (difesa symlink, per-figlio) ----------------------------------

def test_check_child_regular_file_ok(fake_home):
    root = fake_home / "Library/Caches"
    assert guard.check_child(root / "app1", root)


def test_check_child_outside_root(fake_home):
    root = fake_home / "Library/Caches"
    verdict = guard.check_child(fake_home / "Documents/important.txt", root)
    assert not verdict
    assert "non è dentro" in verdict.reason


def test_check_child_symlink_to_outside_is_allowed_as_link(fake_home):
    """Il link può essere rimosso (unlink), il target no: verdetto OK."""
    root = fake_home / "Library/Caches"
    link = root / "escape"
    link.symlink_to(fake_home / "Documents")
    assert guard.check_child(link, root)


def test_check_child_symlink_to_blocklist_refused(fake_home):
    root = fake_home / "Library/Caches"
    link = root / "to_appsupport"
    link.symlink_to(fake_home / "Library/Application Support")
    verdict = guard.check_child(link, root)
    assert not verdict


def test_check_child_symlink_escape_via_ancestor(fake_home):
    """Figlio non-symlink il cui realpath esce dalla radice → rifiuto hard."""
    root = fake_home / "Library/Caches"
    (root / "sublink").symlink_to(fake_home / "Documents")
    verdict = guard.check_child(root / "sublink" / "important.txt", root)
    assert not verdict
    assert "symlink escape" in verdict.reason


def test_check_child_blocked_pattern(fake_home):
    root = fake_home / "Library/Caches"
    bad = root / "x.photoslibrary"
    bad.mkdir()
    assert not guard.check_child(bad, root)


# --- validate_entry -------------------------------------------------------------

def test_validate_delegate_ok():
    assert guard.validate_entry({"id": "brew", "mode": "delegate", "command": "brew cleanup"}) == []


def test_validate_delegate_without_command():
    assert guard.validate_entry({"id": "x", "mode": "delegate"}) == ["delegate senza 'command'"]


def test_validate_missing_path():
    assert guard.validate_entry({"id": "x", "mode": "empty_children"}) == ["voce senza 'path'"]


def test_validate_blocked_path(fake_home):
    problems = guard.validate_entry(
        {"id": "x", "mode": "empty_children", "path": "~/Library/Keychains"}
    )
    assert any("blocklist" in p for p in problems)


def test_validate_empty_children_bad_root(fake_home):
    problems = guard.validate_entry({"id": "x", "mode": "empty_children", "path": "~/Documents"})
    assert any("empty_children rifiutato" in p for p in problems)


def test_validate_glob_without_patterns(fake_home):
    problems = guard.validate_entry({"id": "x", "mode": "glob_delete", "path": "~/Downloads"})
    assert problems == ["glob_delete senza 'patterns'"]
    problems = guard.validate_entry({"id": "x", "mode": "glob_review", "path": "~/Downloads"})
    assert problems == ["glob_review senza 'patterns'"]


def test_validate_sudo_out_of_scope(fake_home):
    problems = guard.validate_entry(
        {"id": "x", "mode": "empty_children", "path": "~/Library/Caches", "sudo": True}
    )
    assert any("sudo fuori scope" in p for p in problems)


def test_validate_good_entry(fake_home):
    assert guard.validate_entry(
        {"id": "ok", "mode": "empty_children", "path": "~/Library/Caches"}
    ) == []
    assert guard.validate_entry(
        {"id": "ok2", "mode": "glob_delete", "path": "/private/var/log",
         "patterns": ["*.gz"], "sudo": True}
    ) == []


# --- rilevamento conflitti (F6) --------------------------------------------------

def test_running_conflicts_injected():
    running = {"Safari"}
    result = guard.running_conflicts(["Safari", "Mail"], _pgrep=lambda n: n in running)
    assert result == ["Safari"]


def test_running_conflicts_empty():
    assert guard.running_conflicts([], _pgrep=lambda n: True) == []


def test_default_pgrep_not_running():
    assert guard._default_pgrep("processo-inesistente-xyz-123") is False


def test_default_pgrep_oserror(monkeypatch):
    def boom(*a, **k):
        raise OSError("no pgrep")
    monkeypatch.setattr(subprocess, "run", boom)
    assert guard._default_pgrep("qualsiasi") is False


def test_verdict_bool_and_reason():
    ok = guard.GuardVerdict(True)
    ko = guard.GuardVerdict(False, "motivo")
    assert bool(ok) and not bool(ko)
    assert ko.reason == "motivo"
