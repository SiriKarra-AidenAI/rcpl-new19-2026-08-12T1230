"""IMAP mailbox reader. Connects with an App Password (never the real account password) read
from the gitignored .env, and returns recent messages parsed to plain fields for extraction.
Ported from server/mailbox.mjs (which used imapflow + mailparser) to stdlib imaplib + email,
to avoid adding a new dependency — behavior and returned message shape are kept identical.

Gmail setup (one time): enable 2-Step Verification, then create an App Password
(Google Account -> Security -> App passwords) and put it in .env as GMAIL_APP_PASSWORD.
Enable IMAP in Gmail settings. Works with any IMAP provider via IMAP_HOST/IMAP_PORT.
"""
import email
import imaplib
import io
import os
import re
from datetime import datetime, timedelta
from email.header import decode_header, make_header
from email.policy import default as default_policy
from email.utils import parsedate_to_datetime
from typing import Optional

HOST = os.environ.get("IMAP_HOST", "imap.gmail.com")
PORT = int(os.environ.get("IMAP_PORT") or "993")
USER = os.environ.get("GMAIL_USER")
# App Passwords are displayed in 4-char groups; strip spaces so a pasted value works as-is.
PASS = re.sub(r"\s+", "", os.environ.get("GMAIL_APP_PASSWORD", ""))


def configured() -> bool:
    return bool(USER and PASS)


def address() -> Optional[str]:
    return USER or None


# Skip anything that isn't a real enquiry: newsletters/promotions/system mail almost always
# carry a List-Unsubscribe or Auto-Submitted header, come from no-reply/system senders, or
# have obvious system subjects. Genuine distributor/vendor emails do not.
_NOISE_FROM = re.compile(
    r"no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?@|accounts\.google\.com"
    r"|@google\.com|@.*(mailchimp|sendgrid|substack|hubspot|mailgun)",
    re.IGNORECASE,
)
_NOISE_SUBJECT = re.compile(
    r"security alert|verify your|finish setting up|2-step verification|password"
    r"|sign-?in attempt|your receipt|invoice #|unsubscribe|newsletter|\bdigest\b|\bwebinar\b",
    re.IGNORECASE,
)


def _is_noise(msg) -> bool:
    from_ = _decode(msg.get("From", "")) or ""
    subject = _decode(msg.get("Subject", "")) or ""
    auto_submitted = msg.get("Auto-Submitted", "") or ""
    precedence = msg.get("Precedence", "") or ""
    bulk = bool(
        msg.get("List-Unsubscribe")
        or re.search(r"auto-(generated|replied|submitted)|bulk", f"{auto_submitted} {precedence}", re.IGNORECASE)
    )
    return bulk or bool(_NOISE_FROM.search(from_)) or bool(_NOISE_SUBJECT.search(subject))


def _decode(value) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return str(value)


def _pdf_to_text(buf: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(buf))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def attachment_text(filename: str, content_type: str, content: bytes) -> str:
    """Extracts plain text from a file's raw bytes — shared by IMAP attachment processing and
    the manual-upload extraction endpoint (see intake_routes.py's /api/extract-document)."""
    if not content:
        return ""
    name = (filename or "").lower()
    content_type = content_type or ""
    is_pdf = content_type == "application/pdf" or name.endswith(".pdf")
    if is_pdf:
        try:
            return _pdf_to_text(content)
        except Exception as e:  # noqa: BLE001
            print(f"pdf parse failed: {filename} {e}")
            return ""
    if content_type.startswith("text/") or re.search(r"\.(txt|csv|eml|md)$", name, re.IGNORECASE):
        try:
            return content.decode("utf-8", errors="replace")
        except Exception:
            return ""
    return ""


def _get_body(msg) -> str:
    body_part = msg.get_body(preferencelist=("plain",))
    if body_part is not None:
        try:
            return body_part.get_content()
        except Exception:
            pass
    html_part = msg.get_body(preferencelist=("html",))
    if html_part is not None:
        try:
            html = html_part.get_content()
            return re.sub(r"<[^>]+>", " ", html)
        except Exception:
            pass
    return ""


def _get_attachments(msg) -> list:
    out = []
    for part in msg.iter_attachments():
        filename = part.get_filename()
        if not filename:
            continue
        filename = _decode(filename)
        try:
            content = part.get_content()
        except Exception:
            continue
        if isinstance(content, str):
            content = content.encode("utf-8")
        content_type = part.get_content_type() or ""
        # `content` (raw bytes) is kept transiently for attachment_store.py to persist against
        # the intake item's id — not included in what gets stored in the item's own JSON record.
        out.append({"filename": filename, "text": attachment_text(filename, content_type, content), "content": content})
    return out


def _references_list(msg) -> Optional[list]:
    raw = msg.get("References")
    if not raw:
        return None
    return [r for r in re.split(r"\s+", raw.strip()) if r]


# Recent messages from INBOX (last `days`, capped at `max`), newest last (matches Node version).
def fetch_recent(days: int = 3, max_msgs: int = 20) -> list:
    if not configured():
        return []
    out = []
    client = imaplib.IMAP4_SSL(HOST, PORT)
    try:
        client.login(USER, PASS)
        client.select("INBOX", readonly=True)
        since = (datetime.now() - timedelta(days=days)).strftime("%d-%b-%Y")
        status, data = client.search(None, "SINCE", since)
        if status != "OK":
            return []
        uids = data[0].split()
        for uid in uids[-max_msgs:]:
            status, msg_data = client.fetch(uid, "(RFC822)")
            if status != "OK" or not msg_data or not msg_data[0]:
                continue
            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw, policy=default_policy)
            if _is_noise(msg):
                continue
            date_hdr = msg.get("Date")
            date_iso = ""
            if date_hdr:
                try:
                    date_iso = parsedate_to_datetime(date_hdr).isoformat()
                except Exception:
                    date_iso = ""
            out.append({
                "msgId": msg.get("Message-ID") or f"uid-{uid.decode() if isinstance(uid, bytes) else uid}",
                "from": _decode(msg.get("From", "")),
                "subject": _decode(msg.get("Subject", "")),
                "date": date_iso,
                "body": _get_body(msg),
                "attachments": _get_attachments(msg),
                # Threading headers — lets the poller recognize this as a reply to a request the
                # app sent earlier (see intake_store.py's awaiting map) instead of a brand-new enquiry.
                "inReplyTo": msg.get("In-Reply-To") or None,
                "references": _references_list(msg),
            })
    finally:
        try:
            client.logout()
        except Exception:
            pass
    return out
