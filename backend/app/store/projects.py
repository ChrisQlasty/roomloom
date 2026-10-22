"""Projects on disk: `<root>/<slug>/` with project.json, scene.json, history/ and assets/."""

import logging
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path

from pydantic import Field, ValidationError

from app.images.processing import PROJECT_THUMB_PX, thumbnail_jpeg
from app.schema.history import ChangeSetMeta
from app.schema.io import load_scene
from app.schema.project import SLUG_PATTERN, Project
from app.schema.scene import AssetMeta, Scene
from app.store.assets import AssetStore
from app.store.atomic import write_atomic
from app.store.history import BASELINE_DESCRIPTION, History

log = logging.getLogger(__name__)

_SLUG_RE = re.compile(SLUG_PATTERN)
_THUMBNAIL = "thumbnail.jpg"


class ProjectNotFound(LookupError):
    """No project with this slug (or the slug is malformed)."""


class ProjectExists(ValueError):
    """A project folder with this slug already exists."""


class ProjectSummary(Project):
    """A project-picker card: project.json plus the last edit time and thumbnail presence."""

    updated_at: datetime = Field(description="Time of the last change set, else created_at.")
    has_thumbnail: bool = Field(description="True when GET .../thumbnail returns an image.")


def is_valid_slug(slug: str) -> bool:
    """True for lowercase kebab-case slugs such as `old-school`; rules out any path trickery."""
    return _SLUG_RE.fullmatch(slug) is not None


def _write_project(folder: Path, project: Project) -> None:
    write_atomic(folder / "project.json", (project.model_dump_json(indent=2) + "\n").encode())


def _as_utc(ts: datetime) -> datetime:
    """`ts` with a time zone; naive times are UTC by convention (see `Project.created_at`)."""
    return ts if ts.tzinfo else ts.replace(tzinfo=UTC)


class ProjectStore:
    """All projects under one root folder, with their shared `History`."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.history = History(self)
        # slug -> (scene.json identity, scene.assets); see `asset`.
        self._assets: dict[str, tuple[tuple[int, int, int], dict[str, AssetMeta]]] = {}

    def require(self, slug: str) -> Path:
        """Folder of an existing project; raises `ProjectNotFound` otherwise."""
        if not is_valid_slug(slug) or not (self.root / slug / "project.json").is_file():
            raise ProjectNotFound(slug)
        return self.root / slug

    def get(self, slug: str) -> Project:
        """The project's metadata."""
        return Project.model_validate_json((self.require(slug) / "project.json").read_bytes())

    def summary(self, slug: str) -> ProjectSummary:
        """Picker card data for one project."""
        project = self.get(slug)
        entries = self.history.list(slug)
        return ProjectSummary(
            **project.model_dump(),
            updated_at=_as_utc(entries[-1].ts if entries else project.created_at),
            has_thumbnail=self.thumbnail_path(slug).is_file(),
        )

    def list(self) -> list[ProjectSummary]:
        """All readable projects, most recently edited first; broken folders are logged."""
        if not self.root.is_dir():
            return []
        summaries = []
        for folder in sorted(self.root.iterdir()):
            if not (folder / "project.json").is_file() or not is_valid_slug(folder.name):
                continue
            try:
                summaries.append(self.summary(folder.name))
            except (ValidationError, OSError) as e:
                log.warning("skipping unreadable project %s: %s", folder.name, e)
        return sorted(summaries, key=lambda s: s.updated_at, reverse=True)

    def load_scene(self, slug: str) -> Scene:
        """The current scene."""
        return load_scene(self.require(slug) / "scene.json")

    def asset(self, slug: str, asset_id: str) -> AssetMeta | None:
        """Metadata of one asset of the current scene, or None if the scene has no such asset.

        scene.assets is cached and re-read only when scene.json changes on disk, so serving many
        asset files does not parse the whole scene each time.
        """
        path = self.require(slug) / "scene.json"
        st = path.stat()
        key = (st.st_ino, st.st_mtime_ns, st.st_size)
        cached = self._assets.get(slug)
        if cached is None or cached[0] != key:
            cached = (key, load_scene(path).assets)
            self._assets[slug] = cached
        meta = cached[1].get(asset_id)
        return meta.model_copy() if meta else None

    def assets(self, slug: str) -> AssetStore:
        """Asset files of the project."""
        return AssetStore(self.require(slug))

    async def create(self, project: Project, scene: Scene) -> ChangeSetMeta:
        """Write a new project and commit its scene as change set 1, "Imported".

        Raises `ProjectExists` if the folder already holds a project.json. A folder without
        one (e.g. only the importer's `import/` files) is reused. On failure nothing this call
        wrote is left behind.
        """
        folder = self.root / project.slug
        if (folder / "project.json").exists():
            raise ProjectExists(project.slug)
        existed = folder.is_dir()
        folder.mkdir(parents=True, exist_ok=True)
        try:
            _write_project(folder, project)
            return await self.history.commit(project.slug, scene, BASELINE_DESCRIPTION, "import")
        except BaseException:
            if existed:
                for name in ("project.json", "scene.json"):
                    (folder / name).unlink(missing_ok=True)
                shutil.rmtree(folder / "history", ignore_errors=True)
            else:
                shutil.rmtree(folder)
            raise

    async def reimport(self, project: Project, scene: Scene, description: str) -> ChangeSetMeta:
        """Replace an existing project's scene with a fresh import, as a new change set.

        Earlier change sets stay in the history, so the previous shell can still be restored.
        project.json is rewritten only after the scene committed.
        """
        self.require(project.slug)
        meta = await self.history.commit(project.slug, scene, description, "import")
        _write_project(self.root / project.slug, project)
        return meta

    def thumbnail_path(self, slug: str) -> Path:
        """Where the project-picker image lives (it may not exist yet)."""
        return self.require(slug) / _THUMBNAIL

    def save_thumbnail(self, slug: str, data: bytes) -> None:
        """Store the project-picker image as a JPEG of at most 640 px."""
        write_atomic(self.thumbnail_path(slug), thumbnail_jpeg(data, PROJECT_THUMB_PX))
