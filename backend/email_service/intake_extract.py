"""Intake extraction, shared by the /api/extract endpoint and the Gmail poller.
Uses OpenAI (structured outputs) when OPENAI_API_KEY is set; otherwise a regex fallback,
so polling still produces usable items without a key. Ported from server/extract.mjs —
keep behavior (including the regex fallback) identical to the Node version."""
import os
import re
from typing import Optional

from openai import OpenAI

MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
_api_key = os.environ.get("OPENAI_API_KEY")
_client = OpenAI(api_key=_api_key) if _api_key else None


def key_configured() -> bool:
    return _client is not None


FIELD_LABELS = [
    "Firm / Agency Name", "Contact Person", "Phone Number", "Email Address",
    "Town / City", "State", "DB Type Requested", "Turnover Claim (₹/mo)", "GST Number",
]

_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["fields", "summary", "partnerType", "priority", "region"],
    "properties": {
        "fields": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["label", "value", "ok"],
                "properties": {
                    "label": {"type": "string"},
                    "value": {"type": "string"},
                    "ok": {"type": "boolean"},
                },
            },
        },
        "summary": {"type": "string"},
        "partnerType": {"type": "string", "enum": ["distributor", "vendor"]},
        "priority": {"type": "string", "enum": ["high", "normal", "low"]},
        "region": {"type": "string"},
    },
}

_SYSTEM = (
    "You are RCPL's Intake Agent. From a raw distributor/vendor enquiry email, extract these "
    "nine fields in this exact order and with these exact labels:\n"
    + "\n".join(f"- {label}" for label in FIELD_LABELS)
    + "\nRules:\n"
    "- \"ok\" is true only when the field is genuinely present in the email; otherwise "
    "ok=false and value=\"Not found in the email\".\n"
    "- \"DB Type Requested\": one of GT DB (with CSO/DSM), GM Excl DB, Replacement DB, "
    "Additional DB, Traders — or \"Not applicable (Vendor)\".\n"
    "- \"Turnover Claim (₹/mo)\" formatted like \"₹200L\".\n"
    "- partnerType: \"vendor\" for supplier/packaging/manufacturing/ISO enquiries, else "
    "\"distributor\".\n"
    "- priority: \"high\" for replacement DBs or turnover ≥ ₹200L; \"low\" if fewer "
    "than 4 fields present; else \"normal\".\n"
    "- region: \"Town, StateCode\" (e.g. \"Nashik, MH\") when known, else \"\".\n"
    "- summary: one sentence built ONLY from what you extracted. Do not invent data."
)


def _with_counts(p: dict) -> dict:
    captured = sum(1 for f in p["fields"] if f["ok"])
    out = dict(p)
    out["captured"] = captured
    out["confidencePct"] = round((captured / len(FIELD_LABELS)) * 100)
    return out


def extract_intake(source: str = "", subject: str = "", body: str = "") -> dict:
    if _client is not None:
        try:
            completion = _client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": _SYSTEM},
                    {"role": "user", "content": f"From: {source}\nSubject: {subject}\n\n{body}"},
                ],
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": "intake_extraction", "strict": True, "schema": _SCHEMA},
                },
            )
            import json as _json
            parsed = _json.loads(completion.choices[0].message.content)
            result = _with_counts(parsed)
            result["engine"] = "openai"
            return result
        except Exception as err:  # noqa: BLE001 - mirror Node's catch-all fallback
            print(f"OpenAI extract failed, using regex fallback: {err}")
    result = _with_counts(_regex_extract(source=source, subject=subject, body=body))
    result["engine"] = "regex"
    return result


# ---- regex fallback (no AI) ----
_RX_GST = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b")
_RX_PHONE = re.compile(r"(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b")
_RX_EMAIL = re.compile(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", re.IGNORECASE)
_RX_TURNOVER = re.compile(r"₹?\s*(\d{2,4})\s*L\b", re.IGNORECASE)

_DB_KEYWORDS = [
    (re.compile(r"replacement", re.IGNORECASE), "Replacement DB"),
    (re.compile(r"additional", re.IGNORECASE), "Additional DB"),
    (re.compile(r"gm\s*excl", re.IGNORECASE), "GM Excl DB"),
    (re.compile(r"\bgt\s*db\b|general trade", re.IGNORECASE), "GT DB (with CSO/DSM)"),
    (re.compile(r"\btraders?\b", re.IGNORECASE), "Traders"),
]
_TOWNS = [
    ("Nashik Rural", "MH"), ("Nashik", "MH"), ("Pune", "MH"), ("Mumbai", "MH"),
    ("Nagpur", "MH"), ("Aurangabad", "MH"), ("Kolhapur", "MH"), ("Chalisgaon", "MH"),
    ("Andheri", "MH"), ("Surat", "GJ"), ("Vadodara", "GJ"), ("Ahmedabad", "GJ"), ("Panaji", "GA"),
]
_STATE_NAME = {"MH": "Maharashtra", "GJ": "Gujarat", "GA": "Goa"}
_VENDOR_RE = re.compile(
    r"\bvendor\b|packaging|supplier|supply|iso ?9001|factory audit|manufactur|corrugat",
    re.IGNORECASE,
)


def _title_case(s: str) -> str:
    return re.sub(r"\b\w", lambda m: m.group(0).upper(), s)


def _field(label: str, value: Optional[str]) -> dict:
    if value:
        return {"label": label, "value": value, "ok": True}
    return {"label": label, "value": "Not found in the email", "ok": False}


def _regex_extract(source: str, subject: str, body: str) -> dict:
    text = f"{subject}\n{body}"
    partner_type = "vendor" if _VENDOR_RE.search(text) else "distributor"
    town = next(
        (t for t in _TOWNS if re.search(rf"\b{re.escape(t[0])}\b", text, re.IGNORECASE)),
        None,
    )
    gst_m = _RX_GST.search(text)
    gst = gst_m.group(0) if gst_m else None
    phone_m = _RX_PHONE.search(text)
    phone = re.sub(r"\s+", " ", phone_m.group(0)).strip() if phone_m else None
    email_m = _RX_EMAIL.search(source) or _RX_EMAIL.search(text)
    email = email_m.group(0) if email_m else None
    turn_m = _RX_TURNOVER.search(text)
    turn = turn_m.group(1) if turn_m else None
    db_type = next((label for rx, label in _DB_KEYWORDS if rx.search(text)), None)

    firm_m = re.search(r"\bwe are ([A-Z][\w&.'\- ]{2,44}?)[,.]", body)
    firm = firm_m.group(1) if firm_m else None
    if not firm:
        firm_m2 = re.search(
            r"\b([A-Z][\w&.'\- ]{2,44}?) (?:would like|services?|covers|is an|is a|handling|distributes)",
            body,
        )
        firm = firm_m2.group(1) if firm_m2 else None
    if not firm and email:
        firm = _title_case(re.sub(r"[._-]+", " ", email.split("@")[0]).strip())

    fields = [
        _field("Firm / Agency Name", firm),
        _field("Contact Person", None),
        _field("Phone Number", phone),
        _field("Email Address", email),
        _field("Town / City", town[0] if town else None),
        _field("State", _STATE_NAME[town[1]] if town else None),
        _field(
            "DB Type Requested",
            "Not applicable (Vendor)" if partner_type == "vendor" else db_type,
        ),
        _field("Turnover Claim (₹/mo)", f"₹{turn}L" if turn else None),
        _field("GST Number", gst),
    ]
    captured = sum(1 for x in fields if x["ok"])
    tnum = int(turn) if turn else 0
    priority = "high" if (db_type == "Replacement DB" or tnum >= 200) else ("low" if captured < 4 else "normal")
    missing = sum(1 for x in fields if not x["ok"])
    summary = firm if firm else f"A prospective {partner_type}"
    if town:
        summary += f" in {town[0]}"
    if turn:
        summary += f", ~₹{turn}L/mo"
    summary += f". {captured}/9 fields extracted{f', {missing} missing.' if missing else ' — complete.'}"
    return {
        "fields": fields,
        "summary": summary,
        "partnerType": partner_type,
        "priority": priority,
        "region": f"{town[0]}, {town[1]}" if town else "",
    }
