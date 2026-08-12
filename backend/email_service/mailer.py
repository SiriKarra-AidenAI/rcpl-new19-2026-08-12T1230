"""SMTP sender — reuses the same Gmail App Password as the IMAP reader (intake_mailbox.py)
unless separate SMTP_* vars are set, so a single App Password covers both reading and
replying. Ported from server/mailer.mjs to stdlib smtplib (no new dependency needed)."""
import os
import re
import smtplib
import uuid
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import make_msgid
from typing import Optional, TypedDict


class Attachment(TypedDict):
    filename: str
    content: bytes

HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
PORT = int(os.environ.get("SMTP_PORT") or "465")
USER = os.environ.get("SMTP_USER") or os.environ.get("GMAIL_USER")
PASS = re.sub(r"\s+", "", os.environ.get("SMTP_PASSWORD") or os.environ.get("GMAIL_APP_PASSWORD") or "")


def configured() -> bool:
    return bool(USER and PASS)


def address() -> Optional[str]:
    return USER or None


def send_mail(to: str, subject: str, text: str, attachments: Optional[list[Attachment]] = None) -> dict:
    if not configured():
        raise RuntimeError(
            "SMTP not configured - set GMAIL_USER/GMAIL_APP_PASSWORD (or SMTP_* vars) in .env"
        )
    if attachments:
        msg = MIMEMultipart()
        msg.attach(MIMEText(text))
        for att in attachments:
            part = MIMEApplication(att["content"], _subtype="pdf")
            part.add_header("Content-Disposition", "attachment", filename=att["filename"])
            msg.attach(part)
    else:
        msg = MIMEText(text)
    msg["Subject"] = subject
    msg["From"] = USER
    msg["To"] = to
    message_id = make_msgid()
    msg["Message-ID"] = message_id

    if PORT == 465:
        with smtplib.SMTP_SSL(HOST, PORT) as server:
            server.login(USER, PASS)
            server.sendmail(USER, [to], msg.as_string())
    else:
        with smtplib.SMTP(HOST, PORT) as server:
            server.starttls()
            server.login(USER, PASS)
            server.sendmail(USER, [to], msg.as_string())

    return {"messageId": message_id}
