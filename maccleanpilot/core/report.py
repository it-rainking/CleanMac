"""report.py — F7/F9: delta spazio, storico SQLite, export markdown.

Schema (§4): sessions(id, started_at, df_before_gb, df_after_gb, snapshot_id)
             actions(id, session_id, entry_id, path, mode, bytes_freed, status, error)
"""

from __future__ import annotations

import datetime as dt
import sqlite3
from dataclasses import dataclass
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_FILE = DATA_DIR / "history.db"
LOG_DIR = DATA_DIR / "logs"

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    df_before_gb REAL,
    df_after_gb REAL,
    snapshot_id TEXT
);
CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    entry_id TEXT NOT NULL,
    path TEXT,
    mode TEXT,
    bytes_freed INTEGER DEFAULT 0,
    status TEXT,
    error TEXT
);
"""


def _connect(db_path: Path | None = None) -> sqlite3.Connection:
    path = db_path or DB_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


class History:
    """Storico sessioni. Ogni scrittura è committata subito: un Ctrl-C a
    metà esecuzione lascia comunque lo stato parziale consultabile (§6)."""

    def __init__(self, db_path: Path | None = None):
        self.conn = _connect(db_path)

    def start_session(self, df_before_gb: float, snapshot_id: str | None) -> int:
        cur = self.conn.execute(
            "INSERT INTO sessions (started_at, df_before_gb, snapshot_id) VALUES (?, ?, ?)",
            (dt.datetime.now().isoformat(timespec="seconds"), df_before_gb, snapshot_id),
        )
        self.conn.commit()
        return cur.lastrowid

    def record_action(self, session_id: int, entry_id: str, path: str, mode: str,
                      bytes_freed: int, status: str, error: str | None) -> None:
        self.conn.execute(
            "INSERT INTO actions (session_id, entry_id, path, mode, bytes_freed, status, error)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (session_id, entry_id, path, mode, bytes_freed, status, error),
        )
        self.conn.commit()

    def finish_session(self, session_id: int, df_after_gb: float) -> None:
        self.conn.execute(
            "UPDATE sessions SET df_after_gb = ? WHERE id = ?", (df_after_gb, session_id)
        )
        self.conn.commit()

    def sessions(self) -> list[sqlite3.Row]:
        return self.conn.execute(
            """SELECT s.*,
                      COALESCE(SUM(a.bytes_freed), 0) AS bytes_freed,
                      SUM(CASE WHEN a.status IN ('OK','DRY_RUN') THEN 1 ELSE 0 END) AS done,
                      SUM(CASE WHEN a.status = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped
               FROM sessions s LEFT JOIN actions a ON a.session_id = s.id
               GROUP BY s.id ORDER BY s.id DESC"""
        ).fetchall()

    def actions(self, session_id: int) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM actions WHERE session_id = ? ORDER BY id", (session_id,)
        ).fetchall()

    def close(self) -> None:
        self.conn.close()


@dataclass
class SessionSummary:
    session_id: int
    executed: bool
    df_before_gb: float
    df_after_gb: float
    snapshot_id: str | None
    bytes_freed: int
    ok: int
    skipped: int
    errors: int


def export_markdown(history: History, session_id: int, out_dir: Path | None = None) -> Path:
    """Report riepilogativo della sessione in markdown (F7)."""
    out = (out_dir or LOG_DIR)
    out.mkdir(parents=True, exist_ok=True)
    sess = history.conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if sess is None:
        raise ValueError(f"sessione {session_id} inesistente")
    actions = history.actions(session_id)

    total = sum(a["bytes_freed"] or 0 for a in actions)
    lines = [
        f"# MacCleanPilot — sessione #{session_id}",
        "",
        f"- **Inizio:** {sess['started_at']}",
        f"- **Snapshot APFS:** {sess['snapshot_id'] or '— (bypass loggato)'}",
        f"- **Spazio libero prima:** {sess['df_before_gb']:.1f} GB",
        f"- **Spazio libero dopo:** {sess['df_after_gb']:.1f} GB" if sess["df_after_gb"] is not None
        else "- **Spazio libero dopo:** n/d (sessione interrotta?)",
        f"- **Totale liberato (somma per voce):** {total / 1024**2:.0f} MB",
        "",
        "> Nota: il delta df include lo spazio *purgeable* APFS ed è quindi",
        "> indicativo, non contabile. Lo snapshot creato dalla sessione occupa",
        "> a sua volta spazio per ~24h.",
        "",
        "| Voce | Path | Modo | Liberati | Esito | Errore |",
        "|------|------|------|----------|-------|--------|",
    ]
    for a in actions:
        freed = f"{(a['bytes_freed'] or 0) / 1024**2:.1f} MB"
        lines.append(
            f"| {a['entry_id']} | `{a['path']}` | {a['mode']} | {freed} "
            f"| {a['status']} | {a['error'] or ''} |"
        )
    path = out / f"session_{session_id}_{dt.date.today().isoformat()}.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path
