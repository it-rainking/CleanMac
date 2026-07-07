"""scanner.py — F1/F2: caricamento catalogo, misura dimensioni, stima recuperabile.

Solo lettura: questo modulo non elimina mai nulla. La misura è fatta in
Python (os.scandir ricorsivo, senza mai seguire symlink) invece di
shellare `du`: stesso risultato, testabile su fixture, nessun rischio di
attraversare link.
"""

from __future__ import annotations

import fnmatch
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from . import guard

CATALOG_FILE = Path(__file__).resolve().parent.parent / "catalog.yaml"


@dataclass
class Entry:
    """Una voce del catalogo (whitelist). Tutto ciò che l'engine può vedere."""

    id: str
    category: str
    category_label: str
    mode: str = "empty_children"
    path: str | None = None
    patterns: list[str] = field(default_factory=list)
    sudo: bool = False
    command: str | None = None
    conflicts: list[str] = field(default_factory=list)
    require_explicit: bool = False
    min_size_flag: str | None = None
    disabled_reasons: list[str] = field(default_factory=list)

    @property
    def enabled(self) -> bool:
        return not self.disabled_reasons

    def expanded_path(self) -> Path | None:
        return Path(os.path.expanduser(self.path)) if self.path else None


@dataclass
class ScanResult:
    entry: Entry
    bytes_total: int = 0
    file_count: int = 0
    exists: bool = True
    files: list[tuple[str, int]] = field(default_factory=list)  # per glob_review
    note: str = ""


def load_catalog(path: Path | None = None) -> tuple[list[Entry], list[str]]:
    """Carica catalog.yaml e valida ogni voce con guard.validate_entry.

    Ritorna (entries, warnings). Le voci non valide restano nel catalogo
    ma con disabled_reasons popolato: visibili nel report, mai eseguibili.
    """
    catalog_path = path or CATALOG_FILE
    with open(catalog_path, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)

    entries: list[Entry] = []
    warnings: list[str] = []
    for cat_id, cat in (raw.get("categories") or {}).items():
        label = cat.get("label", cat_id)
        for raw_entry in cat.get("entries", []):
            entry = Entry(
                id=raw_entry["id"],
                category=cat_id,
                category_label=label,
                mode=raw_entry.get("mode", "empty_children"),
                path=raw_entry.get("path"),
                patterns=list(raw_entry.get("patterns", [])),
                sudo=bool(raw_entry.get("sudo", False)),
                command=raw_entry.get("command"),
                conflicts=list(raw_entry.get("conflicts", [])),
                require_explicit=bool(raw_entry.get("require_explicit", False)),
                min_size_flag=raw_entry.get("min_size_flag"),
            )
            problems = guard.validate_entry(raw_entry)
            if problems:
                entry.disabled_reasons = problems
                for p in problems:
                    warnings.append(f"[{entry.id}] {p} — voce disabilitata")
            entries.append(entry)
    return entries, warnings


def rsync_paths(path: Path | None = None) -> list[str]:
    """Path da copiare col backup rsync mirato (F3), dichiarati nel catalogo."""
    catalog_path = path or CATALOG_FILE
    with open(catalog_path, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    return [os.path.expanduser(p) for p in (raw.get("backup", {}) or {}).get("rsync_paths", [])]


def tree_size(path: Path) -> tuple[int, int]:
    """(byte, n_file) di un albero. Non segue MAI symlink; i link contano 0."""
    total = 0
    count = 0
    try:
        with os.scandir(path) as it:
            for child in it:
                try:
                    if child.is_symlink():
                        count += 1
                    elif child.is_file(follow_symlinks=False):
                        total += child.stat(follow_symlinks=False).st_size
                        count += 1
                    elif child.is_dir(follow_symlinks=False):
                        sub_bytes, sub_count = tree_size(Path(child.path))
                        total += sub_bytes
                        count += sub_count
                except OSError:
                    continue  # file sparito o permesso negato: skip (§6)
    except OSError:
        pass
    return total, count


def parse_size(spec: str) -> int:
    """'500M' → byte. Supporta K/M/G/T."""
    spec = spec.strip().upper()
    units = {"K": 1024, "M": 1024**2, "G": 1024**3, "T": 1024**4}
    if spec and spec[-1] in units:
        return int(float(spec[:-1]) * units[spec[-1]])
    return int(spec)


def _matching_files(root: Path, patterns: list[str]) -> list[tuple[str, int]]:
    """File diretti (depth 1) che matchano i pattern. Mai directory, mai link."""
    out: list[tuple[str, int]] = []
    try:
        with os.scandir(root) as it:
            for child in it:
                if not child.is_file(follow_symlinks=False):
                    continue
                if any(fnmatch.fnmatch(child.name.lower(), p.lower()) for p in patterns):
                    try:
                        out.append((child.path, child.stat(follow_symlinks=False).st_size))
                    except OSError:
                        continue
    except OSError:
        pass
    return sorted(out, key=lambda t: -t[1])


def scan_entry(entry: Entry) -> ScanResult:
    """F1: misura una voce. Per delegate la stima non è disponibile."""
    if entry.mode == "delegate":
        return ScanResult(entry, note=f"delegato a: {entry.command}")

    path = entry.expanded_path()
    if path is None or not path.exists():
        return ScanResult(entry, exists=False, note="path inesistente (voce morta? vedi doctor)")

    if entry.mode == "empty_children":
        size, count = tree_size(path)
        return ScanResult(entry, bytes_total=size, file_count=count)

    files = _matching_files(path, entry.patterns)
    return ScanResult(
        entry,
        bytes_total=sum(s for _, s in files),
        file_count=len(files),
        files=files,
    )


def scan_catalog(entries: list[Entry]) -> list[ScanResult]:
    return [scan_entry(e) for e in entries]


def df_free_bytes(path: str = "/") -> int:
    """Spazio libero del volume (df). Nota §9: include purgeable APFS —
    misura indicativa, non contabile."""
    return shutil.disk_usage(path).free


def human(n: int) -> str:
    value = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{value:.1f} TB"
