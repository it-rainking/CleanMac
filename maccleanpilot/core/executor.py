"""executor.py — F5/F8: l'unico modulo che elimina qualcosa.

Regole non negoziabili (§1, §9):
- Dry-run di default: si elimina solo con execute=True esplicito.
- Svuota contenuti, mai cartelle: equivalente di `rm -rf <dir>/*`,
  mai `rm -rf <dir>`.
- Ogni figlio passa da guard.check_child (realpath) SUBITO prima
  dell'eliminazione: difesa da symlink escape e da config manomessa.
- I symlink vengono rimossi come link (unlink), mai seguiti.
- Errori sul singolo file → skip + log, la sessione continua (§6).
- Le voci sudo shellano `sudo /bin/rm` sul singolo figlio già validato;
  lo scope sudo è ri-verificato qui, non solo al load del catalogo.
"""

from __future__ import annotations

import fnmatch
import os
import shlex
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from . import guard
from .scanner import Entry, tree_size


@dataclass
class ActionResult:
    entry_id: str
    path: str
    mode: str
    bytes_freed: int = 0
    status: str = "OK"  # OK | DRY_RUN | SKIPPED | ERROR
    error: str | None = None
    details: list[str] = field(default_factory=list)


def _size_of(p: Path) -> int:
    try:
        if p.is_symlink():
            return 0
        if p.is_file():
            return p.stat().st_size
        if p.is_dir():
            return tree_size(p)[0]
    except OSError:
        pass
    return 0


def _remove_child(child: Path, sudo: bool, log: list[str]) -> tuple[int, str | None]:
    """Elimina un singolo figlio GIÀ validato. Ritorna (byte, errore)."""
    size = _size_of(child)
    try:
        if sudo:
            # Scope sudo chiuso: ri-verifica difensiva anche a runtime.
            scope = guard.check_sudo_scope(child)
            if not scope:
                return 0, scope.reason
            proc = subprocess.run(
                ["sudo", "/bin/rm", "-rf", "--", str(child)],
                capture_output=True, text=True, timeout=600,
            )
            if proc.returncode != 0:
                return 0, proc.stderr.strip()[:200] or "sudo rm fallito"
        elif child.is_symlink():
            child.unlink()  # solo il link, mai il target
        elif child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
        log.append(f"rimosso: {child}")
        return size, None
    except OSError as exc:  # file in uso / permesso negato: skip, si continua
        return 0, str(exc)


def empty_children(entry: Entry, execute: bool = False) -> ActionResult:
    """`rm -rf <dir>/*`: rimuove i figli diretti, mai la directory stessa."""
    root = entry.expanded_path()
    result = ActionResult(entry.id, str(root), entry.mode)
    if not root or not root.is_dir():
        result.status = "SKIPPED"
        result.error = "path inesistente o non directory"
        return result

    # Ridondante rispetto al load del catalogo, ma questo modulo non si
    # fida di nessuno: ri-verifica radice ammessa e blocklist.
    for verdict in (guard.check_empty_children_root(root), guard.is_blocked(root)):
        if not verdict:
            result.status = "SKIPPED"
            result.error = verdict.reason
            return result

    freed = 0
    errors: list[str] = []
    try:
        with os.scandir(root) as it:
            children = [Path(c.path) for c in it]
    except OSError as exc:  # permesso negato sulla radice: ERROR, non crash (§6)
        result.status = "ERROR"
        result.error = f"impossibile leggere '{root}': {exc}"
        return result
    for child in children:
        verdict = guard.check_child(child, root)
        if not verdict:
            errors.append(f"{child.name}: {verdict.reason}")
            result.details.append(f"RIFIUTATO {child}: {verdict.reason}")
            continue
        if not execute:
            freed += _size_of(child)
            result.details.append(f"[dry-run] eliminerei: {child}")
            continue
        size, err = _remove_child(child, entry.sudo, result.details)
        if err:
            errors.append(f"{child.name}: {err}")
        freed += size

    result.bytes_freed = freed
    result.status = "OK" if execute else "DRY_RUN"
    if errors:
        result.error = "; ".join(errors)[:500]
        if execute and freed == 0:
            result.status = "ERROR"
    return result


def glob_delete(entry: Entry, execute: bool = False) -> ActionResult:
    """Elimina solo i FILE diretti che matchano i pattern (es. *.gz in /var/log)."""
    root = entry.expanded_path()
    result = ActionResult(entry.id, str(root), entry.mode)
    if not root or not root.is_dir():
        result.status = "SKIPPED"
        result.error = "path inesistente o non directory"
        return result

    blocked = guard.is_blocked(root)
    if not blocked:
        result.status = "SKIPPED"
        result.error = blocked.reason
        return result

    freed = 0
    errors: list[str] = []
    try:
        with os.scandir(root) as it:
            candidates = [
                Path(c.path)
                for c in it
                if c.is_file(follow_symlinks=False)
                and any(fnmatch.fnmatch(c.name.lower(), p.lower()) for p in entry.patterns)
            ]
    except OSError as exc:
        result.status = "ERROR"
        result.error = f"impossibile leggere '{root}': {exc}"
        return result
    for child in candidates:
        verdict = guard.check_child(child, root)
        if not verdict:
            errors.append(f"{child.name}: {verdict.reason}")
            continue
        if not execute:
            freed += _size_of(child)
            result.details.append(f"[dry-run] eliminerei: {child}")
            continue
        size, err = _remove_child(child, entry.sudo, result.details)
        if err:
            errors.append(f"{child.name}: {err}")
        freed += size

    result.bytes_freed = freed
    result.status = "OK" if execute else "DRY_RUN"
    if errors:
        result.error = "; ".join(errors)[:500]
    return result


def glob_review(entry: Entry, selected: list[str], execute: bool = False) -> ActionResult:
    """Elimina SOLO i file esplicitamente selezionati dall'utente (F4).

    Usato per Downloads/Desktop dove i file sono dati, non cache: senza
    selezione esplicita non si elimina nulla, nemmeno in --execute.
    """
    root = entry.expanded_path()
    result = ActionResult(entry.id, str(root), entry.mode)
    if not selected:
        result.status = "SKIPPED"
        result.error = "nessun file selezionato (glob_review richiede selezione manuale)"
        return result
    if not root or not root.is_dir():
        result.status = "SKIPPED"
        result.error = "path inesistente o non directory"
        return result

    freed = 0
    errors: list[str] = []
    for raw in selected:
        child = Path(os.path.expanduser(raw))
        # Il file selezionato deve: stare nella dir della voce, matchare i
        # pattern della voce, superare il guard. Niente eccezioni.
        if child.parent != root:
            errors.append(f"{child}: fuori da {root}")
            continue
        if not any(fnmatch.fnmatch(child.name.lower(), p.lower()) for p in entry.patterns):
            errors.append(f"{child.name}: non matcha i pattern della voce")
            continue
        verdict = guard.check_child(child, root)
        if not verdict:
            errors.append(f"{child.name}: {verdict.reason}")
            continue
        if not child.is_file():
            errors.append(f"{child.name}: non è un file")
            continue
        if not execute:
            freed += _size_of(child)
            result.details.append(f"[dry-run] eliminerei: {child}")
            continue
        size, err = _remove_child(child, entry.sudo, result.details)
        if err:
            errors.append(f"{child.name}: {err}")
        freed += size

    result.bytes_freed = freed
    result.status = "OK" if execute else "DRY_RUN"
    if errors:
        result.error = "; ".join(errors)[:500]
    return result


def delegate(entry: Entry, execute: bool = False, confirmed: bool = False) -> ActionResult:
    """F8: comandi nativi (brew/pip/npm/docker). Mai rm diretti.

    Le voci require_explicit (docker system prune) richiedono conferma
    dedicata anche in modalità 'tutto': senza confirmed=True → SKIPPED.
    """
    result = ActionResult(entry.id, entry.command or "", entry.mode)
    if not entry.command:
        result.status = "SKIPPED"
        result.error = "delegate senza comando"
        return result
    if entry.require_explicit and not confirmed:
        result.status = "SKIPPED"
        result.error = "richiede conferma dedicata (require_explicit)"
        return result
    if not execute:
        result.status = "DRY_RUN"
        result.details.append(f"[dry-run] eseguirei: {entry.command}")
        return result

    argv = shlex.split(entry.command)
    if shutil.which(argv[0]) is None:
        result.status = "SKIPPED"
        result.error = f"'{argv[0]}' non installato"
        return result
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=1800)
        result.details.extend(proc.stdout.strip().splitlines()[-20:])
        if proc.returncode != 0:
            result.status = "ERROR"
            result.error = proc.stderr.strip()[:500] or f"exit {proc.returncode}"
    except (OSError, subprocess.TimeoutExpired) as exc:
        result.status = "ERROR"
        result.error = str(exc)
    return result


def run_entry(
    entry: Entry,
    execute: bool = False,
    selected: list[str] | None = None,
    confirmed: bool = False,
    _pgrep=None,
) -> ActionResult:
    """Esegue una voce applicando tutte le difese, nell'ordine giusto.

    1. voce disabilitata dal guard al load → SKIPPED
    2. app in conflitto aperta (F6) → SKIPPED con motivo, mai kill
    3. dispatch per modo operativo
    """
    if not entry.enabled:
        return ActionResult(
            entry.id, entry.path or entry.command or "", entry.mode,
            status="SKIPPED", error="; ".join(entry.disabled_reasons),
        )

    conflicts = guard.running_conflicts(entry.conflicts, _pgrep=_pgrep)
    if conflicts:
        return ActionResult(
            entry.id, entry.path or entry.command or "", entry.mode,
            status="SKIPPED", error=f"app in conflitto aperte: {', '.join(conflicts)}",
        )

    if entry.mode == "empty_children":
        return empty_children(entry, execute=execute)
    if entry.mode == "glob_delete":
        return glob_delete(entry, execute=execute)
    if entry.mode == "glob_review":
        return glob_review(entry, selected or [], execute=execute)
    if entry.mode == "delegate":
        return delegate(entry, execute=execute, confirmed=confirmed)
    return ActionResult(
        entry.id, entry.path or "", entry.mode,
        status="SKIPPED", error=f"modo sconosciuto: {entry.mode}",
    )
