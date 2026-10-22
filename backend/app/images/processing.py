"""Pure image transforms for uploads: orientation fix, metadata strip, resize and thumbnails."""

import io
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

PHOTO_MAX_PX = 4096
THUMB_PX = 320
PROJECT_THUMB_PX = 640
_JPEG_QUALITY = 90


class InvalidImage(ValueError):
    """The bytes are not an image Pillow can decode, or the image is unreasonably large."""


@dataclass(frozen=True)
class EncodedImage:
    """Encoded file bytes plus what the asset metadata needs."""

    data: bytes
    ext: str
    w: int
    h: int


def _open(data: bytes) -> Image.Image:
    """Decode fully, with EXIF orientation applied, and drop every metadata block."""
    try:
        with Image.open(io.BytesIO(data)) as raw:
            img = ImageOps.exif_transpose(raw)
            img.load()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as e:
        raise InvalidImage(str(e)) from e
    icc = img.info.get("icc_profile")
    img.info = {"icc_profile": icc} if icc else {}
    return img


def _fit(img: Image.Image, max_px: int) -> Image.Image:
    """Shrink so the long side is at most `max_px`, keeping the aspect ratio."""
    if max(img.size) <= max_px:
        return img
    out = img.copy()
    out.thumbnail((max_px, max_px), Image.Resampling.LANCZOS)
    return out


def _jpeg(img: Image.Image) -> bytes:
    """Encode as an sRGB-ish JPEG with no EXIF or XMP; transparency is flattened onto white."""
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        flat = Image.new("RGB", rgba.size, "white")
        flat.paste(rgba, mask=rgba.getchannel("A"))
        img = flat
    elif img.mode != "RGB":
        img = img.convert("RGB")
    buf = io.BytesIO()
    icc = img.info.get("icc_profile")
    img.save(
        buf, "JPEG", quality=_JPEG_QUALITY, optimize=True, **({"icc_profile": icc} if icc else {})
    )
    return buf.getvalue()


def clean_photo(data: bytes) -> EncodedImage:
    """Upright, metadata-free JPEG with the long side at most `PHOTO_MAX_PX`."""
    img = _fit(_open(data), PHOTO_MAX_PX)
    return EncodedImage(_jpeg(img), "jpg", *img.size)


def clean_texture(data: bytes) -> EncodedImage:
    """Metadata-free lossless PNG at the original size."""
    img = _open(data)
    buf = io.BytesIO()
    icc = img.info.get("icc_profile")
    img.save(buf, "PNG", optimize=True, **({"icc_profile": icc} if icc else {}))
    return EncodedImage(buf.getvalue(), "png", *img.size)


def thumbnail_jpeg(data: bytes, max_px: int = THUMB_PX) -> bytes:
    """A JPEG thumbnail with the long side at most `max_px`."""
    return _jpeg(_fit(_open(data), max_px))
