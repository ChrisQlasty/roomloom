"""Synthetic test images built with Pillow."""

import io

from PIL import ExifTags, Image

GPS = {
    ExifTags.GPS.GPSLatitudeRef: "N",
    ExifTags.GPS.GPSLatitude: (52.0, 13.0, 30.0),
    ExifTags.GPS.GPSLongitudeRef: "E",
    ExifTags.GPS.GPSLongitude: (21.0, 0.0, 45.0),
}


def jpeg(
    size: tuple[int, int] = (60, 40),
    color: str = "red",
    orientation: int | None = None,
    gps: bool = False,
) -> bytes:
    """A JPEG with optional EXIF orientation and GPS position."""
    exif = Image.Exif()
    exif[ExifTags.Base.Make] = "TestCam"
    if orientation:
        exif[ExifTags.Base.Orientation] = orientation
    if gps:
        exif[ExifTags.Base.GPSInfo] = GPS
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "JPEG", exif=exif)
    return buf.getvalue()


def png(size: tuple[int, int] = (64, 64), mode: str = "RGBA") -> bytes:
    """A half-transparent PNG."""
    buf = io.BytesIO()
    Image.new(mode, size, (0, 128, 255, 128) if mode == "RGBA" else (0, 128, 255)).save(buf, "PNG")
    return buf.getvalue()


def palette_png(size: tuple[int, int] = (4, 4)) -> bytes:
    """A palette PNG whose every pixel is palette index 0, marked transparent via tRNS."""
    img = Image.new("P", size, 0)
    img.putpalette([0, 0, 0, 255, 0, 0])
    buf = io.BytesIO()
    img.save(buf, "PNG", transparency=0)
    return buf.getvalue()


def cmyk_jpeg(size: tuple[int, int] = (8, 8), icc: bytes | None = None) -> bytes:
    """A CMYK JPEG, optionally carrying an ICC profile."""
    buf = io.BytesIO()
    Image.new("CMYK", size, (0, 255, 255, 0)).save(
        buf, "JPEG", **({"icc_profile": icc} if icc else {})
    )
    return buf.getvalue()


def open_bytes(data: bytes) -> Image.Image:
    """Decode image bytes."""
    img = Image.open(io.BytesIO(data))
    img.load()
    return img
