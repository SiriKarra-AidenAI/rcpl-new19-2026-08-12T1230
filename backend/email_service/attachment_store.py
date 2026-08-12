"""Persists raw attachment bytes to disk, keyed by intake item id + filename, so a document's
real content can be served back later (e.g. Document Authenticity's "View original", Intake
Review's document preview) instead of a synthetic mock stand-in. Attachments are transient
during IMAP polling otherwise — intake_mailbox.py only keeps their extracted text."""
import os
import re

_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".intake-attachments")


def _safe(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", s)[:120] or "file"


def save(item_id: str, filename: str, content: bytes) -> None:
    if not content:
        return
    d = os.path.join(_DIR, _safe(item_id))
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, _safe(filename)), "wb") as f:
        f.write(content)


def read(item_id: str, filename: str) -> "bytes | None":
    path = os.path.join(_DIR, _safe(item_id), _safe(filename))
    try:
        with open(path, "rb") as f:
            return f.read()
    except FileNotFoundError:
        return None
