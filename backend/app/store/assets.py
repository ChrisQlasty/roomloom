"""Content-addressed asset files: `assets/<sha256>.<ext>`, thumbnails in `assets/thumbs/`.

Files are never deleted: any history snapshot may still reference them.
"""

import hashlib
from pathlib import Path
from typing import Literal

from app.images.processing import EncodedImage, clean_photo, clean_texture, thumbnail_jpeg
from app.schema.ids import new_id
from app.schema.scene import AssetMeta, Scene
from app.store.atomic import write_atomic

_THUMBS = "thumbs"
_MAX_HINT = 40  # characters of the file name used for a readable asset id


class AssetStore:
    """Asset files of one project folder."""

    def __init__(self, project_dir: Path) -> None:
        self._dir = project_dir

    def add_photo(self, data: bytes, filename: str | None) -> AssetMeta:
        """Store an uploaded photo: upright, EXIF-free (incl. GPS), at most 4096 px, as JPEG.

        Identical results share one file. Also writes the 320 px thumbnail.
        """
        return self._store(clean_photo(data), "photo", filename)

    def add_texture(self, data: bytes, original_name: str | None = None) -> AssetMeta:
        """Store a texture losslessly as metadata-free PNG, plus its thumbnail."""
        return self._store(clean_texture(data), "texture", original_name)

    def path_for(self, asset: AssetMeta, thumb: bool = False) -> Path:
        """Absolute path of the asset file, or of its JPEG thumbnail (created when missing)."""
        path = self._dir / asset.path
        if not thumb:
            return path
        thumb_path = self._dir / "assets" / _THUMBS / f"{asset.sha256}.jpg"
        if not thumb_path.exists():
            thumb_path.parent.mkdir(parents=True, exist_ok=True)
            write_atomic(thumb_path, thumbnail_jpeg(path.read_bytes()))
        return thumb_path

    def _store(
        self, image: EncodedImage, kind: Literal["photo", "texture"], name: str | None
    ) -> AssetMeta:
        sha = hashlib.sha256(image.data).hexdigest()
        meta = AssetMeta(
            kind=kind,
            path=f"assets/{sha}.{image.ext}",
            sha256=sha,
            w=image.w,
            h=image.h,
            original_name=name or None,
        )
        path = self._dir / meta.path
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            write_atomic(path, image.data)
        self.path_for(meta, thumb=True)
        return meta


def find_by_sha(scene: Scene, sha256: str) -> str | None:
    """Id of the scene asset with this content hash, if any."""
    return next((aid for aid, meta in scene.assets.items() if meta.sha256 == sha256), None)


def with_asset(scene: Scene, meta: AssetMeta) -> tuple[Scene, str]:
    """A copy of `scene` with `meta` added under a new readable id (from the original name)."""
    hint = Path(meta.original_name).stem[:_MAX_HINT] if meta.original_name else meta.kind
    asset_id = new_id("asset", scene.assets, hint)
    return scene.model_copy(update={"assets": {**scene.assets, asset_id: meta}}), asset_id
