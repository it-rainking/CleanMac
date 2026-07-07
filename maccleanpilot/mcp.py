#!/usr/bin/env python3
"""MacCleanPilot — CLI (Typer). Manutenzione periodica disco macOS, semi-automatica.

Flusso sessione (§3):  SCAN → REPORT → BACKUP → APPROVE → EXECUTE → VERIFY
Il gate: EXECUTE è raggiungibile solo con snapshot APFS della sessione corrente.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import platform
import plistlib
import subprocess
import sys
from pathlib import Path

import typer
from rich.console import Console
from rich.prompt import Confirm, Prompt
from rich.table import Table

sys.path.insert(0, str(Path(__file__).resolve().parent))

from core import backup, executor, guard, report, scanner  # noqa: E402

app = typer.Typer(
    name="mcp",
    help="MacCleanPilot v1.0 — scansiona, misura, propone; tu approvi; lui esegue.",
    no_args_is_help=True,
)
console = Console()

LOG_DIR = report.LOG_DIR


def _setup_logging() -> logging.Logger:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("mcp")
    if not logger.handlers:
        handler = logging.FileHandler(LOG_DIR / f"{dt.date.today().isoformat()}.log")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger


def _load_catalog_or_die() -> list[scanner.Entry]:
    log = _setup_logging()
    try:
        entries, warnings = scanner.load_catalog()
    except FileNotFoundError:
        console.print("[red]catalog.yaml non trovato[/red]")
        raise typer.Exit(1)
    for w in warnings:
        log.warning(w)
        console.print(f"[yellow]WARN[/yellow] {w}")
    return entries


def _scan_table(results: list[scanner.ScanResult]) -> Table:
    table = Table(title="MacCleanPilot — spazio recuperabile (F2)", expand=True)
    table.add_column("Voce", no_wrap=True)
    table.add_column("Path / comando", overflow="fold", ratio=2, style="dim")
    table.add_column("Modo", no_wrap=True, style="dim")
    table.add_column("Recuperabile", justify="right", style="green", no_wrap=True)
    table.add_column("File", justify="right", no_wrap=True)
    table.add_column("Note", ratio=1, style="yellow")

    by_cat: dict[str, list[scanner.ScanResult]] = {}
    for r in results:
        by_cat.setdefault(r.entry.category_label, []).append(r)

    first = True
    for label, cat_results in by_cat.items():
        if not first:
            table.add_section()
        first = False
        subtotal = sum(r.bytes_total for r in cat_results if r.entry.enabled)
        table.add_row(f"[bold cyan]{label}[/bold cyan]", "", "",
                      f"[bold]{scanner.human(subtotal)}[/bold]", "", "")
        for r in sorted(cat_results, key=lambda r: -r.bytes_total):
            e = r.entry
            note = r.note if r.exists or e.mode == "delegate" else "voce morta (vedi doctor)"
            if not e.enabled:
                note = f"DISABILITATA: {'; '.join(e.disabled_reasons)}"
            table.add_row(
                f"  {e.id}",
                e.path or e.command or "",
                e.mode,
                scanner.human(r.bytes_total) if e.mode != "delegate" else "—",
                str(r.file_count) if e.mode != "delegate" else "—",
                note,
            )
    return table


@app.command()
def scan(only: str = typer.Option(None, "--only", help="Categorie, separate da virgola")):
    """F1/F2 — misura le aree del catalogo e stampa il report (solo lettura)."""
    entries = _load_catalog_or_die()
    if only:
        wanted = {c.strip() for c in only.split(",")}
        entries = [e for e in entries if e.category in wanted]
    results = scanner.scan_catalog(entries)
    console.print(_scan_table(results))
    recoverable = sum(r.bytes_total for r in results if r.entry.enabled)
    console.print(f"\nTotale recuperabile stimato: [bold green]{scanner.human(recoverable)}[/bold green]")
    console.print("[dim]Le stime escludono i delegati (brew/pip/npm/docker) e lo spazio purgeable APFS.[/dim]")


@app.command(name="backup")
def backup_cmd():
    """F3 — snapshot APFS + rsync mirato su /Volumes/Dati/Backup_PrePulizia/<data>."""
    log = _setup_logging()
    started = dt.datetime.now()
    try:
        status = backup.run_backup(scanner.rsync_paths())
    except backup.BackupError as exc:
        console.print(f"[red]Backup fallito:[/red] {exc}")
        raise typer.Exit(1)
    console.print(f"Snapshot APFS creato: [bold]{status.snapshot_id}[/bold]")
    log.info("snapshot creato: %s", status.snapshot_id)
    if status.rsync_ok:
        console.print(f"rsync mirato completato → {status.rsync_dest}")
    else:
        console.print(f"[yellow]rsync non riuscito:[/yellow] {status.rsync_error}")
        console.print("[yellow]Lo snapshot APFS esiste comunque, ma `clean --execute` resterà bloccato finché il volume di backup non è disponibile (§6).[/yellow]")
    verified = backup.verify(started)
    console.print(f"Verifica gate: {'[green]OK[/green] — ' + verified if verified else '[red]snapshot non trovato[/red]'}")


def _approve(results: list[scanner.ScanResult], preselected: set[str] | None) -> tuple[list[scanner.Entry], dict[str, list[str]], set[str]]:
    """F4 — approvazione granulare. Default: tutto OFF.

    Ritorna (voci approvate, selezioni glob_review per voce, conferme require_explicit).
    """
    approved: list[scanner.Entry] = []
    review_selection: dict[str, list[str]] = {}
    explicit_ok: set[str] = set()

    by_cat: dict[str, list[scanner.ScanResult]] = {}
    for r in results:
        by_cat.setdefault(r.entry.category, []).append(r)

    for cat, cat_results in by_cat.items():
        label = cat_results[0].entry.category_label
        cat_bytes = sum(r.bytes_total for r in cat_results)
        preapproved = preselected is not None and cat in preselected
        if not preapproved and not Confirm.ask(
            f"Categoria [cyan]{label}[/cyan] ({scanner.human(cat_bytes)}) — includere?", default=False
        ):
            continue
        for r in cat_results:
            e = r.entry
            if not e.enabled:
                continue
            desc = e.path or e.command or ""
            size = scanner.human(r.bytes_total) if e.mode != "delegate" else "delegato"
            if not Confirm.ask(f"  └ [bold]{e.id}[/bold] — {desc} ({size})?", default=False):
                continue
            if e.mode == "glob_review":
                selection = _review_files(r)
                if not selection:
                    console.print("    [dim]nessun file selezionato: voce saltata[/dim]")
                    continue
                review_selection[e.id] = selection
            if e.require_explicit:
                if not Confirm.ask(
                    f"    [red]⚠ '{e.command}' è distruttivo (immagini/volumi Docker inclusi). Confermi esplicitamente?[/red]",
                    default=False,
                ):
                    continue
                explicit_ok.add(e.id)
            approved.append(e)
    return approved, review_selection, explicit_ok


def _review_files(result: scanner.ScanResult) -> list[str]:
    """glob_review: lista numerata, selezione manuale obbligatoria (F4)."""
    if not result.files:
        console.print("    [dim]nessun file corrispondente[/dim]")
        return []
    threshold = scanner.parse_size(result.entry.min_size_flag) if result.entry.min_size_flag else None
    console.print(f"    File in [bold]{result.entry.path}[/bold] (pattern {result.entry.patterns}):")
    for i, (path, size) in enumerate(result.files, 1):
        heavy = " [red]● pesante[/red]" if threshold and size >= threshold else ""
        console.print(f"      {i:3d}. {Path(path).name}  ({scanner.human(size)}){heavy}")
    raw = Prompt.ask("    Numeri da eliminare (es. 1,3-5) o vuoto per saltare", default="")
    indexes: set[int] = set()
    for token in raw.replace(" ", "").split(","):
        if not token:
            continue
        if "-" in token:
            a, _, b = token.partition("-")
            if a.isdigit() and b.isdigit():
                indexes.update(range(int(a), int(b) + 1))
        elif token.isdigit():
            indexes.add(int(token))
    return [result.files[i - 1][0] for i in sorted(indexes) if 1 <= i <= len(result.files)]


@app.command()
def clean(
    execute: bool = typer.Option(False, "--execute", help="Esecuzione reale (default: dry-run)"),
    only: str = typer.Option(None, "--only", help="Categorie pre-approvate, separate da virgola"),
    skip_backup: bool = typer.Option(False, "--skip-backup", hidden=True),
    i_know: bool = typer.Option(False, "--i-know-what-i-am-doing", hidden=True),
):
    """Flusso interattivo completo: SCAN → REPORT → BACKUP → APPROVE → EXECUTE → VERIFY."""
    log = _setup_logging()
    session_start = dt.datetime.now()

    # SCAN + REPORT
    entries = _load_catalog_or_die()
    wanted = {c.strip() for c in only.split(",")} if only else None
    if wanted:
        entries = [e for e in entries if e.category in wanted]
        if not entries:
            console.print(f"[red]Nessuna voce per le categorie: {only}[/red]")
            raise typer.Exit(1)
    console.print("[bold]SCAN[/bold] — misuro le aree del catalogo…")
    results = scanner.scan_catalog(entries)
    console.print(_scan_table(results))

    # BACKUP (gate — solo per esecuzione reale)
    snapshot_id: str | None = None
    if execute:
        if skip_backup and i_know:
            console.print("[red bold]BYPASS BACKUP RICHIESTO (--skip-backup --i-know-what-i-am-doing)[/red bold]")
            log.warning("bypass backup: --skip-backup --i-know-what-i-am-doing")
        elif skip_backup:
            console.print("[red]--skip-backup richiede anche --i-know-what-i-am-doing (§3).[/red]")
            raise typer.Exit(1)
        else:
            console.print("\n[bold]BACKUP[/bold] — snapshot APFS + rsync mirato…")
            try:
                status = backup.run_backup(scanner.rsync_paths())
            except backup.BackupError as exc:
                console.print(f"[red]Backup fallito, esecuzione bloccata:[/red] {exc}")
                raise typer.Exit(1)
            console.print(f"Snapshot: [bold]{status.snapshot_id}[/bold]")
            if not status.rsync_ok:
                console.print(f"[red]rsync fallito ({status.rsync_error}): `clean --execute` è bloccato (§6). Monta /Volumes/Dati e riprova, oppure usa il doppio flag di bypass.[/red]")
                raise typer.Exit(1)
            snapshot_id = backup.verify(session_start)
            if not snapshot_id:
                console.print("[red]Gate: nessuno snapshot verificato per questa sessione. Esecuzione bloccata.[/red]")
                raise typer.Exit(1)
            console.print(f"Gate backup: [green]OK[/green] ({snapshot_id})")

    # Avviso bloccante cloud-sync (§6): nessuna API affidabile per pausarli,
    # quindi si chiede la pausa manuale prima di procedere con l'esecuzione.
    if execute:
        syncing = guard.running_conflicts(["Dropbox", "Google Drive", "OneDrive"])
        if syncing:
            console.print(f"\n[yellow bold]⚠ Client di sync attivi: {', '.join(syncing)}[/yellow bold]")
            console.print("[yellow]Metti in pausa la sincronizzazione manualmente prima di continuare.[/yellow]")
            if not Confirm.ask("Sincronizzazione in pausa: procedo?", default=False):
                console.print("Esecuzione annullata.")
                raise typer.Exit(0)
        console.print("[dim]Se usi iCloud Drive (Desktop e Documenti), verifica che la sync sia inattiva.[/dim]")

    # APPROVE (default: tutto OFF)
    mode_label = "[red bold]ESECUZIONE REALE[/red bold]" if execute else "[green]dry-run (simulazione)[/green]"
    console.print(f"\n[bold]APPROVE[/bold] — modalità {mode_label}. Nulla è selezionato di default.")
    approved, review_selection, explicit_ok = _approve(results, wanted)
    if not approved:
        console.print("Nessuna voce approvata: fine.")
        raise typer.Exit(0)

    # EXECUTE
    df_before = scanner.df_free_bytes("/")
    history = report.History()
    session_id = history.start_session(df_before / 1024**3, snapshot_id)
    console.print(f"\n[bold]EXECUTE[/bold] — sessione #{session_id}, {len(approved)} voci")
    total_freed = 0
    try:
        for entry in approved:
            result = executor.run_entry(
                entry,
                execute=execute,
                selected=review_selection.get(entry.id),
                confirmed=entry.id in explicit_ok,
            )
            total_freed += result.bytes_freed
            history.record_action(
                session_id, result.entry_id, result.path, result.mode,
                result.bytes_freed, result.status, result.error,
            )
            for line in result.details:
                log.info("[%s] %s", entry.id, line)
            color = {"OK": "green", "DRY_RUN": "cyan", "SKIPPED": "yellow", "ERROR": "red"}[result.status]
            console.print(
                f"  [{color}]{result.status:8}[/{color}] {entry.id:24} "
                f"{scanner.human(result.bytes_freed):>10}"
                + (f"  [dim]{result.error}[/dim]" if result.error else "")
            )
            log.info("%s %s %s freed=%d err=%s", result.status, entry.id, result.path,
                     result.bytes_freed, result.error or "-")
    except KeyboardInterrupt:
        # Safe (§6): le operazioni sono per-voce e idempotenti. Si chiude
        # comunque la sessione così `history` mostra lo stato parziale.
        console.print("\n[yellow]Interrotto (Ctrl-C): stato parziale salvato in history.[/yellow]")
        log.warning("sessione %d interrotta da Ctrl-C", session_id)

    # VERIFY
    df_after = scanner.df_free_bytes("/")
    history.finish_session(session_id, df_after / 1024**3)
    md = report.export_markdown(history, session_id)
    console.print(f"\n[bold]VERIFY[/bold] — spazio libero: {scanner.human(df_before)} → {scanner.human(df_after)} "
                  f"(Δ {scanner.human(max(df_after - df_before, 0))})")
    console.print(f"Totale per voce: [bold green]{scanner.human(total_freed)}[/bold green]"
                  + (" [dim](stima dry-run)[/dim]" if not execute else ""))
    console.print("[dim]Il delta df include lo spazio purgeable APFS (indicativo, non contabile); lo snapshot della sessione occupa spazio per ~24h.[/dim]")
    console.print(f"Report: {md}")
    history.close()


@app.command()
def history(session: int = typer.Option(None, "--session", help="Dettaglio di una sessione")):
    """F9 — storico sessioni (data, GB liberati, voci eseguite/saltate)."""
    h = report.History()
    if session is not None:
        rows = h.actions(session)
        if not rows:
            console.print(f"[yellow]Nessuna azione per la sessione {session}[/yellow]")
            raise typer.Exit(0)
        table = Table(title=f"Sessione #{session}")
        for col in ("Voce", "Path", "Modo", "Liberati", "Esito", "Errore"):
            table.add_column(col)
        for a in rows:
            table.add_row(a["entry_id"], a["path"] or "", a["mode"] or "",
                          scanner.human(a["bytes_freed"] or 0), a["status"] or "", a["error"] or "")
        console.print(table)
        return
    table = Table(title="Storico sessioni")
    for col in ("#", "Data", "Liberati", "df prima", "df dopo", "Eseguite", "Saltate", "Snapshot"):
        table.add_column(col)
    for s in h.sessions():
        table.add_row(
            str(s["id"]), s["started_at"], scanner.human(s["bytes_freed"] or 0),
            f"{s['df_before_gb']:.1f} GB" if s["df_before_gb"] is not None else "—",
            f"{s['df_after_gb']:.1f} GB" if s["df_after_gb"] is not None else "—",
            str(s["done"] or 0), str(s["skipped"] or 0), s["snapshot_id"] or "—",
        )
    console.print(table)
    h.close()


@app.command()
def doctor():
    """Verifiche ambiente: macOS, Full Disk Access, sudo, volume backup, voci morte."""
    entries = _load_catalog_or_die()
    checks: list[tuple[str, bool | None, str]] = []

    is_mac = platform.system() == "Darwin"
    checks.append(("macOS", is_mac, platform.platform()))
    checks.append(("Python ≥ 3.11", sys.version_info >= (3, 11), platform.python_version()))

    # Full Disk Access: senza FDA il Terminale non può leggere ~/Library/Mail o Safari
    fda: bool | None = None
    if is_mac:
        probe = Path.home() / "Library" / "Safari"
        if probe.exists():
            try:
                list(probe.iterdir())
                fda = True
            except PermissionError:
                fda = False
        # probe assente: impossibile determinare → resta n/d, mai falso OK
    checks.append(("Full Disk Access", fda, "necessario per cache/log protetti da TCC"))

    sudo_ok: bool | None = None
    try:
        sudo_ok = subprocess.run(["sudo", "-n", "true"], capture_output=True, timeout=10).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        sudo_ok = False
    checks.append(("sudo disponibile (cached)", sudo_ok,
                   "richiesto solo per /Library/Caches, /Library/Logs, /private/var/log"))

    checks.append(("/Volumes/Dati montato", backup.volume_mounted(),
                   str(backup.BACKUP_ROOT.parent)))

    dead = [e.id for e in entries if e.path and not e.expanded_path().exists()]
    checks.append(("Voci catalogo vive", not dead,
                   f"morte: {', '.join(dead)}" if dead else f"{len(entries)} voci ok"))
    disabled = [e.id for e in entries if not e.enabled]
    checks.append(("Voci abilitate dal guard", not disabled,
                   f"disabilitate: {', '.join(disabled)}" if disabled else "nessuna violazione"))

    table = Table(title="mcp doctor")
    table.add_column("Check")
    table.add_column("Esito")
    table.add_column("Dettaglio", overflow="fold")
    for name, ok, detail in checks:
        badge = "[green]OK[/green]" if ok else ("[yellow]n/d[/yellow]" if ok is None else "[red]FAIL[/red]")
        table.add_row(name, badge, detail)
    console.print(table)


@app.command()
def web(port: int = typer.Option(7787, help="Porta della dashboard (bind solo 127.0.0.1)")):
    """Dashboard web locale (opzionale) su http://localhost:7787 — §5.2."""
    from web.app import create_app
    console.print(f"Dashboard su [bold]http://127.0.0.1:{port}[/bold] — Ctrl-C per uscire.")
    console.print("[dim]Bind solo su 127.0.0.1: per l'iPhone usa un tunnel SSH, non 0.0.0.0.[/dim]")
    create_app().run(host="127.0.0.1", port=port, debug=False)


LAUNCH_AGENT = Path.home() / "Library" / "LaunchAgents" / "com.maccleanpilot.reminder.plist"


@app.command()
def remind(
    install: bool = typer.Option(False, "--install", help="Installa il promemoria mensile"),
    uninstall: bool = typer.Option(False, "--uninstall", help="Rimuove il promemoria"),
):
    """F10 — promemoria mensile (LaunchAgent + notifica osascript). Opzionale."""
    if install:
        script = (
            'display notification "È passato un mese: apri il terminale e lancia \'mcp clean\'." '
            'with title "MacCleanPilot" sound name "Glass"'
        )
        plist = {
            "Label": "com.maccleanpilot.reminder",
            "ProgramArguments": ["/usr/bin/osascript", "-e", script],
            "StartCalendarInterval": {"Day": 1, "Hour": 10, "Minute": 0},
            "RunAtLoad": False,
        }
        LAUNCH_AGENT.parent.mkdir(parents=True, exist_ok=True)
        with open(LAUNCH_AGENT, "wb") as fh:
            plistlib.dump(plist, fh)
        subprocess.run(["launchctl", "load", str(LAUNCH_AGENT)], capture_output=True)
        console.print(f"Promemoria installato: {LAUNCH_AGENT} (giorno 1 di ogni mese, ore 10)")
    elif uninstall:
        subprocess.run(["launchctl", "unload", str(LAUNCH_AGENT)], capture_output=True)
        LAUNCH_AGENT.unlink(missing_ok=True)
        console.print("Promemoria rimosso.")
    else:
        state = "installato" if LAUNCH_AGENT.exists() else "non installato"
        console.print(f"Promemoria mensile: [bold]{state}[/bold] — usa --install / --uninstall")


if __name__ == "__main__":
    app()
