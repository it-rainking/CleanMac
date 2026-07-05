"""Test executor.py — SOLO contro la fixture, mai contro il sistema (§7)."""

from __future__ import annotations

from pathlib import Path

from core import executor, scanner


def _entry(**kw) -> scanner.Entry:
    base = dict(id="t", category="c", category_label="C")
    base.update(kw)
    return scanner.Entry(**base)


# --- empty_children --------------------------------------------------------------

def test_empty_children_dry_run_removes_nothing(fake_home):
    entry = _entry(path="~/Library/Caches", mode="empty_children")
    result = executor.empty_children(entry, execute=False)
    assert result.status == "DRY_RUN"
    assert result.bytes_freed == 3500
    assert (fake_home / "Library/Caches/app1/data.db").exists()


def test_empty_children_execute_removes_children_keeps_dir(fake_home):
    entry = _entry(path="~/Library/Caches", mode="empty_children")
    result = executor.empty_children(entry, execute=True)
    assert result.status == "OK"
    assert result.bytes_freed == 3500
    root = fake_home / "Library/Caches"
    assert root.is_dir()                      # mai la cartella
    assert list(root.iterdir()) == []         # svuota contenuti


def test_empty_children_symlink_removed_target_intact(fake_home):
    root = fake_home / "Library/Caches"
    (root / "link_out").symlink_to(fake_home / "Documents")
    result = executor.empty_children(_entry(path="~/Library/Caches"), execute=True)
    assert result.status == "OK"
    assert not (root / "link_out").exists()
    # il target del link è INTATTO
    assert (fake_home / "Documents/important.txt").exists()


def test_empty_children_blocked_child_refused(fake_home):
    root = fake_home / "Library/Caches"
    bad = root / "x.photoslibrary"
    bad.mkdir()
    (bad / "photo.jpg").write_bytes(b"p" * 10)
    result = executor.empty_children(_entry(path="~/Library/Caches"), execute=True)
    assert bad.exists()                       # rifiutato dal guard
    assert (bad / "photo.jpg").exists()
    assert "photoslibrary" in (result.error or "")


def test_empty_children_refuses_non_whitelisted_root(fake_home):
    """Difesa in profondità: anche una Entry costruita a mano viene rifiutata."""
    entry = _entry(path="~/Downloads", mode="empty_children")
    result = executor.empty_children(entry, execute=True)
    assert result.status == "SKIPPED"
    assert "empty_children rifiutato" in result.error
    assert (fake_home / "Downloads/installer.dmg").exists()


def test_empty_children_missing_path(fake_home):
    result = executor.empty_children(_entry(path="~/NonEsiste"), execute=True)
    assert result.status == "SKIPPED"


def test_empty_children_unreadable_root_is_error_not_crash(fake_home, monkeypatch):
    """PermissionError sulla radice → ERROR, la sessione continua (§6)."""
    import os as os_mod
    def deny(path):
        raise PermissionError(13, "Permission denied", str(path))
    monkeypatch.setattr(os_mod, "scandir", deny)
    result = executor.empty_children(_entry(path="~/Library/Caches"), execute=True)
    assert result.status == "ERROR"
    assert "impossibile leggere" in result.error


def test_glob_delete_unreadable_root_is_error_not_crash(fake_home, monkeypatch):
    import os as os_mod
    def deny(path):
        raise PermissionError(13, "Permission denied", str(path))
    monkeypatch.setattr(os_mod, "scandir", deny)
    result = executor.glob_delete(
        _entry(path="~/Library/Logs/DiagnosticReports", mode="glob_delete",
               patterns=["*.crash"]), execute=True)
    assert result.status == "ERROR"


# --- glob_delete ------------------------------------------------------------------

def test_glob_delete_only_matching_files(fake_home):
    entry = _entry(path="~/Library/Logs/DiagnosticReports", mode="glob_delete",
                   patterns=["*.crash"])
    result = executor.glob_delete(entry, execute=True)
    assert result.status == "OK" and result.bytes_freed == 150
    reports = fake_home / "Library/Logs/DiagnosticReports"
    assert not (reports / "crash1.crash").exists()
    assert (reports / "note.txt").exists()    # non matcha: intatto


def test_glob_delete_dry_run(fake_home):
    entry = _entry(path="~/Library/Logs/DiagnosticReports", mode="glob_delete",
                   patterns=["*.crash"])
    result = executor.glob_delete(entry, execute=False)
    assert result.status == "DRY_RUN" and result.bytes_freed == 150
    assert (fake_home / "Library/Logs/DiagnosticReports/crash1.crash").exists()


def test_glob_delete_missing_path(fake_home):
    result = executor.glob_delete(_entry(path="~/Nope", mode="glob_delete",
                                         patterns=["*.gz"]), execute=True)
    assert result.status == "SKIPPED"


# --- glob_review ------------------------------------------------------------------

def test_glob_review_without_selection_skips(fake_home):
    entry = _entry(path="~/Downloads", mode="glob_review", patterns=["*.dmg"])
    result = executor.glob_review(entry, selected=[], execute=True)
    assert result.status == "SKIPPED"
    assert "selezione manuale" in result.error
    assert (fake_home / "Downloads/installer.dmg").exists()


def test_glob_review_deletes_only_selected(fake_home):
    entry = _entry(path="~/Downloads", mode="glob_review", patterns=["*.dmg", "*.pkg"])
    target = str(fake_home / "Downloads/installer.dmg")
    result = executor.glob_review(entry, selected=[target], execute=True)
    assert result.status == "OK" and result.bytes_freed == 5000
    assert not Path(target).exists()
    assert (fake_home / "Downloads/big.pkg").exists()   # non selezionato: intatto


def test_glob_review_refuses_file_outside_root(fake_home):
    entry = _entry(path="~/Downloads", mode="glob_review", patterns=["*"])
    outside = str(fake_home / "Documents/important.txt")
    result = executor.glob_review(entry, selected=[outside], execute=True)
    assert result.bytes_freed == 0
    assert "fuori da" in result.error
    assert Path(outside).exists()


def test_glob_review_refuses_non_matching_pattern(fake_home):
    entry = _entry(path="~/Downloads", mode="glob_review", patterns=["*.dmg"])
    target = str(fake_home / "Downloads/notes.txt")
    result = executor.glob_review(entry, selected=[target], execute=True)
    assert "non matcha" in result.error
    assert Path(target).exists()


def test_glob_review_dry_run(fake_home):
    entry = _entry(path="~/Downloads", mode="glob_review", patterns=["*.dmg"])
    target = str(fake_home / "Downloads/installer.dmg")
    result = executor.glob_review(entry, selected=[target], execute=False)
    assert result.status == "DRY_RUN" and result.bytes_freed == 5000
    assert Path(target).exists()


# --- delegate ---------------------------------------------------------------------

def test_delegate_dry_run():
    entry = _entry(mode="delegate", command="brew cleanup --prune=all")
    result = executor.delegate(entry, execute=False)
    assert result.status == "DRY_RUN"
    assert any("brew cleanup" in d for d in result.details)


def test_delegate_require_explicit_unconfirmed():
    entry = _entry(mode="delegate", command="docker system prune -a --force",
                   require_explicit=True)
    result = executor.delegate(entry, execute=True, confirmed=False)
    assert result.status == "SKIPPED"
    assert "require_explicit" in result.error


def test_delegate_missing_tool():
    entry = _entry(mode="delegate", command="strumento-inesistente-xyz clean")
    result = executor.delegate(entry, execute=True)
    assert result.status == "SKIPPED" and "non installato" in result.error


def test_delegate_runs_command():
    entry = _entry(mode="delegate", command="true")
    assert executor.delegate(entry, execute=True).status == "OK"


def test_delegate_command_failure():
    entry = _entry(mode="delegate", command="false")
    assert executor.delegate(entry, execute=True).status == "ERROR"


def test_delegate_without_command():
    result = executor.delegate(_entry(mode="delegate"), execute=True)
    assert result.status == "SKIPPED"


# --- run_entry (orchestrazione) ---------------------------------------------------

def test_run_entry_disabled_is_skipped(fake_home):
    entry = _entry(path="~/Documents", mode="empty_children",
                   disabled_reasons=["empty_children rifiutato"])
    result = executor.run_entry(entry, execute=True)
    assert result.status == "SKIPPED"
    assert (fake_home / "Documents/important.txt").exists()


def test_run_entry_conflict_skipped_no_kill(fake_home):
    entry = _entry(path="~/Library/Caches", mode="empty_children",
                   conflicts=["Safari"])
    result = executor.run_entry(entry, execute=True, _pgrep=lambda n: True)
    assert result.status == "SKIPPED"
    assert "Safari" in result.error
    assert (fake_home / "Library/Caches/app1/data.db").exists()


def test_run_entry_no_conflict_proceeds(fake_home):
    entry = _entry(path="~/Library/Caches", mode="empty_children",
                   conflicts=["Safari"])
    result = executor.run_entry(entry, execute=False, _pgrep=lambda n: False)
    assert result.status == "DRY_RUN"


def test_run_entry_unknown_mode(fake_home):
    result = executor.run_entry(_entry(path="~/Library/Caches", mode="marziano"))
    assert result.status == "SKIPPED" and "sconosciuto" in result.error


def test_run_entry_dispatches_glob_review(fake_home):
    entry = _entry(path="~/Downloads", mode="glob_review", patterns=["*.dmg"])
    result = executor.run_entry(entry, execute=False, selected=None)
    assert result.status == "SKIPPED"  # nessuna selezione → mai eliminazioni
