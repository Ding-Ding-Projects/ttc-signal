"""Typeset the researched station histories as a linked, phone-sized PDF."""
from xml.sax.saxutils import escape, quoteattr
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, PageBreak
from build_station_atlas import load_records, station_slug, OUT, LINES

INK = colors.HexColor("#19382d")
GREEN = colors.HexColor("#365b3d")
BASE = "https://ding-ding-projects.github.io/ttc-signal/stations/"
styles = {
    "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=23, leading=25, textColor=INK, spaceAfter=10),
    "section": ParagraphStyle("section", fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=INK, spaceAfter=6),
    "body": ParagraphStyle("body", fontName="Helvetica", fontSize=10, leading=14, textColor=INK, spaceAfter=5),
    "caption": ParagraphStyle("caption", fontName="Helvetica", fontSize=8, leading=11, textColor=GREEN, spaceAfter=7)
}


def anchor(url, label):
    return f'<link href={quoteattr(url)} color="#315839"><u>{escape(label)}</u></link>'


def build():
    rows = sorted(load_records().values(), key=lambda r: station_slug(r))
    story = []
    def add(style, markup):
        story.append(Paragraph(markup, styles[style]))
    add("title", '<a name="contents"/>Toronto station atlas')
    add("body", "A history of TTC rapid transit. Choose a station to jump to its history and sources.")
    for former in (False, True):
        add("section", "Former stations and platforms" if former else "Operating stations and stops")
        for r in rows:
            if (r.get("status") == "Former") == former:
                add("body", anchor("#"+station_slug(r),r["name"]))
    for r in rows:
        story.append(PageBreak())
        ident = station_slug(r)
        add("caption", anchor("#contents", "Station index") + "  /  " + anchor(BASE+ident+"/", "Online station page"))
        add("title", '<a name="'+ident+'"/>'+escape(r["name"]))
        add("caption", ('Former · ' if r.get("status") else '') + ' · '.join(f'Line {n} {LINES[n]}' for n in r['lines']))
        for e in r["events"]:
            add("section", escape(str(e["date"])))
            add("body", escape(e["text"]))
            urls = list(dict.fromkeys(filter(None,[e["source"],e.get("dateSource"),*e.get("also",[])])))
            add("caption", " · ".join(anchor(url, f"Source {i+1}") for i,url in enumerate(urls)))
        add("caption", anchor(r["source"],"Station reference"))
    def footer(canvas, doc):
        canvas.setFillColor(GREEN)
        canvas.setFont("Helvetica",8)
        canvas.drawString(10*mm,7*mm,"SIGNAL TORONTO")
        canvas.drawRightString(100*mm,7*mm,str(doc.page))
    doc = SimpleDocTemplate(str(OUT / "station-atlas.pdf"), pagesize=(110*mm,180*mm),
                            leftMargin=10*mm,rightMargin=10*mm,topMargin=12*mm,bottomMargin=15*mm,
                            title="Signal Toronto Station Atlas",author="Signal Toronto")
    doc.build(story,onFirstPage=footer,onLaterPages=footer)


if __name__ == "__main__":
    build()
