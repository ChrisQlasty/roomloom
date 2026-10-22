import io
import struct

import pytest
from PIL import ExifTags, Image, ImageCms

from app.images import processing
from app.images.processing import (
    InvalidImage,
    clean_photo,
    clean_texture,
    thumbnail_jpeg,
)
from tests.images import cmyk_jpeg, jpeg, open_bytes, palette_png, png

SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
LAB = ImageCms.ImageCmsProfile(ImageCms.createProfile("LAB")).tobytes()


def test_fixture_photo_really_carries_gps_and_orientation() -> None:
    exif = open_bytes(jpeg(orientation=6, gps=True)).getexif()
    assert exif[ExifTags.Base.Orientation] == 6
    assert exif.get_ifd(ExifTags.IFD.GPSInfo)


def test_photo_is_rotated_upright_and_all_exif_including_gps_is_removed() -> None:
    out = clean_photo(jpeg((60, 40), orientation=6, gps=True))
    img = open_bytes(out.data)
    assert (out.w, out.h) == img.size == (40, 60)  # orientation 6 = rotate 90° to display
    assert img.format == "JPEG" and out.ext == "jpg"
    assert len(img.getexif()) == 0
    assert "exif" not in img.info and "xmp" not in img.info
    assert b"Exif\x00\x00" not in out.data and b"TestCam" not in out.data


def test_photo_long_side_is_capped_at_4096() -> None:
    out = clean_photo(jpeg((5000, 100)))
    assert (out.w, out.h) == (4096, 82)


def test_small_photo_keeps_its_size() -> None:
    out = clean_photo(jpeg((300, 200)))
    assert (out.w, out.h) == (300, 200)


def test_same_input_gives_identical_bytes() -> None:
    data = jpeg(gps=True)
    assert clean_photo(data).data == clean_photo(data).data


def test_transparent_png_photo_becomes_rgb_jpeg() -> None:
    out = clean_photo(png())
    assert open_bytes(out.data).mode == "RGB"


def test_texture_is_lossless_png_without_metadata() -> None:
    out = clean_texture(jpeg((32, 16), gps=True))
    img = open_bytes(out.data)
    assert img.format == "PNG" and out.ext == "png" and (out.w, out.h) == (32, 16)
    assert len(img.getexif()) == 0


def test_thumbnail_is_a_jpeg_of_at_most_320_px() -> None:
    img = open_bytes(thumbnail_jpeg(jpeg((1000, 500))))
    assert img.format == "JPEG" and img.size == (320, 160)


def test_thumbnail_honours_a_custom_size() -> None:
    assert open_bytes(thumbnail_jpeg(png((2000, 1000)), 640)).size == (640, 320)


def test_transparent_palette_photo_is_flattened_onto_white() -> None:
    img = open_bytes(clean_photo(palette_png()).data)
    assert img.getpixel((0, 0)) == (255, 255, 255)


def test_transparent_palette_texture_keeps_its_alpha() -> None:
    img = open_bytes(clean_texture(palette_png()).data)
    assert img.mode == "RGBA" and img.getpixel((0, 0))[3] == 0


def test_cmyk_texture_becomes_rgb_png_without_its_cmyk_profile() -> None:
    out = clean_texture(cmyk_jpeg(icc=LAB))
    img = open_bytes(out.data)
    assert img.format == "PNG" and img.mode == "RGB" and (out.w, out.h) == (8, 8)
    assert "icc_profile" not in img.info


def test_photo_drops_a_profile_of_another_colour_space() -> None:
    assert "icc_profile" not in open_bytes(clean_photo(cmyk_jpeg(icc=LAB)).data).info


def test_photo_keeps_an_rgb_profile() -> None:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(buf, "JPEG", icc_profile=SRGB)
    assert open_bytes(clean_photo(buf.getvalue()).data).info.get("icc_profile") == SRGB


@pytest.mark.parametrize("data", [b"", b"not an image", jpeg()[:200]])
def test_garbage_is_rejected(data: bytes) -> None:
    with pytest.raises(InvalidImage):
        clean_photo(data)


@pytest.mark.parametrize(
    "error", [ValueError("tile cannot extend outside image"), SyntaxError("bad"), struct.error()]
)
def test_any_pillow_decode_error_is_invalid_image(
    monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    def broken(_img: Image.Image) -> Image.Image:
        raise error

    monkeypatch.setattr(processing.ImageOps, "exif_transpose", broken)
    with pytest.raises(InvalidImage):
        clean_photo(jpeg())
