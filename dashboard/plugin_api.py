"""Hermes Fonts + Colors dashboard plugin backend.

Mounted at /api/plugins/hermes-fonts-colors/ by the Hermes dashboard.

Persists user font/color preferences to state.json next to this file,
exposes GET/PUT/POST routes the frontend bundle uses to read, update,
and reset preferences. Settings are validated against an allowlist of
fonts and a strict size/color schema before being written to disk.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

try:
    from fastapi import APIRouter, HTTPException, Request
except Exception:  # Allows local unit tests without dashboard dependencies.
    class APIRouter:  # type: ignore
        def get(self, *_args, **_kwargs):
            return lambda fn: fn
        def put(self, *_args, **_kwargs):
            return lambda fn: fn
        def post(self, *_args, **_kwargs):
            return lambda fn: fn

    class HTTPException(Exception):  # type: ignore
        def __init__(self, status_code: int, detail: str):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    class Request:  # type: ignore
        async def json(self) -> Dict[str, Any]:
            return {}


router = APIRouter()

PLUGIN_DIR = Path(__file__).resolve().parent.parent
STATE_PATH = PLUGIN_DIR / "state.json"
_WRITE_LOCK = threading.Lock()

# ---------------------------------------------------------------------------
# Allowlists — kept in sync with the curated font list in dist/index.js.
# Server-side validation prevents arbitrary CSS injection via font-family.
# ---------------------------------------------------------------------------

SANS_FONTS = {
    "DM Sans",
    "Inter",
    "IBM Plex Sans",
    "Atkinson Hyperlegible",
    "System UI",
}

MONO_FONTS = {
    "JetBrains Mono",
    "Fira Code",
    "IBM Plex Mono",
    "System Mono",
}

DISPLAY_FONTS = {
    "DM Sans",
    "DM Serif Display",
    "Space Grotesk",
    "Inter",
    "IBM Plex Sans",
}

HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

DEFAULTS: Dict[str, Any] = {
    "version": 1,
    "headingFont": "DM Sans",
    "bodyFont": "DM Sans",
    "monoFont": "JetBrains Mono",
    "baseSizePx": 15,
    "headingScale": 1.25,
    "headingColor": "#ffe6cb",
    "bodyColor": "#ffe6cb",
    "monoColor": "#a7c5ff",
    "accentColor": "#ffbd38",
    # Default matches the Nous DS `text-background-base` (#041c1c — very
    # dark teal) so existing button rendering is preserved out of the box.
    "buttonTextColor": "#041c1c",
    "enabled": True,
}


def _read_state() -> Dict[str, Any]:
    if not STATE_PATH.exists():
        return dict(DEFAULTS)
    try:
        raw = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return dict(DEFAULTS)
    merged = dict(DEFAULTS)
    if isinstance(raw, dict):
        merged.update({k: v for k, v in raw.items() if k in DEFAULTS})
    return merged


def _write_state_atomic(payload: Dict[str, Any]) -> None:
    PLUGIN_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".state-", suffix=".json", dir=str(PLUGIN_DIR))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2, sort_keys=True)
            fh.write("\n")
        os.replace(tmp_name, STATE_PATH)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def _validate(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")

    out: Dict[str, Any] = dict(DEFAULTS)

    heading_font = payload.get("headingFont", DEFAULTS["headingFont"])
    if heading_font not in DISPLAY_FONTS:
        raise HTTPException(status_code=400, detail=f"headingFont not allowed: {heading_font!r}")
    out["headingFont"] = heading_font

    body_font = payload.get("bodyFont", DEFAULTS["bodyFont"])
    if body_font not in SANS_FONTS:
        raise HTTPException(status_code=400, detail=f"bodyFont not allowed: {body_font!r}")
    out["bodyFont"] = body_font

    mono_font = payload.get("monoFont", DEFAULTS["monoFont"])
    if mono_font not in MONO_FONTS:
        raise HTTPException(status_code=400, detail=f"monoFont not allowed: {mono_font!r}")
    out["monoFont"] = mono_font

    base_size = payload.get("baseSizePx", DEFAULTS["baseSizePx"])
    try:
        base_size_int = int(base_size)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="baseSizePx must be an integer") from exc
    if not 10 <= base_size_int <= 28:
        raise HTTPException(status_code=400, detail="baseSizePx must be between 10 and 28")
    out["baseSizePx"] = base_size_int

    heading_scale = payload.get("headingScale", DEFAULTS["headingScale"])
    try:
        heading_scale_f = float(heading_scale)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="headingScale must be a number") from exc
    if not 1.0 <= heading_scale_f <= 2.0:
        raise HTTPException(status_code=400, detail="headingScale must be between 1.0 and 2.0")
    out["headingScale"] = round(heading_scale_f, 3)

    for color_key in ("headingColor", "bodyColor", "monoColor", "accentColor", "buttonTextColor"):
        color_val = payload.get(color_key, DEFAULTS[color_key])
        if not isinstance(color_val, str) or not HEX_RE.match(color_val):
            raise HTTPException(
                status_code=400,
                detail=f"{color_key} must be a 6-digit hex color (e.g. #ffe6cb)",
            )
        out[color_key] = color_val.lower()

    out["enabled"] = bool(payload.get("enabled", True))
    out["version"] = 1
    return out


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/settings")
async def get_settings() -> Dict[str, Any]:
    """Return the user's saved settings, falling back to defaults."""
    return _read_state()


@router.get("/options")
async def get_options() -> Dict[str, Any]:
    """Return allowlists and ranges so the frontend can render matching pickers."""
    return {
        "fonts": {
            "sans": sorted(SANS_FONTS),
            "mono": sorted(MONO_FONTS),
            "display": sorted(DISPLAY_FONTS),
        },
        "ranges": {
            "baseSizePx": {"min": 10, "max": 28, "step": 1},
            "headingScale": {"min": 1.0, "max": 2.0, "step": 0.05},
        },
        "defaults": DEFAULTS,
    }


@router.put("/settings")
async def put_settings(request: Request) -> Dict[str, Any]:
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid JSON body") from exc
    validated = _validate(payload)
    with _WRITE_LOCK:
        _write_state_atomic(validated)
    return validated


@router.post("/reset")
async def reset_settings() -> Dict[str, Any]:
    with _WRITE_LOCK:
        try:
            STATE_PATH.unlink(missing_ok=True)
        except TypeError:  # py<3.8 fallback
            if STATE_PATH.exists():
                STATE_PATH.unlink()
    return dict(DEFAULTS)


# ---------------------------------------------------------------------------
# Update check + self-update via git pull.
#
# The frontend calls /version on Styling page mount; if the remote manifest's
# version is higher than the local one, an "Update now" button appears that
# POSTs to /update. /update runs `git pull --ff-only` after validating that
# (a) the plugin dir is a git repo, (b) the origin remote points at the
# expected GitHub URL, (c) there are no uncommitted local changes. After
# a successful pull the user reloads the dashboard tab — the new dist/index.js
# is already on disk and served fresh by FastAPI's static-file route.
# ---------------------------------------------------------------------------

MANIFEST_PATH = PLUGIN_DIR / "dashboard" / "manifest.json"
EXPECTED_REMOTE_URL = "https://github.com/rubengarciajr/hermes-fonts-colors"
REMOTE_MANIFEST_URL = (
    "https://raw.githubusercontent.com/rubengarciajr/hermes-fonts-colors"
    "/main/dashboard/manifest.json"
)
_VERSION_CACHE: Dict[str, Any] = {"data": None, "fetched_at": 0.0}
_VERSION_CACHE_TTL = 300.0  # 5 minutes
_VERSION_LOCK = threading.Lock()
_GIT_TIMEOUT_SHORT = 10
_GIT_TIMEOUT_LONG = 30


def _parse_semver(s: str) -> Tuple[int, ...]:
    """Best-effort semver tuple parse. Returns (0,) on parse failure so an
    unparseable version compares as the lowest possible value (we won't
    accidentally claim an update is available when versions are weird)."""
    if not isinstance(s, str):
        return (0,)
    try:
        return tuple(int(x) for x in s.split(".")[:3])
    except ValueError:
        return (0,)


def _read_local_version() -> str:
    try:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        return str(manifest.get("version", "0.0.0"))
    except (OSError, json.JSONDecodeError):
        return "0.0.0"


def _fetch_remote_manifest() -> Dict[str, Any]:
    req = urllib.request.Request(
        REMOTE_MANIFEST_URL,
        headers={"User-Agent": "hermes-fonts-colors-update-check/0.1"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _compute_version_info(force: bool = False) -> Dict[str, Any]:
    """Return current local version + latest remote version.

    Local version is read fresh from disk on every call — it's a single
    JSON file read, so caching adds zero meaningful savings and only
    creates staleness bugs when the user updates the plugin (manual
    `git pull` or manifest edit). Remote version IS cached for 5 minutes
    because that's a network round-trip to GitHub.
    """
    now = time.time()
    local_version = _read_local_version()

    cached_remote = _VERSION_CACHE.get("remote")
    cached_error = _VERSION_CACHE.get("error")
    fetched_at = _VERSION_CACHE.get("fetched_at", 0.0)
    cache_fresh = (
        cached_remote is not None
        and not cached_error
        and (now - fetched_at) < _VERSION_CACHE_TTL
    )

    if force or not cache_fresh:
        try:
            remote = _fetch_remote_manifest()
            cached_remote = str(remote.get("version", "0.0.0"))
            cached_error = None
        except urllib.error.URLError as exc:
            cached_remote = None
            cached_error = "network: " + str(getattr(exc, "reason", exc))
        except (TimeoutError, json.JSONDecodeError, OSError) as exc:
            cached_remote = None
            cached_error = type(exc).__name__ + ": " + str(exc)
        _VERSION_CACHE["remote"] = cached_remote
        _VERSION_CACHE["error"] = cached_error
        _VERSION_CACHE["fetched_at"] = now
        fetched_at = now

    update_available = (
        cached_remote is not None
        and _parse_semver(cached_remote) > _parse_semver(local_version)
    )

    return {
        "local": local_version,
        "remote": cached_remote,
        "update_available": update_available,
        "checked_at": fetched_at,
        "error": cached_error,
    }


def _git(args: list, *, cwd: Path, timeout: int) -> Tuple[int, str, str]:
    """Run a git subcommand with a hard timeout. Returns (rc, stdout, stderr)."""
    proc = subprocess.run(
        ["git", "-C", str(cwd)] + args,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def _run_self_update() -> Dict[str, Any]:
    if not (PLUGIN_DIR / ".git").exists():
        raise HTTPException(
            status_code=400,
            detail=(
                "Plugin directory is not a git repository — automatic update "
                "is only available when the plugin was installed via "
                "`git clone`. Reinstall via the README's git clone command "
                "to enable this."
            ),
        )

    if shutil.which("git") is None:
        raise HTTPException(status_code=500, detail="git binary not found on PATH")

    # Verify origin remote — anti-MITM in case origin got rewritten.
    try:
        rc, out, err = _git(
            ["remote", "get-url", "origin"], cwd=PLUGIN_DIR, timeout=_GIT_TIMEOUT_SHORT
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git remote check timed out")
    if rc != 0:
        raise HTTPException(status_code=500, detail="git remote get-url origin failed: " + (err or out))
    remote_url = out.rstrip("/")
    expected = EXPECTED_REMOTE_URL.rstrip("/")
    # Allow .git suffix and ssh-style URLs that resolve to the same repo.
    matches = (
        remote_url == expected
        or remote_url == expected + ".git"
        or remote_url == "git@github.com:rubengarciajr/hermes-fonts-colors.git"
    )
    if not matches:
        raise HTTPException(
            status_code=400,
            detail=(
                "Refusing to pull: origin remote " + remote_url + " does not "
                "match the expected " + expected + ". If you intentionally "
                "forked this plugin, run `git pull` from the terminal instead."
            ),
        )

    # Refuse to pull over uncommitted changes — would lose user edits.
    try:
        rc, out, err = _git(
            ["status", "--porcelain"], cwd=PLUGIN_DIR, timeout=_GIT_TIMEOUT_SHORT
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git status check timed out")
    if rc != 0:
        raise HTTPException(status_code=500, detail="git status failed: " + (err or out))
    if out:
        raise HTTPException(
            status_code=409,
            detail=(
                "Plugin directory has uncommitted local changes. Stash or "
                "commit them before updating, or run `git pull` from the "
                "terminal so you can resolve manually."
            ),
        )

    # Run the pull.
    try:
        rc, out, err = _git(
            ["pull", "--ff-only", "origin", "main"],
            cwd=PLUGIN_DIR,
            timeout=_GIT_TIMEOUT_LONG,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git pull timed out after 30s")
    if rc != 0:
        raise HTTPException(
            status_code=500,
            detail="git pull failed: " + (err or out or "unknown error"),
        )

    # Bust the cache so the immediate /version response reflects the pulled state.
    with _VERSION_LOCK:
        _VERSION_CACHE["data"] = None
        _VERSION_CACHE["fetched_at"] = 0.0

    info = _compute_version_info(force=True)
    info["pull_output"] = out
    return info


@router.get("/version")
async def get_version() -> Dict[str, Any]:
    """Return current local version + latest remote version. Cached 5 min."""
    return _compute_version_info()


@router.post("/update")
async def post_update() -> Dict[str, Any]:
    """Run `git pull` to upgrade the plugin in place."""
    return _run_self_update()
