"""Test scanner.py — misura, catalogo, classificazione (F1/F2)."""

from __future__ import annotations

from pathlib import Path

import pytest

from core import scanner

CATALOG = Path(__file__).resolve().parent.parent / "catalog.yaml"


def _entry(**kw) -> scanner.Entry:
    base = dict(id="t", category="c", category_label="C")
    base.update(kw)
    return scanner.Entry(**base)


def test_tree_size_counts_files(fake_home):
    size, count = scanner.tree_size(fake_home / "Library/Caches")
    assert size == 1000 + 2000 + 500
    assert count == 3


def test_tree_size_does_not_follow_symlinks(fake_home):
    (fake_home / "Library/Caches/link").symlink_to(fake_home / "Downloads")
    size, count = scanner.tree_size(fake_home / "Library/Caches")
    assert size == 3500  # i 13010 byte di Downloads NON contati
    assert count == 4    # il link conta come 1


def test_tree_size_missing_dir(tmp_path):
    assert scanner.tree_size(tmp_path / "nope") == (0, 0)


@pytest.mark.parametrize("spec,expected", [
    ("500M", 500 * 1024**2),
    ("1G", 1024**3),
    ("2K", 2048),
    ("1024", 1024),
    ("1.5G", int(1.5 * 1024**3)),
])
def test_parse_size(spec, expected):
    assert scanner.parse_size(spec) == expected


def test_scan_entry_empty_children(fake_home):
    r = scanner.scan_entry(_entry(path="~/Library/Caches", mode="empty_children"))
    assert r.bytes_total == 3500 and r.file_count == 3 and r.exists


def test_scan_entry_glob_modes(fake_home):
    r = scanner.scan_entry(_entry(path="~/Downloads", mode="glob_review",
                                  patterns=["*.dmg", "*.pkg"]))
    assert r.file_count == 2
    assert r.bytes_total == 13000
    # ordinati per dimensione decrescente
    assert r.files[0][1] == 8000 and r.files[0][0].endswith("big.pkg")


def test_scan_entry_glob_ignores_dirs_and_case(fake_home):
    (fake_home / "Downloads/subdir.dmg").mkdir()
    (fake_home / "Downloads/UPPER.DMG").write_bytes(b"y" * 20)
    r = scanner.scan_entry(_entry(path="~/Downloads", mode="glob_delete", patterns=["*.dmg"]))
    names = [Path(p).name for p, _ in r.files]
    assert "UPPER.DMG" in names and "subdir.dmg" not in names


def test_scan_entry_missing_path(fake_home):
    r = scanner.scan_entry(_entry(path="~/NonEsiste", mode="empty_children"))
    assert not r.exists and r.bytes_total == 0


def test_scan_entry_delegate():
    r = scanner.scan_entry(_entry(mode="delegate", command="brew cleanup"))
    assert "brew cleanup" in r.note and r.bytes_total == 0


def test_load_catalog_real_file(fake_home):
    entries, warnings = scanner.load_catalog(CATALOG)
    ids = {e.id for e in entries}
    assert {"user_caches", "system_caches", "xcode_derived", "brew", "docker",
            "var_log_rotated", "downloads_installers"} <= ids
    # il catalogo reale non deve produrre voci disabilitate
    assert warnings == []
    assert all(e.enabled for e in entries)
    docker = next(e for e in entries if e.id == "docker")
    assert docker.require_explicit and docker.mode == "delegate"


def test_load_catalog_disables_bad_entries(fake_home, tmp_path):
    bad = tmp_path / "bad.yaml"
    bad.write_text(
        "version: 1\n"
        "categories:\n"
        "  evil:\n"
        "    label: Evil\n"
        "    entries:\n"
        "      - id: docs\n"
        "        path: '~/Documents'\n"
        "        mode: empty_children\n",
        encoding="utf-8",
    )
    entries, warnings = scanner.load_catalog(bad)
    assert len(entries) == 1
    assert not entries[0].enabled
    assert any("disabilitata" in w for w in warnings)


def test_rsync_paths(fake_home):
    paths = scanner.rsync_paths(CATALOG)
    assert any(p.endswith("Downloads") for p in paths)


def test_df_free_bytes():
    assert scanner.df_free_bytes("/") > 0


@pytest.mark.parametrize("n,expected", [
    (0, "0 B"), (512, "512 B"), (2048, "2.0 KB"),
    (5 * 1024**2, "5.0 MB"), (3 * 1024**3, "3.0 GB"),
])
def test_human(n, expected):
    assert scanner.human(n) == expected
