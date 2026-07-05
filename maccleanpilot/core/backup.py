"""backup.py — F3: snapshot APFS + rsync mirato + gate di esecuzione.

Il gate (§3): EXECUTE è raggiungibile solo se verify() conferma uno
snapshot APFS creato nella sessione corrente. Il bypass richiede il
doppio flag --skip-backup --i-know-what-i-am-doing e viene loggato.

Nota §9: gli snapshot APFS occupano spazio per ~24h, quindi subito dopo
la pulizia lo spazio libero può sembrare inferiore all'atteso.
"""

from __future__ import annotations

import datetime as dt
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

BACKUP_ROOT = Path("/Volumes/Dati/Backup_PrePulizia")
SNAPSHOT_RE = re.compile(r"com\.apple\.TimeMachine\.(\d{4}-\d{2}-\d{2}-\d{6})")


class BackupError(RuntimeError):
    pass


@dataclass
class BackupStatus:
    snapshot_id: str | None = None
    rsync_ok: bool = False
    rsync_dest: str | None = None
    rsync_error: str | None = None


def _run(cmd: list[str], timeout: int = 3600) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def create_snapshot(_run_cmd=None) -> str:
    """Crea uno snapshot APFS locale (`tmutil localsnapshot`) e ritorna l'id.

    L'output tipico è: 'Created local snapshot with date: 2026-07-05-101530'.
    """
    runner = _run_cmd or _run
    try:
        proc = runner(["tmutil", "localsnapshot"])
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise BackupError(f"tmutil non eseguibile: {exc}") from exc
    if proc.returncode != 0:
        raise BackupError(f"tmutil localsnapshot fallito: {proc.stderr.strip() or proc.stdout.strip()}")
    match = re.search(r"date:?\s*([\d-]+)", proc.stdout)
    if not match:
        raise BackupError(f"output tmutil non riconosciuto: {proc.stdout.strip()!r}")
    return match.group(1)


def list_snapshots(_run_cmd=None) -> list[str]:
    """Timestamp (YYYY-MM-DD-HHMMSS) degli snapshot locali presenti su /."""
    runner = _run_cmd or _run
    try:
        proc = runner(["tmutil", "listlocalsnapshots", "/"])
    except (OSError, subprocess.TimeoutExpired):
        return []  # fail-closed: nessuno snapshot → gate chiuso
    if proc.returncode != 0:
        return []
    return SNAPSHOT_RE.findall(proc.stdout)


def verify(session_started_at: dt.datetime, _run_cmd=None) -> str | None:
    """Il gate: ritorna l'id dello snapshot creato in QUESTA sessione, o None.

    Confronta i timestamp degli snapshot con l'inizio sessione (tolleranza
    60s all'indietro per skew di orologio/troncamento secondi).
    """
    threshold = session_started_at - dt.timedelta(seconds=60)
    for snap in list_snapshots(_run_cmd=_run_cmd):
        try:
            when = dt.datetime.strptime(snap, "%Y-%m-%d-%H%M%S")
        except ValueError:
            continue
        if when >= threshold:
            return snap
    return None


def volume_mounted(root: Path = BACKUP_ROOT) -> bool:
    """True se /Volumes/Dati è montato (il parent del backup root esiste)."""
    return root.parent.exists() and root.parent.is_dir()


def rsync_backup(paths: list[str], dest_root: Path | None = None, _run_cmd=None) -> tuple[bool, str, str | None]:
    """Copia mirata via rsync su /Volumes/Dati/Backup_PrePulizia/<data>.

    Ritorna (ok, destinazione, errore). Se il volume non è montato NON è
    fatale per lo snapshot (§6), ma il chiamante blocca `clean --execute`.
    """
    runner = _run_cmd or _run
    root = dest_root or BACKUP_ROOT
    if not volume_mounted(root):
        return False, str(root), f"volume '{root.parent}' non montato"

    dest = root / dt.date.today().isoformat()
    dest.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    for src in paths:
        if not Path(src).exists():
            continue
        proc = runner(["rsync", "-a", "--delete-excluded", src, str(dest) + "/"])
        if proc.returncode != 0:
            errors.append(f"{src}: {proc.stderr.strip()[:200]}")
    return (not errors), str(dest), ("; ".join(errors) or None)


def run_backup(rsync_sources: list[str], _run_cmd=None) -> BackupStatus:
    """F3 completo: snapshot APFS sempre; rsync se il volume è montato."""
    status = BackupStatus()
    status.snapshot_id = create_snapshot(_run_cmd=_run_cmd)
    ok, dest, err = rsync_backup(rsync_sources, _run_cmd=_run_cmd)
    status.rsync_ok = ok
    status.rsync_dest = dest
    status.rsync_error = err
    return status
