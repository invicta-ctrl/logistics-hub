# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "segno==1.6.6",
#   "pillow==12.3.0",
#   "numpy==2.4.6",
#   "resvg-py==0.5.0",
#   "zxing-cpp==3.1.1",
#   "opencv-python-headless==5.0.0.93",
# ]
# ///
"""Generate and verify the one permanent Logistics Hub Self-Service QR code.

Run from anywhere (uv reads the pinned dependencies above; no npm deps):

    uv run scripts/generate-self-service-qr.py

Writes public/qr/logistics-self-service.svg and .png, then proves them:
  - PNG decodes to the exact URL bytes (zxing-cpp and OpenCV, two decoders);
  - SVG rasterised by resvg is pixel-identical to the PNG and decodes too;
  - a degraded copy (~300 px, Gaussian blur) still decodes.
Exits non-zero on any failure. The payload must never gain item, quantity,
or borrower data: it is a public, permanent entry point.
"""

import hashlib
import io
import sys
from pathlib import Path

import cv2
import numpy as np
import resvg_py
import segno
import zxingcpp
from PIL import Image, ImageFilter

URL = "https://logistics.hausc.org/self-service"
TITLE = "Logistics Hub Self-Service — logistics.hausc.org/self-service"
ERROR = "Q"
QUIET = 4  # modules of white border (ISO/IEC 18004 minimum)
MIN_PNG_PX = 2048
OUT = Path(__file__).resolve().parent.parent / "public" / "qr"
SVG_PATH = OUT / "logistics-self-service.svg"
PNG_PATH = OUT / "logistics-self-service.png"


def build_svg(qr: segno.QRCode) -> str:
    size = qr.symbol_size(border=QUIET)[0]
    runs = []
    for y, row in enumerate(qr.matrix, start=QUIET):
        x = 0
        while x < len(row):
            if row[x]:
                start = x
                while x < len(row) and row[x]:
                    x += 1
                n = x - start
                runs.append(f"M{start + QUIET} {y}h{n}v1h-{n}z")
            else:
                x += 1
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'shape-rendering="crispEdges"><title>{TITLE}</title>'
        f'<rect width="{size}" height="{size}" fill="#fff"/>'
        f'<path fill="#000" d="{"".join(runs)}"/></svg>\n'
    )


def decode(label: str, img: Image.Image) -> str:
    gray = img.convert("L")
    zx = zxingcpp.read_barcodes(gray, formats=zxingcpp.BarcodeFormat.QRCode)
    assert len(zx) == 1, f"{label}: zxing-cpp found {len(zx)} codes"
    r = zx[0]
    assert r.valid and r.bytes == URL.encode("ascii"), f"{label}: zxing read {r.bytes!r}"
    assert r.symbology_identifier == "]Q1", f"{label}: unexpected ECI/model {r.symbology_identifier}"
    cv_text = cv2.QRCodeDetector().detectAndDecode(np.asarray(gray))[0]
    assert cv_text == URL, f"{label}: OpenCV read {cv_text!r}"
    return f"{label:<30} {gray.width}px  zxing OK (v{r.extra['Version']}-{r.ec_level}, mask {r.extra['DataMask']})  opencv OK"


def main() -> None:
    qr = segno.make(URL, error=ERROR, boost_error=False, micro=False)
    assert qr.mode == "byte" and qr.error == ERROR, (qr.mode, qr.error)
    modules = qr.symbol_size(border=QUIET)[0]
    scale = -(-MIN_PNG_PX // modules)  # smallest integer px/module reaching the minimum

    OUT.mkdir(parents=True, exist_ok=True)
    SVG_PATH.write_text(build_svg(qr), encoding="utf-8", newline="\n")
    qr.save(PNG_PATH, kind="png", scale=scale, border=QUIET, dark="#000", light="#fff")

    png = Image.open(PNG_PATH)
    png.load()
    assert png.size == (modules * scale,) * 2 and png.mode in ("1", "L"), (png.size, png.mode)
    svg_raster = Image.open(io.BytesIO(bytes(resvg_py.svg_to_bytes(svg_path=str(SVG_PATH), width=png.width))))
    same = np.array_equal(np.asarray(svg_raster.convert("L")), np.asarray(png.convert("L")))
    assert same, "SVG raster differs from PNG"
    degraded = png.convert("L").resize((300, 300), Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(1.2))

    lines = [
        f"payload       {URL!r} ({len(URL.encode())} bytes, {qr.mode} mode, no ECI)",
        f"symbol        version {qr.version}, EC {qr.error}, mask {qr.mask}, "
        f"{qr.symbol_size(border=0)[0]} modules + {QUIET}-module quiet zone = {modules}",
        "contrast      #000 on #fff (21:1)",
        decode("PNG", png),
        decode("SVG (resvg, pixel-identical)", svg_raster),
        decode("degraded (300px + blur 1.2)", degraded),
    ]
    for path in (SVG_PATH, PNG_PATH):
        data = path.read_bytes()
        extra = f"{png.width}x{png.height} {'1-bit' if png.mode == '1' else '8-bit'} grayscale, {scale}px/module" if path == PNG_PATH else "1 path, crispEdges"
        lines.append(f"{path.name:<27} {len(data):>6} B  sha256 {hashlib.sha256(data).hexdigest()[:16]}  {extra}")
    print("\n".join(lines))
    print("PASS")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as err:
        print(f"FAIL: {err}", file=sys.stderr)
        sys.exit(1)
