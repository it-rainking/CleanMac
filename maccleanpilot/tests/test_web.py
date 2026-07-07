"""Test dashboard Flask — scan, gate di esecuzione, dry-run sulla fixture."""

from __future__ import annotations

import pytest

import pytest as _pytest

from core import report
from web.app import _host_only, create_app


@_pytest.mark.parametrize("header,expected", [
    ("127.0.0.1:7787", "127.0.0.1"),
    ("localhost:7787", "localhost"),
    ("localhost", "localhost"),
    ("[::1]:7787", "[::1]"),
    ("[::1]", "[::1]"),
    ("evil.com:7787", "evil.com"),
])
def test_host_only_parsing(header, expected):
    assert _host_only(header) == expected


@pytest.fixture
def client(fake_home, tmp_db, monkeypatch):
    monkeypatch.setattr(report, "DB_FILE", tmp_db)
    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


def test_scan_endpoint(client):
    data = client.get("/api/scan").get_json()
    ids = {e["id"] for e in data["entries"]}
    assert "user_caches" in ids and "docker" in ids
    docker = next(e for e in data["entries"] if e["id"] == "docker")
    assert docker["executable_from_web"] is False  # require_explicit: solo da CLI
    review = next(e for e in data["entries"] if e["id"] == "downloads_installers")
    assert review["executable_from_web"] is False  # glob_review: solo da CLI
    system = next(e for e in data["entries"] if e["id"] == "system_caches")
    assert system["executable_from_web"] is False  # sudo: solo da CLI
    assert data["df_free_gb"] > 0


def test_foreign_host_rejected(client):
    """Difesa DNS rebinding: Host non locale → 403 su qualunque endpoint."""
    assert client.get("/api/scan", headers={"Host": "evil.com:7787"}).status_code == 403
    assert client.post("/api/execute", headers={"Host": "evil.com"},
                       json={"entries": ["user_caches"], "dry_run": False}).status_code == 403


def test_local_hosts_accepted(client):
    for host in ("127.0.0.1:7787", "localhost:7787", "localhost"):
        assert client.get("/api/scan", headers={"Host": host}).status_code == 200


def test_execute_filters_sudo_entries(client):
    """Selezionare solo voci sudo dal web → 400, nessuna voce eseguibile."""
    resp = client.post("/api/execute",
                       json={"entries": ["system_caches", "var_log_rotated"],
                             "dry_run": True})
    assert resp.status_code == 400


def test_execute_real_blocked_without_backup(client, fake_home):
    """Il gate vale anche dal web: senza backup di sessione → 409."""
    resp = client.post("/api/execute", json={"entries": ["user_caches"], "dry_run": False})
    assert resp.status_code == 409
    assert "gate" in resp.get_json()["error"]
    assert (fake_home / "Library/Caches/app1/data.db").exists()


def test_execute_dry_run_on_fixture(client, fake_home):
    resp = client.post("/api/execute", json={"entries": ["user_caches"], "dry_run": True})
    data = resp.get_json()
    assert data["ok"] and data["dry_run"]
    action = data["actions"][0]
    assert action["id"] == "user_caches" and action["status"] == "DRY_RUN"
    assert action["freed"] == 3500
    assert (fake_home / "Library/Caches/app1/data.db").exists()  # nulla toccato


def test_execute_rejects_review_entries(client):
    resp = client.post("/api/execute",
                       json={"entries": ["downloads_installers"], "dry_run": True})
    assert resp.status_code == 400


def test_history_endpoint(client):
    client.post("/api/execute", json={"entries": ["user_caches"], "dry_run": True})
    data = client.get("/api/history").get_json()
    assert len(data["sessions"]) == 1


def test_backup_status_unverified(client):
    data = client.get("/api/backup-status").get_json()
    assert data["verified"] is False


def test_index_served(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"MacCleanPilot" in resp.data
