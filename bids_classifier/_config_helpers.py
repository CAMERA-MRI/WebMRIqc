# Vendored from BIDS-Manager 1.5.0 (bidsmgr/qc/config.py) — MIT License,
# Copyright (c) 2023 BIDS Manager. See LICENSE_bids-manager.txt.
# Only the three pydantic field/section helpers the classifier config needs.
"""Field helpers shared by the classifier configuration sections.

A ``_Section`` is a pydantic model that clamps numbers into their declared
range and drops unknown Literal choices rather than rejecting the input, so a
hand-written or out-of-date config still loads. ``_num`` declares a numeric
field with that range (and the UI hints the GUI draws), ``_hint`` wraps extra
metadata into ``json_schema_extra``.
"""

from __future__ import annotations

import typing
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _Section(BaseModel):
    model_config = ConfigDict(extra="ignore", validate_assignment=True)

    @model_validator(mode="before")
    @classmethod
    def _lenient(cls, data: Any) -> Any:
        """Numbers clamped into their range, unknown choices dropped (the
        default takes their place)."""
        if not isinstance(data, dict):
            return data
        out = dict(data)
        for name, info in cls.model_fields.items():
            if name not in out:
                continue
            value = out[name]
            if typing.get_origin(info.annotation) is Literal:
                if value not in typing.get_args(info.annotation):
                    del out[name]
                continue
            extra = info.json_schema_extra or {}
            if "range" in extra and isinstance(value, (int, float)) \
                    and not isinstance(value, bool):
                lo, hi = extra["range"]
                value = min(max(value, lo), hi)
                out[name] = int(round(value)) if info.annotation is int else float(value)
        return out


def _hint(**extra: Any) -> dict:
    return {"json_schema_extra": extra}


def _num(default: float, title: str, description: str, lo: float, hi: float, *,
         step: float = 1.0, unit: str = "", zero: str = "", enabled_by: str = "") -> Any:
    """A number field with its range (clamped on load, drawn on the page);
    ``enabled_by`` names the switch it depends on."""
    hints = {"range": (lo, hi), "step": step}
    if enabled_by:
        hints["enabled_by"] = enabled_by
    if unit:
        hints["unit"] = unit
    if zero:
        hints["zero"] = zero
    return Field(default, title=title, description=description, **_hint(**hints))
