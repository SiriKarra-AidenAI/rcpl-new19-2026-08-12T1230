"""Persists the frontend's whole app state (candidates, flagged cases, notifications, audit
log, etc.) to a gitignored JSON file, so it survives across browser storage resets — not just
localStorage. Stores/returns the raw JSON blob as-is; the frontend (zustand's persist
middleware) owns the shape, so this deliberately doesn't parse/validate it."""
import os

_FILE = os.path.join(os.path.dirname(__file__), ".session-store.json")


def read() -> str | None:
    try:
        with open(_FILE, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return None


def write(raw: str) -> None:
    with open(_FILE, "w", encoding="utf-8") as f:
        f.write(raw)


def clear() -> None:
    try:
        os.remove(_FILE)
    except FileNotFoundError:
        pass
