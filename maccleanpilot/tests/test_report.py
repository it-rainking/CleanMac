"""Test report.py — storico SQLite ed export markdown (F7/F9)."""

from __future__ import annotations

import pytest

from core import report


def test_session_lifecycle(tmp_db):
    h = report.History(tmp_db)
    sid = h.start_session(df_before_gb=120.5, snapshot_id="2026-07-05-101530")
    h.record_action(sid, "user_caches", "/x/Caches", "empty_children", 1_000_000, "OK", None)
    h.record_action(sid, "docker", "docker system prune", "delegate", 0, "SKIPPED",
                    "require_explicit")
    h.finish_session(sid, df_after_gb=123.9)

    sessions = h.sessions()
    assert len(sessions) == 1
    s = sessions[0]
    assert s["id"] == sid
    assert s["df_before_gb"] == 120.5 and s["df_after_gb"] == 123.9
    assert s["snapshot_id"] == "2026-07-05-101530"
    assert s["bytes_freed"] == 1_000_000
    assert s["done"] == 1 and s["skipped"] == 1

    actions = h.actions(sid)
    assert [a["entry_id"] for a in actions] == ["user_caches", "docker"]
    h.close()


def test_multiple_sessions_ordered_desc(tmp_db):
    h = report.History(tmp_db)
    first = h.start_session(100.0, None)
    second = h.start_session(101.0, None)
    assert [s["id"] for s in h.sessions()] == [second, first]
    h.close()


def test_partial_session_visible(tmp_db):
    """Ctrl-C a metà: la sessione senza df_after resta consultabile (§6)."""
    h = report.History(tmp_db)
    sid = h.start_session(100.0, "snap")
    h.record_action(sid, "user_caches", "/x", "empty_children", 500, "OK", None)
    s = h.sessions()[0]
    assert s["df_after_gb"] is None and s["bytes_freed"] == 500
    h.close()


def test_export_markdown(tmp_db, tmp_path):
    h = report.History(tmp_db)
    sid = h.start_session(120.0, "2026-07-05-101530")
    h.record_action(sid, "user_caches", "/x/Caches", "empty_children",
                    2 * 1024**2, "OK", None)
    h.record_action(sid, "system_caches", "/Library/Caches", "empty_children",
                    0, "ERROR", "permesso negato")
    h.finish_session(sid, 121.5)
    md = report.export_markdown(h, sid, out_dir=tmp_path)
    text = md.read_text(encoding="utf-8")
    assert f"sessione #{sid}" in text
    assert "2026-07-05-101530" in text
    assert "120.0 GB" in text and "121.5 GB" in text
    assert "user_caches" in text and "permesso negato" in text
    assert "purgeable" in text  # disclaimer obbligatorio (§9 blindspots)
    h.close()


def test_export_markdown_missing_session(tmp_db, tmp_path):
    h = report.History(tmp_db)
    with pytest.raises(ValueError):
        report.export_markdown(h, 999, out_dir=tmp_path)
    h.close()
