"""Acquisition-parameter BIDS classifier for WebMRIQC.

This package decides a DICOM series' BIDS datatype/suffix (and entities such as
``dir``, ``inv``, ``part``, ``ce``) from *how it was acquired* — echo/inversion/
repetition times, flip angle, readout, volumes, diffusion weighting, the vendor
private headers — instead of from how the operator named the series. It recovers
series whose names do not match (e.g. a BOLD run called ``FE_EPI``) and leaves
out localizers/derived maps the names do not flag.

The scoring engine, feature extractor, rulebook and config are vendored verbatim
from **BIDS-Manager 1.5.0** (ANCPLabOldenburg, MIT License — see
``LICENSE_bids-manager.txt``); only this thin adapter — the DICOM-reading pass
and the mapping to WebMRIQC's conversion pipeline — is WebMRIQC's own.

Public API
----------
``classify_dicom_dir(dicom_dir)`` → ``{SeriesNumber: {datatype, suffix,
entities, ...}}`` for the pipeline to look up by each converted series'
``SeriesNumber``. ``scan_and_classify(dicom_dir)`` returns the full per-series
detail (for logging/tests). Both raise ``RuntimeError`` if pydicom is missing,
so the caller can fall back to its name-based classifier.
"""

from __future__ import annotations

import logging
import os
from collections import defaultdict
from pathlib import Path
from typing import Optional

from .config import DEFAULT, ClassifierConfig
from .engine import (Series, classify_session, decide, domain_datatypes,
                     names_only, rulebook)
from .features import SeriesFeatures, build, file_facts, series_facts

log = logging.getLogger("bids_classifier")

try:
    import pydicom  # noqa: F401
except Exception:  # noqa: BLE001 - optional at import; required to classify
    pydicom = None

#: Per-series cap on files whose per-file facts we read (echo/b-value/direction
#: vary across files; the true file count is still used for volume math).
_FACTS_CAP = 12000

#: BIDS-Manager verdict entity names → WebMRIQC custom-entity keys.
_ENTITY_MAP = {"task": "task", "acquisition": "acq", "direction": "dir",
               "inversion": "inv", "part": "part", "ceagent": "ce"}


def _int(value) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _order(acq_time: Optional[str], index: int) -> float:
    try:
        return float(str(acq_time or "").replace(":", ""))
    except ValueError:
        return float(index)


def _entities(verdict_entities: dict) -> dict:
    out = {}
    for k, v in (verdict_entities or {}).items():
        key = _ENTITY_MAP.get(k)
        if key and v not in (None, ""):
            out[key] = str(v)
    return out


def _record(decision, domain: frozenset) -> Optional[dict]:
    """A looked-up record for one decision, or None to abstain (let the
    caller's name-based classifier decide)."""
    name = decision.name
    if not name:
        return None
    datatype, _, suffix = name.partition("/")
    if datatype == "exclude":
        return {"exclude": True, "reason": suffix or "left out",
                "confidence": round(decision.confidence, 3)}
    if datatype not in domain:
        # mrs / pet / physio etc.: another rule knows these better than the
        # MR parameters do — abstain rather than overrule.
        return None
    return {"datatype": datatype, "suffix": suffix,
            "entities": _entities(decision.entities),
            "confidence": round(decision.confidence, 3),
            "decided_by": decision.decided_by, "check": bool(decision.check)}


def scan_series(dicom_dir) -> tuple[list[dict], dict[str, SeriesFeatures], dict[str, dict]]:
    """One header pass over ``dicom_dir``: group files by SeriesInstanceUID,
    read each file's facts and one file's series facts, fold into
    :class:`SeriesFeatures`. Returns ``(series_list, features_by_uid,
    meta_by_uid)``."""
    if pydicom is None:
        raise RuntimeError("pydicom is not installed")
    dicom_dir = Path(dicom_dir)
    facts_by_uid: dict[str, list] = defaultdict(list)
    counts: dict[str, int] = defaultdict(int)
    rep_ds: dict[str, object] = {}
    rep_meta: dict[str, dict] = {}
    for root, _dirs, files in os.walk(dicom_dir):
        for fn in files:
            path = Path(root) / fn
            try:
                ds = pydicom.dcmread(str(path), stop_before_pixels=True, force=True)
            except Exception:  # noqa: BLE001 - not every file is a DICOM
                continue
            uid = getattr(ds, "SeriesInstanceUID", None)
            if not uid:
                continue                       # not a (usable) DICOM image
            uid = str(uid)
            counts[uid] += 1
            if counts[uid] <= _FACTS_CAP:
                try:
                    facts_by_uid[uid].append(file_facts(ds))
                except Exception:  # noqa: BLE001
                    pass
            if uid not in rep_ds:
                rep_ds[uid] = ds
                rep_meta[uid] = {
                    "series_number": _int(getattr(ds, "SeriesNumber", None)),
                    "description": str(getattr(ds, "SeriesDescription", "") or ""),
                    "acq_time": str(getattr(ds, "AcquisitionTime", "")
                                    or getattr(ds, "SeriesTime", "") or ""),
                }
    series_list, features = [], {}
    for uid, ds in rep_ds.items():
        try:
            feats = build(facts_by_uid.get(uid, []), series_facts(ds), n_files=counts[uid])
        except Exception as exc:  # noqa: BLE001
            log.warning("feature build failed for series %s: %s",
                        rep_meta[uid].get("series_number"), exc)
            continue
        features[uid] = feats
        rep_meta[uid]["n_files"] = counts[uid]
        series_list.append({"key": uid, "uid": uid, "session": "session",
                            "acq_time": rep_meta[uid]["acq_time"]})
    return series_list, features, rep_meta


def scan_and_classify(dicom_dir, cfg: ClassifierConfig = DEFAULT) -> list[dict]:
    """Classify every series under ``dicom_dir``. Returns one dict per series:
    uid, series_number, description, n_files, the chosen ``name``
    (``datatype/suffix`` or ``exclude/...`` or ``""``), confidence, decided_by,
    entities, and the pipeline ``record`` (None where the engine abstains)."""
    series_list, features, meta = scan_series(dicom_dir)
    book = rulebook(cfg.rulebook)
    domain = domain_datatypes(book)
    sessions: dict[str, list[Series]] = defaultdict(list)
    for i, s in enumerate(series_list):
        f = features.get(s["uid"])
        if f is not None:
            sessions[s["session"]].append(
                Series(key=s["key"], features=f, order=_order(s["acq_time"], i)))
    results: list[dict] = []
    for members in sessions.values():
        classify_session(members, cfg, book)
        for x in members:
            base = {"uid": x.key, **meta.get(x.key, {})}
            if not x.verdict.probabilities:
                results.append({**base, "name": "", "record": None,
                                "decided_by": "", "confidence": 0.0, "entities": {}})
                continue
            d = decide(x.verdict, "", names_only(x.features, cfg, book), cfg)
            results.append({**base, "name": d.name, "record": _record(d, domain),
                            "decided_by": d.decided_by,
                            "confidence": round(d.confidence, 3),
                            "entities": dict(d.entities)})
    return results


def classify_dicom_dir(dicom_dir, cfg: ClassifierConfig = DEFAULT) -> dict[int, dict]:
    """``{SeriesNumber: record}`` for the conversion pipeline. A series the
    engine abstains on is left out (so the caller's name-based classifier
    decides it); a SeriesNumber shared by two different decisions is dropped
    (ambiguous → let the fallback decide)."""
    out: dict[int, Optional[dict]] = {}
    for r in scan_and_classify(dicom_dir, cfg):
        sn, rec = r.get("series_number"), r.get("record")
        if sn is None or rec is None:
            continue
        if sn in out:
            if out[sn] != rec:
                out[sn] = None                 # ambiguous
        else:
            out[sn] = rec
    return {sn: rec for sn, rec in out.items() if rec}


__all__ = ["classify_dicom_dir", "scan_and_classify", "scan_series", "SeriesFeatures"]
