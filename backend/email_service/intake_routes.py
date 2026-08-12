"""Email intake: polls a Gmail (IMAP) inbox in a background thread, extracts each new email,
and serves the results to the frontend. Ported from server/index.mjs (+ its poller loop) so
all secrets/state live server-side here instead of a separate Node process. Route paths and
JSON response shapes are kept identical to the Node version — the frontend calls these paths
unchanged.
"""
import mimetypes
import os
import re
import threading
import time
from typing import Optional

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from email_service import attachment_store
from email_service import intake_store as store
from email_service import mailer
from email_service import pdf_locate
from email_service import sample_forms
from email_service.intake_extract import extract_intake, key_configured
from email_service.intake_mailbox import address as mailbox_address
from email_service.intake_mailbox import attachment_text
from email_service.intake_mailbox import configured as mailbox_configured
from email_service.intake_mailbox import fetch_recent

router = APIRouter()

POLL_SECONDS = int(os.environ.get("INTAKE_POLL_SECONDS") or "45")

DIST_DOCS = ["GST Certificate", "FSSAI License", "Godown Proof", "DB Onboarding Form"]
VENDOR_DOCS = ["GST", "PAN", "ISO 9001", "Factory Audit Report"]
# Map an attachment filename to a required document so attached files show as "received".
# Filenames stay loose to match on — a human naming a file "GST_Rao.pdf" clearly means it.
DOC_KEYWORDS = {
    "GST Certificate": re.compile(r"gst", re.IGNORECASE),
    "GST": re.compile(r"gst", re.IGNORECASE),
    "FSSAI License": re.compile(r"fssai", re.IGNORECASE),
    "Godown Proof": re.compile(r"godown|warehouse|lease", re.IGNORECASE),
    "DB Onboarding Form": re.compile(r"onboard|db[_-]?form|application", re.IGNORECASE),
    "PAN": re.compile(r"\bpan\b", re.IGNORECASE),
    "ISO 9001": re.compile(r"iso", re.IGNORECASE),
    "Factory Audit Report": re.compile(r"factory|audit", re.IGNORECASE),
}
# A document's own TEXT is a weaker signal than its filename — a bare keyword shows up
# incidentally in unrelated documents (a DB Onboarding Form prints a "GST Number" field; a real
# GST Certificate's boilerplate footer says "approval of application"). Without this, a DB
# Onboarding Form with no separate GST Certificate uploaded was getting misread as satisfying the
# GST Certificate requirement, just because it quotes the firm's GST number. Content matching for
# these two only fires on stricter, more distinctive phrasing; every other doc type's keyword is
# already specific enough to reuse as-is.
DOC_CONTENT_KEYWORDS = {
    **DOC_KEYWORDS,
    "GST Certificate": re.compile(r"gstin\b|registration certificate|certificate of registration|form gst reg", re.IGNORECASE),
    "GST": re.compile(r"gstin\b|registration certificate|certificate of registration|form gst reg", re.IGNORECASE),
    "DB Onboarding Form": re.compile(r"onboard|db[_-]?form", re.IGNORECASE),
}


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s, flags=re.IGNORECASE)
    s = re.sub(r"(^-|-$)", "", s)
    return s[:60]


def _email_addr(from_: str) -> str:
    m = re.search(r"<([^>]+)>", from_ or "")
    return m.group(1) if m else (from_ or "").strip()


def _doc_name_for_file(filename: str) -> str:
    for doc, rx in DOC_KEYWORDS.items():
        if rx.search(filename):
            return doc
    return filename


def _attachment_matches(name: str, attachment: dict) -> bool:
    """An attachment satisfies a required document if its filename matches that doc type's
    (looser) keyword, or its already-extracted text content matches the stricter content
    pattern. Real-world filenames rarely follow a naming convention (e.g. "IMG_1234.pdf",
    "scan (3).pdf") — the document's own text (e.g. a GST certificate literally containing
    "GSTIN") is a useful fallback signal, but only checked against DOC_CONTENT_KEYWORDS so an
    incidental mention (a GST *number* quoted on an unrelated form) doesn't count."""
    filename_rx = DOC_KEYWORDS.get(name)
    if filename_rx and filename_rx.search(attachment.get("filename", "")):
        return True
    text = attachment.get("text")
    content_rx = DOC_CONTENT_KEYWORDS.get(name)
    return bool(text and content_rx and content_rx.search(text))


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s), flags=re.IGNORECASE).lower()


# Fields the email was missing but a document supplied -> tagged with which document.
def _build_recovered(email_fields: list, doc_fields: list, attachments: list) -> list:
    missing = {f["label"] for f in email_fields if not f["ok"]}
    out = []
    for df in doc_fields:
        if not df["ok"] or df["label"] not in missing:
            continue
        needle = _norm(df["value"])
        att = None
        if needle:
            att = next((a for a in attachments if a.get("text") and needle in _norm(a["text"])), None)
        out.append({
            "label": df["label"],
            "value": df["value"],
            "from": _doc_name_for_file(att["filename"]) if att else "attached documents",
        })
    return out


def _to_item(m: dict, ex: dict, doc_extracted: Optional[list] = None) -> dict:
    doc_extracted = doc_extracted or []
    doc_names = VENDOR_DOCS if ex["partnerType"] == "vendor" else DIST_DOCS
    captured = sum(1 for f in ex["fields"] if f["ok"]) + len(doc_extracted)
    attachments = m.get("attachments") or []
    return {
        "id": f"mail-{_slug(m['msgId'])}",
        "msgId": m["msgId"],
        "channel": "email",
        "source": _email_addr(m["from"]) or "unknown@inbox",
        "title": m.get("subject") or "(no subject)",
        "receivedAt": "just now",
        "receivedFull": m.get("date"),
        "confidencePct": round((captured / len(ex["fields"])) * 100),
        "fields": ex["fields"],
        "summary": ex["summary"],
        "partnerType": ex["partnerType"],
        "priority": ex["priority"],
        "region": ex["region"],
        "assignedTo": "Unassigned",
        "raw": m.get("body"),
        "attachments": [a["filename"] for a in attachments],
        "docExtracted": doc_extracted if doc_extracted else None,
        "documents": [
            (
                {"name": name, "received": True, "file": att["filename"]}
                if (att := next((a for a in attachments if _attachment_matches(name, a)), None))
                else {"name": name, "received": False}
            )
            for name in doc_names
        ],
    }


_inbox_state = {"configured": mailbox_configured(), "connected": False, "address": mailbox_address()}
_state_lock = threading.Lock()


def _get_inbox_state() -> dict:
    with _state_lock:
        return dict(_inbox_state)


def _set_inbox_state(state: dict) -> None:
    global _inbox_state
    with _state_lock:
        _inbox_state = state


# A reply to a "request missing info" mail should fill in the gaps on the ORIGINAL intake item,
# not show up as a brand-new, unrelated one. Matched first by reply-threading headers (reliable
# when the distributor's mail client preserves them), falling back to "same sender address, and
# that item is still missing something" — real-world replies don't always keep clean threading.
def _find_replied_to_item(m: dict) -> Optional[dict]:
    by_header = store.item_id_for_reply_headers(m.get("inReplyTo"), m.get("references"))
    if by_header:
        return store.find_by_id(by_header)
    frm = _email_addr(m["from"])
    return next(
        (
            i for i in store.all()
            if i["source"] == frm
            and (any(not f["ok"] for f in i["fields"]) or any(not d["received"] for d in (i.get("documents") or [])))
        ),
        None,
    )


# Merges what the reply actually answered into the original item — only overwriting
# fields/docs that were previously missing, never a value the first email already captured.
def _merge_reply(item: dict, m: dict, ex: dict, doc_extracted: list) -> dict:
    attachments = m.get("attachments") or []

    def _merge_field(f):
        if f["ok"]:
            return f
        answered = next((x for x in ex["fields"] if x["label"] == f["label"] and x["ok"]), None)
        if answered is None:
            answered = next((d for d in doc_extracted if d["label"] == f["label"]), None)
        return {"label": f["label"], "value": answered["value"], "ok": True} if answered else f

    fields = [_merge_field(f) for f in item["fields"]]

    def _merge_doc(d):
        if d["received"]:
            return d
        att = next((a for a in attachments if _attachment_matches(d["name"], a)), None)
        return {**d, "received": True, "file": att["filename"]} if att else d

    documents = [_merge_doc(d) for d in (item.get("documents") or [])]
    captured = sum(1 for f in fields if f["ok"])
    return {
        "fields": fields,
        "documents": documents,
        "confidencePct": round((captured / len(fields)) * 100),
        "receivedAt": "just now",
        "receivedFull": m.get("date"),
        "attachments": [*(item.get("attachments") or []), *[a["filename"] for a in attachments]],
        "raw": f"{item.get('raw') or ''}\n\n---- Distributor replied ----\n{m.get('body')}".strip(),
    }


def _save_attachments(item_id: str, attachments: list) -> None:
    """Persists each attachment's raw bytes against the intake item's id, so the real file can
    be served back later (Document Authenticity's "View original", Intake Review's document
    preview) instead of a synthetic mock stand-in. Best-effort — never blocks polling."""
    for a in attachments:
        content = a.get("content")
        if not content:
            continue
        try:
            attachment_store.save(item_id, a["filename"], content)
        except Exception as e:  # noqa: BLE001
            print(f"attachment save failed: {a.get('filename')} {e}")


def poll() -> None:
    if not mailbox_configured():
        _set_inbox_state({"configured": False, "connected": False})
        return
    try:
        msgs = fetch_recent()
        _set_inbox_state({"configured": True, "connected": True, "address": mailbox_address()})
        for m in msgs:
            if store.has(m["msgId"]):
                continue
            replied_to = _find_replied_to_item(m)
            ex = extract_intake(source=m.get("from", ""), subject=m.get("subject", ""), body=m.get("body", ""))
            # Document intelligence: read the attachments to recover fields the email omitted.
            doc_extracted: list = []
            docs_text = "\n\n".join(a["text"] for a in (m.get("attachments") or []) if a.get("text"))
            if docs_text and any(not f["ok"] for f in ex["fields"]):
                doc_ex = extract_intake(source="", subject="Attached documents", body=docs_text)
                doc_extracted = _build_recovered(ex["fields"], doc_ex["fields"], m.get("attachments") or [])
            if replied_to:
                patch = _merge_reply(replied_to, m, ex, doc_extracted)
                store.update(replied_to["id"], patch)
                store.mark_seen(m["msgId"])
                _save_attachments(replied_to["id"], m.get("attachments") or [])
                filled = sum(
                    1 for i, f in enumerate(patch["fields"])
                    if f["ok"] and not replied_to["fields"][i]["ok"]
                )
                print(f"intake: reply from {m['from']} matched {replied_to['id']} — filled {filled} field(s)")
                continue
            item = _to_item(m, ex, doc_extracted)
            store.add(item)
            _save_attachments(item["id"], m.get("attachments") or [])
            captured = sum(1 for f in ex["fields"] if f["ok"])
            print(f"intake: {m['subject']} -> {captured} from email + {len(doc_extracted)} from docs ({ex['engine']})")
    except Exception as err:  # noqa: BLE001 - mirror Node's catch-all
        _set_inbox_state({
            "configured": True, "connected": False, "address": mailbox_address(),
            "error": str(err) or "connect failed",
        })
        print(f"poll error: {err}")


def _poll_loop() -> None:
    poll()
    while True:
        time.sleep(POLL_SECONDS)
        poll()


def start_background_poller() -> None:
    """Runs the IMAP poll loop on a daemon thread rather than mixing blocking IMAP I/O into
    the asyncio event loop — call once from FastAPI's startup handler."""
    thread = threading.Thread(target=_poll_loop, name="intake-poller", daemon=True)
    thread.start()


@router.get("/api/health")
def api_health():
    return {
        "ok": True,
        "openaiKey": key_configured(),
        "inbox": _get_inbox_state(),
        "smtp": mailer.configured(),
    }


# One-off extraction (used by the "Paste email" flow in the UI)
@router.post("/api/extract")
async def api_extract(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    body = body or {}
    try:
        result = extract_intake(
            source=body.get("source", ""), subject=body.get("subject", ""), body=body.get("body", ""),
        )
        return result
    except Exception as err:  # noqa: BLE001
        print(f"extract failed: {err}")
        return JSONResponse(status_code=502, content={"error": "extraction failed"})


# Extracts fields from a manually-uploaded document's REAL content (Intake Review's "attach a
# missing document" flow) — reuses the same PDF/text extraction and field-extraction pipeline
# the IMAP poller uses for email attachments, so what's shown as "found in this document" is
# genuinely pulled from the uploaded file, not a synthetic/mock stand-in.
@router.post("/api/extract-document")
async def api_extract_document(file: UploadFile = File(...)):
    try:
        content = await file.read()
        text = attachment_text(file.filename or "", file.content_type or "", content)
        if not text.strip():
            return {"fields": [], "summary": "No readable text found in this document.", "engine": "none"}
        result = extract_intake(source="", subject=file.filename or "Uploaded document", body=text)
        return result
    except Exception as err:  # noqa: BLE001
        print(f"document extract failed: {err}")
        return JSONResponse(status_code=502, content={"error": "extraction failed"})


# Serves a real email-captured attachment's raw bytes (Document Authenticity's "View original",
# Intake Review's document preview) instead of a synthetic mock stand-in — 404s if this item
# never had that attachment saved (e.g. it predates this feature, or was never received).
@router.get("/api/intake/{item_id}/attachment")
def api_intake_attachment(item_id: str, filename: str):
    content = attachment_store.read(item_id, filename)
    if content is None:
        return JSONResponse(status_code=404, content={"error": "attachment not found"})
    media_type, _ = mimetypes.guess_type(filename)
    return Response(
        content=content,
        media_type=media_type or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


class LocateTextRequest(BaseModel):
    filename: str
    query: str


# Finds where an extracted field's value (e.g. a GSTIN) actually sits on the real attached
# PDF's page, so the frontend can highlight the genuine document instead of a mock preview row.
# 404s the same way the attachment endpoint does if there's no real file on record; returns an
# empty match list (not an error) if the file is real but the value just isn't found in it —
# that's a legitimate "couldn't verify against the source" outcome, not a failure.
@router.post("/api/intake/{item_id}/locate-text")
def api_intake_locate_text(item_id: str, body: LocateTextRequest):
    content = attachment_store.read(item_id, body.filename)
    if content is None:
        return JSONResponse(status_code=404, content={"error": "attachment not found"})
    if not body.filename.lower().endswith(".pdf"):
        return {"matches": []}
    try:
        matches = pdf_locate.locate_text(content, body.query)
    except Exception as err:  # noqa: BLE001
        print(f"locate-text failed: {item_id}/{body.filename} {err}")
        return {"matches": []}
    return {"matches": matches}


# Everything the poller has extracted (the frontend merges these into the inbox)
@router.get("/api/intake")
def api_intake():
    return store.all()


@router.get("/api/inbox/status")
def api_inbox_status():
    return _get_inbox_state()


# Sends a real reply over SMTP — used to request missing fields straight from an intake mail.
# `itemId` (the intake item this request is about) is recorded against the sent Message-ID so
# the poller can recognize the distributor's eventual reply and merge it back into this same
# item instead of filing it as a new, unrelated enquiry.
@router.post("/api/mail/reply")
async def api_mail_reply(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    body = body or {}
    to = body.get("to")
    subject = body.get("subject")
    text = body.get("text")
    item_id = body.get("itemId")
    # Names of required documents being requested (a subset of the missing-info selection) —
    # each gets a "what this should look like" sample PDF attached, so the ask is concrete
    # instead of just naming the document.
    attach_docs = body.get("attachDocs") or []
    if not to or not text:
        return JSONResponse(status_code=400, content={"error": "to and text are required"})
    if not mailer.configured():
        return JSONResponse(status_code=503, content={"error": "SMTP not configured on the server"})
    try:
        attachments = []
        for doc_name in attach_docs:
            pdf_bytes = sample_forms.sample_pdf_for(doc_name)
            if pdf_bytes:
                filename = re.sub(r"[^a-z0-9]+", "-", doc_name.lower()).strip("-")
                attachments.append({"filename": f"sample-{filename}.pdf", "content": pdf_bytes})
        info = mailer.send_mail(to=to, subject=subject or "(no subject)", text=text, attachments=attachments or None)
        if item_id:
            store.record_awaiting_reply(item_id, info["messageId"])
        return {"ok": True, "messageId": info["messageId"]}
    except Exception as err:  # noqa: BLE001
        print(f"send mail failed: {err}")
        return JSONResponse(status_code=502, content={"error": str(err) or "send failed"})
