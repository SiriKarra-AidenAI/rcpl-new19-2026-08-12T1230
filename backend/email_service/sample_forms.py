"""Generates a one-page "expected format" reference PDF for each required onboarding document,
so a "request missing info" reply can attach a concrete example instead of just naming the
document. Builds raw PDF bytes directly (same minimal single-page trick as the frontend's
src/lib/pdf.ts buildPdf) rather than pulling in a PDF-authoring dependency.
"""
from typing import Optional

_LINE_HEIGHT = 18
_TOP_Y = 780
_LEFT_X = 56


def _pdf_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _build_pdf_bytes(title: str, lines: list[str]) -> bytes:
    y = _TOP_Y
    content = f"BT /F2 16 Tf {_LEFT_X} {y} Td ({_pdf_escape(title)}) Tj ET\n"
    y -= _LINE_HEIGHT * 2
    for line in lines:
        if y < 56:
            break
        bold = line.startswith("## ")
        text = line[3:] if bold else line
        font = "F2" if bold else "F1"
        content += f"BT /{font} 11 Tf {_LEFT_X} {y} Td ({_pdf_escape(text)}) Tj ET\n"
        y -= _LINE_HEIGHT

    objs = {
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            "/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>"
        ),
        4: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        5: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
        6: f"<< /Length {len(content)} >>\nstream\n{content}endstream",
    }
    pdf = "%PDF-1.4\n"
    offsets: dict[int, int] = {}
    for i in range(1, 7):
        offsets[i] = len(pdf)
        pdf += f"{i} 0 obj\n{objs[i]}\nendobj\n"
    xref = len(pdf)
    pdf += "xref\n0 7\n0000000000 65535 f \n"
    pdf += "".join(f"{offsets[i]:010d} 00000 n \n" for i in range(1, 7))
    pdf += f"trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF"
    return pdf.encode("latin-1", errors="replace")


# What each required document should contain — shown to the sender as a concrete example of an
# acceptable submission, not a legally binding template. "## " prefixes a bold heading line.
_SAMPLE_CONTENT: dict[str, list[str]] = {
    "GST Certificate": [
        "## Expected format",
        "A clear photo/scan of your GST Registration Certificate (Form GST REG-06), showing:",
        "- GSTIN (15-character registration number)",
        "- Legal Name of Business",
        "- Trade Name (if different)",
        "- Principal Place of Business (full address)",
        "- Date of liability / registration",
        "",
        "## Example GSTIN format",
        "27ABCDE1234F1Z5",
    ],
    "GST": [
        "## Expected format",
        "A clear photo/scan of your GST Registration Certificate (Form GST REG-06), showing:",
        "- GSTIN (15-character registration number)",
        "- Legal Name of Business",
        "- Principal Place of Business (full address)",
        "",
        "## Example GSTIN format",
        "27ABCDE1234F1Z5",
    ],
    "FSSAI License": [
        "## Expected format",
        "A clear photo/scan of your valid FSSAI License/Registration Certificate, showing:",
        "- 14-digit FSSAI License Number",
        "- Licensee name and address",
        "- Kind of business",
        "- Valid-from and valid-to dates (must not be expired)",
    ],
    "Godown Proof": [
        "## Expected format",
        "Proof of your godown/warehouse premises, showing:",
        "- Full address of the godown",
        "- Total covered area (in sq. ft.)",
        "- Ownership proof (property tax receipt/electricity bill) OR a signed lease/rent",
        "  agreement if the premises is rented",
        "- A recent photograph of the godown exterior is appreciated but not mandatory",
    ],
    "DB Onboarding Form": [
        "## What this form should cover",
        "Please fill in and sign a document covering the following, on your firm's letterhead",
        "if possible:",
        "- Firm / Agency legal name and constitution (proprietorship/partnership/company)",
        "- Contact person, phone, and email",
        "- Years in distribution business, companies currently handled",
        "- Total monthly turnover and expected RCPL turnover/month",
        "- Godown size and outlet coverage (current and planned)",
        "- Bank account details for payments (account name, number, IFSC, cancelled cheque)",
        "- Signature and date",
    ],
    "PAN": [
        "## Expected format",
        "A clear photo/scan of the firm's PAN card, showing:",
        "- 10-character PAN (e.g. ABCDE1234F)",
        "- Name exactly as registered",
    ],
    "ISO 9001": [
        "## Expected format",
        "A clear photo/scan of your current ISO 9001 certificate, showing:",
        "- Certificate/registration number",
        "- Scope of certification",
        "- Issue date and expiry date (must not be expired)",
        "- Certifying body's name and accreditation mark",
    ],
    "Factory Audit Report": [
        "## Expected format",
        "A recent third-party or internal factory audit report, showing:",
        "- Audit date and auditor/agency name",
        "- Facility name and address",
        "- Overall grade/score",
        "- Key findings and any corrective actions taken",
    ],
}


def sample_pdf_for(doc_name: str) -> Optional[bytes]:
    """Returns a one-page "expected format" reference PDF for a required document name, or
    None if there's no known template for that name (attach nothing rather than guess)."""
    lines = _SAMPLE_CONTENT.get(doc_name)
    if lines is None:
        return None
    return _build_pdf_bytes(f"Sample — {doc_name}", lines)
