"""Fixture di test (§7): sandbox che replica l'albero Library/Caches ecc.

REGOLA D'ORO: nessun test esegue mai `--execute` fuori da questa fixture.
Tutti i path passano da una HOME finta creata in tmp_path; il sistema
reale non viene mai toccato.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _mkfile(path: Path, size: int = 100) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)
    return path


@pytest.fixture
def fake_home(tmp_path, monkeypatch) -> Path:
    """HOME finta con l'albero della guida: Caches, Logs, Downloads, Desktop."""
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    # ~/Library/Caches con due app e una sottostruttura
    _mkfile(home / "Library/Caches/app1/data.db", 1000)
    _mkfile(home / "Library/Caches/app1/sub/blob.bin", 2000)
    _mkfile(home / "Library/Caches/app2/cache.tmp", 500)

    # ~/Library/Logs
    _mkfile(home / "Library/Logs/app.log", 300)
    _mkfile(home / "Library/Logs/DiagnosticReports/crash1.crash", 150)
    _mkfile(home / "Library/Logs/DiagnosticReports/note.txt", 50)

    # Dati che NON devono mai essere toccati
    _mkfile(home / "Documents/important.txt", 42)
    _mkfile(home / "Library/Application Support/app1/settings.json", 10)

    # ~/Downloads per glob_review
    _mkfile(home / "Downloads/installer.dmg", 5000)
    _mkfile(home / "Downloads/big.pkg", 8000)
    _mkfile(home / "Downloads/notes.txt", 10)
    _mkfile(home / "Desktop/archive.zip", 700)

    return home


@pytest.fixture
def tmp_db(tmp_path):
    return tmp_path / "history.db"
