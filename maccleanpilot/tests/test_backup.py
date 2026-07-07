"""Test backup.py — comandi tmutil/rsync mockati, gate di esecuzione."""

from __future__ import annotations

import datetime as dt
import subprocess
from pathlib import Path

import pytest

from core import backup


def _proc(returncode=0, stdout="", stderr=""):
    return subprocess.CompletedProcess([], returncode, stdout, stderr)


def test_create_snapshot_parses_id():
    runner = lambda cmd, **k: _proc(0, "Created local snapshot with date: 2026-07-05-101530\n")
    assert backup.create_snapshot(_run_cmd=runner) == "2026-07-05-101530"


def test_create_snapshot_failure_raises():
    runner = lambda cmd, **k: _proc(1, "", "tmutil: not permitted")
    with pytest.raises(backup.BackupError, match="not permitted"):
        backup.create_snapshot(_run_cmd=runner)


def test_create_snapshot_unrecognized_output():
    runner = lambda cmd, **k: _proc(0, "boh")
    with pytest.raises(backup.BackupError, match="non riconosciuto"):
        backup.create_snapshot(_run_cmd=runner)


def test_list_snapshots():
    out = ("Snapshots for disk /:\n"
           "com.apple.TimeMachine.2026-07-04-090000.local\n"
           "com.apple.TimeMachine.2026-07-05-101530.local\n")
    runner = lambda cmd, **k: _proc(0, out)
    assert backup.list_snapshots(_run_cmd=runner) == ["2026-07-04-090000", "2026-07-05-101530"]


def test_list_snapshots_failure_empty():
    runner = lambda cmd, **k: _proc(1, "", "err")
    assert backup.list_snapshots(_run_cmd=runner) == []


def test_verify_finds_session_snapshot():
    out = "com.apple.TimeMachine.2026-07-05-101530.local\n"
    runner = lambda cmd, **k: _proc(0, out)
    session_start = dt.datetime(2026, 7, 5, 10, 15, 0)
    assert backup.verify(session_start, _run_cmd=runner) == "2026-07-05-101530"


def test_verify_rejects_old_snapshot():
    """Il gate: uno snapshot di ieri NON sblocca la sessione di oggi."""
    out = "com.apple.TimeMachine.2026-07-04-090000.local\n"
    runner = lambda cmd, **k: _proc(0, out)
    session_start = dt.datetime(2026, 7, 5, 10, 0, 0)
    assert backup.verify(session_start, _run_cmd=runner) is None


def test_verify_no_snapshots():
    runner = lambda cmd, **k: _proc(0, "")
    assert backup.verify(dt.datetime.now(), _run_cmd=runner) is None


def test_volume_mounted(tmp_path):
    root = tmp_path / "Dati" / "Backup_PrePulizia"
    assert not backup.volume_mounted(root)
    root.parent.mkdir(parents=True)
    assert backup.volume_mounted(root)


def test_rsync_backup_volume_not_mounted(tmp_path):
    root = tmp_path / "NonMontato" / "Backup_PrePulizia"
    ok, dest, err = backup.rsync_backup(["/tmp/x"], dest_root=root)
    assert not ok and "non montato" in err


def test_rsync_backup_success(tmp_path, fake_home):
    root = tmp_path / "Dati" / "Backup_PrePulizia"
    root.parent.mkdir(parents=True)
    calls = []
    def runner(cmd, **k):
        calls.append(cmd)
        return _proc(0)
    ok, dest, err = backup.rsync_backup(
        [str(fake_home / "Downloads")], dest_root=root, _run_cmd=runner
    )
    assert ok and err is None
    assert Path(dest).is_dir()
    assert calls and calls[0][0] == "rsync"


def test_rsync_backup_skips_missing_sources(tmp_path):
    root = tmp_path / "Dati" / "Backup_PrePulizia"
    root.parent.mkdir(parents=True)
    calls = []
    def runner(cmd, **k):
        calls.append(cmd)
        return _proc(0)
    ok, _, err = backup.rsync_backup(["/percorso/inesistente"], dest_root=root, _run_cmd=runner)
    assert ok and calls == []


def test_rsync_backup_reports_errors(tmp_path, fake_home):
    root = tmp_path / "Dati" / "Backup_PrePulizia"
    root.parent.mkdir(parents=True)
    runner = lambda cmd, **k: _proc(23, "", "rsync: permission denied")
    ok, _, err = backup.rsync_backup([str(fake_home / "Downloads")],
                                     dest_root=root, _run_cmd=runner)
    assert not ok and "permission denied" in err


def test_run_backup_combines(monkeypatch, tmp_path, fake_home):
    root = tmp_path / "Dati" / "Backup_PrePulizia"
    root.parent.mkdir(parents=True)
    monkeypatch.setattr(backup, "BACKUP_ROOT", root)
    def runner(cmd, **k):
        if cmd[0] == "tmutil" and cmd[1] == "localsnapshot":
            return _proc(0, "Created local snapshot with date: 2026-07-05-120000")
        return _proc(0)
    status = backup.run_backup([str(fake_home / "Downloads")], _run_cmd=runner)
    assert status.snapshot_id == "2026-07-05-120000"
    assert status.rsync_ok
