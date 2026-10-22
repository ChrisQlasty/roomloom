"""Pure image transforms for uploads: orientation fix, metadata strip, resize and thumbnails."""

import io
import struct
from dataclasses import dataclass

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

PHOTO_MAX_PX = 4096
THUMB_PX = 320
PROJECT_THUMB_PX = 640
_JPEG_QUALITY = 90
_PNG_MODES = {"1", "L", "LA", "I", "I;16", "P", "RGB", "RGBA"}
_ICC_SPACE = {"1": "GRAY", "L": "GRAY", "LA": "GRAY", "I": "GRAY", "I;16": "GRAY"}
# Pillow reports malformed files with any of these, depending on the codec and where it breaks.
_DECODE_ERRORS = (
    UnidentifiedImageError,
    Image.DecompressionBombError,
    OSError,
    ValueError,
    SyntaxError,
    struct.error,
)


class InvalidImage(ValueError):
    """The bytes are not an image Pillow can decode, or the image is unreasonably large."""


@dataclass(frozen=True)
class EncodedImage:
    """Encoded file bytes plus what the asset metadata needs."""

    data: bytes
    ext: str
    w: int
    h: int


def _open(data: bytes) -> tuple[Image.Image, bytes | None]:
    """Decode fully, with EXIF orientation applied; return the image and its ICC profile.

    Every metadata block is dropped from the image, so no encoder can copy one into its output.
    Palette or colour-key transparency becomes a real alpha channel first, since it lives there.
    """
    try:
        with Image.open(io.BytesIO(data)) as raw:
            img = ImageOps.exif_transpose(raw)
            img.load()
            icc = img.info.get("icc_profile") or None
            if "transparency" in img.info:
                img = img.convert("RGBA")
    except _DECODE_ERRORS as e:
        raise InvalidImage(str(e)) from e
    img.info = {}
    return img, icc


def _icc_kwargs(icc: bytes | None, mode: str) -> dict[str, bytes]:
    """`icc_profile` save option, only when the profile's colour space fits the saved mode."""
    if not icc:
        return {}
    try:
        space = ImageCms.ImageCmsProfile(io.BytesIO(icc)).profile.xcolor_space.strip()
    except OSError:
        return {}
    return {"icc_profile": icc} if space == _ICC_SPACE.get(mode, "RGB") else {}


def _fit(img: Image.Image, max_px: int) -> Image.Image:
    """Shrink so the long side is at most `max_px`, keeping the aspect ratio."""
    if max(img.size) <= max_px:
        return img
    out = img.copy()
    out.thumbnail((max_px, max_px), Image.Resampling.LANCZOS)
    return out


def _jpeg(img: Image.Image, icc: bytes | None) -> bytes:
    """Encode as an sRGB-ish JPEG with no EXIF or XMP; transparency is flattened onto white.

    A profile of another colour space (CMYK, grey) is dropped, as the pixels are now RGB.
    """
    if img.has_transparency_data:
        rgba = img.convert("RGBA")
        flat = Image.new("RGB", rgba.size, "white")
        flat.paste(rgba, mask=rgba.getchannel("A"))
        img = flat
    elif img.mode != "RGB":
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=_JPEG_QUALITY, optimize=True, **_icc_kwargs(icc, "RGB"))
    return buf.getvalue()


def clean_photo(data: bytes) -> EncodedImage:
    """Upright, metadata-free JPEG with the long side at most `PHOTO_MAX_PX`."""
    img, icc = _open(data)
    img = _fit(img, PHOTO_MAX_PX)
    return EncodedImage(_jpeg(img, icc), "jpg", *img.size)


def clean_texture(data: bytes) -> EncodedImage:
    """Metadata-free lossless PNG at the original size; modes PNG cannot hold become RGB(A)."""
    img, icc = _open(data)
    if img.mode not in _PNG_MODES:
        img = img.convert("RGBA" if img.has_transparency_data else "RGB")
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True, **_icc_kwargs(icc, img.mode))
    return EncodedImage(buf.getvalue(), "png", *img.size)


def thumbnail_jpeg(data: bytes, max_px: int = THUMB_PX) -> bytes:
    """A JPEG thumbnail with the long side at most `max_px`."""
    img, icc = _open(data)
    return _jpeg(_fit(img, max_px), icc)
