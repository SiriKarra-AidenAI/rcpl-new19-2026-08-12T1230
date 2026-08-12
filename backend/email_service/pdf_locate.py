"""Finds where an extracted field's value actually sits on a real PDF page, so the frontend
can draw a highlight over the genuine document instead of a synthetic mock table (see
docSource.ts's FOCUS_ROW_BY_FIELD, which only ever highlighted a fake preview row).

Uses pypdf's text-extraction visitor callback to capture each text run's position (from its
text matrix) as it's drawn, then searches the reconstructed page text for the field's value and
maps the match back to the run(s) that produced it. Per-run widths are estimated from character
count and font size (pypdf doesn't expose per-glyph advance widths), so boxes are close but not
pixel-exact — fine for a highlight rectangle, not for text selection.
"""
import io
import re


def _normalize(s: str) -> str:
    return re.sub(r"\s+", "", s or "").lower()


def locate_text(pdf_bytes: bytes, query: str) -> list[dict]:
    from pypdf import PdfReader

    query_norm = _normalize(query)
    if len(query_norm) < 3:
        return []

    reader = PdfReader(io.BytesIO(pdf_bytes))
    matches: list[dict] = []

    for page_index, page in enumerate(reader.pages):
        box = page.mediabox
        page_w = float(box.width)
        page_h = float(box.height)
        if page_w <= 0 or page_h <= 0:
            continue

        runs: list[dict] = []

        def visitor(text, cm, tm, font_dict, font_size, _runs=runs):
            if not text or not text.strip():
                return
            size = font_size or 10
            x, y = tm[4], tm[5]
            _runs.append({"text": text, "x": x, "y": y, "size": size})

        try:
            page.extract_text(visitor_text=visitor)
        except Exception:  # noqa: BLE001
            continue
        if not runs:
            continue

        # Build one normalized string covering every run, tracking which run each character
        # of it came from, so a match spanning run boundaries (e.g. split across two draw
        # calls) still maps back to real positions.
        full = ""
        owner: list[int] = []
        for i, run in enumerate(runs):
            norm = _normalize(run["text"])
            full += norm
            owner += [i] * len(norm)

        start = full.find(query_norm)
        if start == -1:
            continue
        end = start + len(query_norm) - 1
        run_indices = sorted(set(owner[start:end + 1]))
        hit_runs = [runs[i] for i in run_indices]

        x0 = min(r["x"] for r in hit_runs)
        y0 = min(r["y"] - r["size"] * 0.25 for r in hit_runs)
        x1 = max(r["x"] + len(r["text"]) * r["size"] * 0.52 for r in hit_runs)
        y1 = max(r["y"] + r["size"] * 0.85 for r in hit_runs)

        matches.append({
            "page": page_index,
            # Normalized 0..1 fractions of the page — the frontend only needs its own
            # rendered page's pixel size to convert these, not the PDF's raw point units.
            "x": max(0.0, x0 / page_w),
            "y": max(0.0, (page_h - y1) / page_h),
            "width": min(1.0, (x1 - x0) / page_w),
            "height": min(1.0, (y1 - y0) / page_h),
        })

    return matches
