"""web/app.py — dashboard Flask locale (§5.2), porta 7787, bind 127.0.0.1.

Read-only + approvazioni: card per categoria con GB recuperabili, toggle,
pulsante "Esegui" attivo solo a backup verificato. Nessuna autenticazione:
il server NON deve mai essere bindato su 0.0.0.0 (per iPhone: tunnel SSH).

Limiti voluti della dashboard rispetto alla CLI:
- le voci glob_review NON sono eseguibili dal web (richiedono selezione
  file per file, flusso pensato per la CLI) — compaiono come sola lettura;
- le voci require_explicit (docker) non sono eseguibili dal web;
- il backup si lancia dal web ma l'esecuzione resta backup-gated identica.
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import backup, executor, report, scanner  # noqa: E402

# Difesa da DNS rebinding: il bind su 127.0.0.1 non basta, perché una pagina
# malevola può rebindare il proprio dominio su 127.0.0.1 e parlare col server
# come richiesta same-origin. Si accettano solo Host locali espliciti.
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}

# Il gate backup scade: uno snapshot di ore prima non giustifica più
# un'esecuzione "coperta da backup" (il server può vivere per giorni).
GATE_TTL = dt.timedelta(hours=2)


def _host_only(host_header: str) -> str:
    """'127.0.0.1:7787' → '127.0.0.1'; '[::1]:7787' → '[::1]'."""
    if host_header.startswith("["):
        return host_header.split("]", 1)[0] + "]"
    return host_header.rsplit(":", 1)[0] if ":" in host_header else host_header


def create_app() -> Flask:
    app = Flask(__name__)
    state: dict = {"session_start": dt.datetime.now(), "snapshot_id": None,
                   "rsync_ok": False, "backup_time": None}

    @app.before_request
    def _reject_foreign_hosts():
        if _host_only(request.host or "") not in ALLOWED_HOSTS:
            abort(403, description="Host non consentito (protezione DNS rebinding)")

    def _gate_open() -> bool:
        if not state["rsync_ok"] or state["backup_time"] is None:
            return False
        if dt.datetime.now() - state["backup_time"] > GATE_TTL:
            return False
        return bool(backup.verify(state["session_start"]))

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/scan")
    def api_scan():
        entries, warnings = scanner.load_catalog()
        results = scanner.scan_catalog(entries)
        payload = []
        for r in results:
            e = r.entry
            payload.append({
                "id": e.id,
                "category": e.category,
                "category_label": e.category_label,
                "path": e.path or e.command,
                "mode": e.mode,
                "bytes": r.bytes_total,
                "human": scanner.human(r.bytes_total),
                "files": r.file_count,
                "enabled": e.enabled,
                # Dal web: niente glob_review (selezione file per file), niente
                # require_explicit (conferma dedicata), niente sudo (nessun TTY).
                "executable_from_web": e.enabled and e.mode in ("empty_children", "glob_delete", "delegate")
                                        and not e.require_explicit and not e.sudo,
                "note": r.note or ("; ".join(e.disabled_reasons) if not e.enabled else ""),
            })
        return jsonify({"entries": payload, "warnings": warnings,
                        "df_free_gb": round(scanner.df_free_bytes("/") / 1024**3, 1)})

    @app.get("/api/backup-status")
    def api_backup_status():
        snap = backup.verify(state["session_start"])
        state["snapshot_id"] = snap
        return jsonify({
            "verified": _gate_open(),
            "snapshot_id": snap,
            "rsync_ok": state["rsync_ok"],
            "volume_mounted": backup.volume_mounted(),
        })

    @app.post("/api/backup")
    def api_backup():
        try:
            status = backup.run_backup(scanner.rsync_paths())
        except backup.BackupError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 500
        state["snapshot_id"] = status.snapshot_id
        state["rsync_ok"] = status.rsync_ok
        state["backup_time"] = dt.datetime.now()
        return jsonify({"ok": True, "snapshot_id": status.snapshot_id,
                        "rsync_ok": status.rsync_ok, "rsync_error": status.rsync_error})

    @app.post("/api/execute")
    def api_execute():
        """Esegue le voci approvate. Backup-gated come la CLI (§3)."""
        body = request.get_json(silent=True) or {}
        approved_ids = set(body.get("entries", []))
        dry_run = bool(body.get("dry_run", True))

        if not dry_run:
            if not _gate_open():
                return jsonify({"ok": False,
                                "error": "gate: backup non verificato (o scaduto) per questa sessione"}), 409
            state["snapshot_id"] = backup.verify(state["session_start"])

        entries, _ = scanner.load_catalog()
        todo = [e for e in entries if e.id in approved_ids]
        # Dal web niente glob_review, require_explicit né sudo (vedi docstring).
        todo = [e for e in todo
                if e.mode in ("empty_children", "glob_delete", "delegate")
                and not e.require_explicit and not e.sudo]
        if not todo:
            return jsonify({"ok": False, "error": "nessuna voce eseguibile selezionata"}), 400

        df_before = scanner.df_free_bytes("/")
        history = report.History()
        session_id = history.start_session(df_before / 1024**3,
                                           state["snapshot_id"] if not dry_run else None)
        actions = []
        for entry in todo:
            result = executor.run_entry(entry, execute=not dry_run)
            history.record_action(session_id, result.entry_id, result.path, result.mode,
                                  result.bytes_freed, result.status, result.error)
            actions.append({"id": result.entry_id, "status": result.status,
                            "freed": result.bytes_freed, "human": scanner.human(result.bytes_freed),
                            "error": result.error})
        df_after = scanner.df_free_bytes("/")
        history.finish_session(session_id, df_after / 1024**3)
        report.export_markdown(history, session_id)
        history.close()
        return jsonify({"ok": True, "session_id": session_id, "dry_run": dry_run,
                        "actions": actions,
                        "df_delta_gb": round((df_after - df_before) / 1024**3, 2)})

    @app.get("/api/history")
    def api_history():
        h = report.History()
        rows = [{"id": s["id"], "started_at": s["started_at"],
                 "freed": scanner.human(s["bytes_freed"] or 0),
                 "done": s["done"] or 0, "skipped": s["skipped"] or 0,
                 "snapshot": s["snapshot_id"]} for s in h.sessions()]
        h.close()
        return jsonify({"sessions": rows})

    return app


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=7787)
