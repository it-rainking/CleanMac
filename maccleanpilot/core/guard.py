"""guard.py — difese hard-coded di MacCleanPilot.

Questo modulo è l'unico punto in cui si decide se un path è toccabile.
Le costanti sono chiuse nel codice (§1.5 e §9 del tech spec): NON sono
sovrascrivibili da catalog.yaml né da flag CLI. Qualunque voce di config
che risolve fuori da queste regole viene rifiutata a runtime.

Copertura test richiesta: 100% (vedi §7 del tech spec).
"""

from __future__ import annotations

import fnmatch
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

# --- Blocklist hard-coded (§1.5) — prefissi di path mai toccabili ------------
# I path con ~ vengono espansi a runtime rispetto alla HOME corrente.
BLOCKLIST_PREFIXES: tuple[str, ...] = (
    "~/Library/Application Support",
    "~/Library/Keychains",
    "~/Library/CloudStorage",
    "~/.ollama",
    "/System",
    "/Library/Extensions",
)

# Pattern (fnmatch, case-insensitive) rifiutati ovunque compaiano nel path.
BLOCKLIST_PATTERNS: tuple[str, ...] = (
    "*.photoslibrary",
    "Backups.backupdb",
    "*.backupbundle",
    "*.qcow2",
    "*.pvm",
    "*.vdi",
)

# --- Scope sudo chiuso (§2.2) — le sole aree in cui è ammesso sudo -----------
SUDO_ALLOWED_ROOTS: tuple[str, ...] = (
    "/Library/Caches",
    "/Library/Logs",
    "/private/var/log",
)

# --- Radici ammesse per mode: empty_children (§9, redteam) -------------------
EMPTY_CHILDREN_ROOTS: tuple[str, ...] = (
    "~/Library",
    "/Library/Caches",
    "/Library/Logs",
    "/private/var/log",
)


@dataclass
class GuardVerdict:
    """Esito di una verifica: ok True/False + motivo leggibile per il log."""

    ok: bool
    reason: str = ""

    def __bool__(self) -> bool:  # permette `if guard.check(...):`
        return self.ok


def _expand(p: str) -> Path:
    """Espande ~ e normalizza senza risolvere symlink (per confronti lessicali)."""
    return Path(os.path.expanduser(p))


def _is_under(child: Path, root: Path) -> bool:
    """True se child == root o child è dentro root (confronto lessicale)."""
    try:
        child.relative_to(root)
        return True
    except ValueError:
        return False


def is_blocked(path: str | os.PathLike) -> GuardVerdict:
    """Verifica un path contro blocklist prefissi e pattern.

    Il path viene risolto (realpath) prima del confronto: un symlink che
    punta dentro un'area bloccata è bloccato quanto l'area stessa.
    """
    raw = _expand(str(path))
    resolved = Path(os.path.realpath(raw))

    for candidate in {raw, resolved}:
        for prefix in BLOCKLIST_PREFIXES:
            if _is_under(candidate, _expand(prefix)):
                return GuardVerdict(False, f"blocklist: dentro '{prefix}'")
        for part in candidate.parts:
            for pattern in BLOCKLIST_PATTERNS:
                if fnmatch.fnmatch(part.lower(), pattern.lower()):
                    return GuardVerdict(False, f"blocklist: pattern '{pattern}'")
    return GuardVerdict(True)


def check_sudo_scope(path: str | os.PathLike) -> GuardVerdict:
    """Un'operazione sudo è ammessa solo dentro SUDO_ALLOWED_ROOTS."""
    resolved = Path(os.path.realpath(_expand(str(path))))
    for root in SUDO_ALLOWED_ROOTS:
        if _is_under(resolved, Path(root)):
            return GuardVerdict(True)
    return GuardVerdict(False, f"sudo fuori scope: '{path}' non è in {SUDO_ALLOWED_ROOTS}")


def check_empty_children_root(path: str | os.PathLike) -> GuardVerdict:
    """mode: empty_children è ammesso solo sotto le radici chiuse (§9)."""
    resolved = Path(os.path.realpath(_expand(str(path))))
    raw = _expand(str(path))
    for root in EMPTY_CHILDREN_ROOTS:
        expanded_root = _expand(root)
        if _is_under(raw, expanded_root) or _is_under(resolved, expanded_root):
            return GuardVerdict(True)
    return GuardVerdict(False, f"empty_children rifiutato: '{path}' fuori dalle radici ammesse")


def check_child(child: str | os.PathLike, entry_root: str | os.PathLike) -> GuardVerdict:
    """Verifica per-figlio eseguita subito PRIMA di ogni eliminazione (§2.2).

    Difesa da symlink escape: il realpath del figlio deve stare dentro il
    realpath della radice della voce, salvo il caso in cui il figlio sia
    esso stesso un symlink — in quel caso è ammesso eliminare SOLO il link
    (mai il target), quindi il check si applica al path lessicale del link.
    """
    child_p = _expand(str(child))
    root_resolved = Path(os.path.realpath(_expand(str(entry_root))))

    # Il figlio deve essere lessicalmente un discendente diretto della radice.
    if not _is_under(child_p, root_resolved) and not _is_under(
        child_p, _expand(str(entry_root))
    ):
        return GuardVerdict(False, f"'{child}' non è dentro '{entry_root}'")

    blocked = is_blocked(child_p)
    if not blocked:
        return blocked

    if not child_p.is_symlink():
        # File o directory reale: il realpath deve restare dentro la radice.
        resolved = Path(os.path.realpath(child_p))
        if not _is_under(resolved, root_resolved):
            return GuardVerdict(False, f"symlink escape: '{child}' risolve fuori da '{entry_root}'")
    # Symlink: verrà rimosso solo il link (os.unlink), mai seguito.
    return GuardVerdict(True)


def validate_entry(entry: dict) -> list[str]:
    """Valida una voce del catalogo al load. Ritorna la lista dei problemi.

    Una voce con problemi viene disabilitata (mai eseguita) e loggata WARN.
    """
    problems: list[str] = []
    mode = entry.get("mode", "empty_children")
    path = entry.get("path")

    if mode == "delegate":
        if not entry.get("command"):
            problems.append("delegate senza 'command'")
        return problems

    if not path:
        problems.append("voce senza 'path'")
        return problems

    blocked = is_blocked(path)
    if not blocked:
        problems.append(blocked.reason)

    if mode == "empty_children":
        root_ok = check_empty_children_root(path)
        if not root_ok:
            problems.append(root_ok.reason)

    if mode in ("glob_delete", "glob_review") and not entry.get("patterns"):
        problems.append(f"{mode} senza 'patterns'")

    if entry.get("sudo"):
        sudo_ok = check_sudo_scope(path)
        if not sudo_ok:
            problems.append(sudo_ok.reason)

    return problems


# --- F6: rilevamento app in conflitto ----------------------------------------

def running_conflicts(process_names: list[str], _pgrep=None) -> list[str]:
    """Ritorna i nomi dei processi in conflitto attualmente in esecuzione.

    Usa `pgrep -xi <nome>` (match esatto case-insensitive). Mai kill
    automatico: il chiamante marca la voce SKIPPED (§6).
    `_pgrep` è iniettabile nei test.
    """
    runner = _pgrep or _default_pgrep
    return [name for name in process_names if runner(name)]


def _default_pgrep(name: str) -> bool:
    try:
        proc = subprocess.run(
            ["pgrep", "-xi", name], capture_output=True, timeout=10
        )
        return proc.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False
