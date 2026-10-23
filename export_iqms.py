#!/usr/bin/env python3
"""Export every submission's IQMs from a WebMRIQC accounts DB to CSV (+ optional JSON).

Each `submissions` row stores one subject's scalar IQMs as `metrics_json`
(written by the MRIQC worker — see server.py `_extract_iqms` / `_mark_completed`).
This reads them all, joins the submitter's email, and flattens them into one wide
row per submission: the submission columns first, then every IQM seen, in a stable
(union, sorted) column order so rows with different metric sets still line up.

Usage
-----
    python export_iqms.py [DB_PATH] [-o OUT.csv] [--json OUT.json]
                          [--email you@lab.org] [--completed-only]

DB_PATH defaults to $DATA_DIR/webmriqc.db, then /data/webmriqc.db (the Docker
volume path on the server), then /tmp/webmriqc_jobs/webmriqc.db (local fallback).

Run it on the server (where the DB lives), e.g.:
    # on the host, against the Docker volume:
    sudo python3 export_iqms.py \
        "$(docker volume inspect webmriqc_data -f '{{.Mountpoint}}')/webmriqc.db" \
        -o iqms.csv
    # or inside the container (if export_iqms.py is in the image):
    docker compose exec webmriqc python export_iqms.py -o /tmp/iqms.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sqlite3
import sys
from pathlib import Path

# Submission columns emitted before the IQMs (stable, human-first order).
BASE_COLS = ["job_id", "email", "user_id", "kind", "label", "created_at",
             "completed", "country", "is_public", "source_file"]


def pick_db(arg: str | None) -> str:
    candidates = [arg] if arg else []
    if os.environ.get("DATA_DIR"):
        candidates.append(os.path.join(os.environ["DATA_DIR"], "webmriqc.db"))
    candidates += ["/data/webmriqc.db", "/tmp/webmriqc_jobs/webmriqc.db"]
    for c in candidates:
        if c and Path(c).is_file():
            return c
    sys.exit("No webmriqc.db found. Tried:\n  " +
             "\n  ".join(str(c) for c in candidates if c) +
             "\nPass the DB path explicitly: python export_iqms.py /path/to/webmriqc.db")


def main() -> None:
    ap = argparse.ArgumentParser(description="Export WebMRIQC submission IQMs to CSV.")
    ap.add_argument("db", nargs="?", help="path to webmriqc.db (see --help for defaults)")
    ap.add_argument("-o", "--out", default="iqms.csv", help="CSV output path (default iqms.csv)")
    ap.add_argument("--json", help="also write the rows as JSON to this path")
    ap.add_argument("--email", help="only this user's submissions")
    ap.add_argument("--completed-only", action="store_true",
                    help="only submissions that finished MRIQC (have IQMs)")
    args = ap.parse_args()

    db_path = pick_db(args.db)
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row

    query = ("SELECT s.*, u.email AS email FROM submissions s "
             "LEFT JOIN users u ON u.id = s.user_id")
    conds, params = [], []
    if args.email:
        conds.append("u.email = ?")
        params.append(args.email)
    if args.completed_only:
        conds.append("s.completed = 1")
    if conds:
        query += " WHERE " + " AND ".join(conds)
    query += " ORDER BY s.id"

    try:
        rows = con.execute(query, params).fetchall()
    except sqlite3.OperationalError as e:
        sys.exit(f"Could not read submissions from {db_path}: {e}")

    records, iqm_keys = [], set()
    for r in rows:
        keys = r.keys()
        rec = {k: r[k] for k in ("job_id", "user_id", "kind", "label", "created_at",
                                 "completed", "country", "is_public", "email") if k in keys}
        metrics = {}
        if r["metrics_json"]:
            try:
                metrics = json.loads(r["metrics_json"]) or {}
            except Exception:
                metrics = {}
        for k, v in metrics.items():
            if k == "_source":
                rec["source_file"] = v
            else:
                rec[k] = v
                iqm_keys.add(k)
        records.append(rec)

    cols = BASE_COLS + sorted(iqm_keys)
    with open(args.out, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)

    with_iqms = sum(1 for rec in records if any(k in rec for k in iqm_keys))
    print(f"DB: {db_path}")
    print(f"{len(records)} submissions → {args.out}  "
          f"({len(iqm_keys)} IQM columns; {with_iqms} with IQMs, "
          f"{len(records) - with_iqms} without)")
    if args.json:
        Path(args.json).write_text(json.dumps(records, indent=2))
        print(f"JSON → {args.json}")


if __name__ == "__main__":
    main()
