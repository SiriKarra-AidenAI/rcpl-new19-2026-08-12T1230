"""Tiny persistent store for extracted intake items. Deduped by email Message-ID so the
poller never double-processes a mail. Persisted to gitignored JSON files so restarts keep
history — same shape/behavior as the Node version it replaces (server/store.mjs)."""
import json
import os
from typing import Optional

# Data files live in backend/ (one level up from this package), not inside email_service/ —
# matches where the old server/ version kept them and what .gitignore expects.
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_FILE = os.path.join(_BACKEND_DIR, ".intake-store.json")
_AWAITING_FILE = os.path.join(_BACKEND_DIR, ".intake-awaiting-reply.json")
# Message-IDs the poller has already turned into (or merged into) an item — separate from
# `items` because a merged reply never becomes its own item, so `has()` alone can't dedupe it.
_SEEN_FILE = os.path.join(_BACKEND_DIR, ".intake-seen.json")


def _load(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


items: list = _load(_FILE, [])
# itemId -> the Message-ID of the "request missing info" reply we sent for it, so an inbound
# reply whose In-Reply-To/References mentions that Message-ID can be matched straight back to
# the original intake item instead of being filed as a fresh, unrelated enquiry.
awaiting: dict = _load(_AWAITING_FILE, {})
seen: list = _load(_SEEN_FILE, [])


def _persist():
    try:
        with open(_FILE, "w", encoding="utf-8") as f:
            json.dump(items, f, indent=2)
    except OSError as e:
        print(f"store persist failed: {e}")


def _persist_awaiting():
    try:
        with open(_AWAITING_FILE, "w", encoding="utf-8") as f:
            json.dump(awaiting, f, indent=2)
    except OSError as e:
        print(f"awaiting-reply persist failed: {e}")


def _persist_seen():
    try:
        with open(_SEEN_FILE, "w", encoding="utf-8") as f:
            json.dump(seen, f, indent=2)
    except OSError as e:
        print(f"seen persist failed: {e}")


def all() -> list:
    return items


def has(msg_id: str) -> bool:
    return msg_id in seen


def add(item: dict) -> None:
    items.insert(0, item)
    seen.append(item["msgId"])
    _persist()
    _persist_seen()


def mark_seen(msg_id: str) -> None:
    """Marks a msgId as processed without creating a new item — used when a reply gets
    merged into the item it was answering instead of becoming its own inbox entry."""
    seen.append(msg_id)
    _persist_seen()


def find_by_id(item_id: str) -> Optional[dict]:
    return next((i for i in items if i["id"] == item_id), None)


def update(item_id: str, patch: dict) -> Optional[dict]:
    """Merges new field/document values into an already-stored item (only overwriting what
    the reply actually answered) and re-persists."""
    item = next((i for i in items if i["id"] == item_id), None)
    if item is None:
        return None
    item.update(patch)
    _persist()
    return item


def record_awaiting_reply(item_id: str, sent_message_id: str) -> None:
    awaiting[sent_message_id] = item_id
    _persist_awaiting()


def item_id_for_reply_headers(in_reply_to: Optional[str], references: Optional[list]) -> Optional[str]:
    """Finds the intake item a just-arrived message is replying to, by Message-ID."""
    candidates = [c for c in ([in_reply_to] + list(references or [])) if c]
    for msg_id in candidates:
        if msg_id in awaiting:
            return awaiting[msg_id]
    return None
