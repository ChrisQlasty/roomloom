"""Projects on disk: `<root>/<slug>/` with project.json, scene.json, history/ and assets/."""

import logging
import re
import shutil
from datetime import datetime
from pathlib import Path

from pydantic import Field, ValidationError

from app.images.processing import PROJECT_THUMB_PX, thumbnail_jpeg
from app.schema.history import ChangeSetMeta
from app.schema.io import load_scene
from app.schema.project import SLUG_PATTERN, Project
from app.schema.scene import Scene
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


class ProjectStore:
    """All projects under one root folder, with their shared `History`."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.history = History(self)

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
            updated_at=entries[-1].ts if entries else project.created_at,
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

    def assets(self, slug: str) -> AssetStore:
        """Asset files of the project."""
        return AssetStore(self.require(slug))

    async def create(self, project: Project, scene: Scene) -> ChangeSetMeta:
        """Write a new project and commit its scene as change set 1, "Imported".

        Raises `ProjectExists` if the folder exists. On failure nothing is left behind.
        """
        folder = self.root / project.slug
        try:
            folder.mkdir(parents=True)
        except FileExistsError as e:
            raise ProjectExists(project.slug) from e
        try:
            write_atomic(
                folder / "project.json", (project.model_dump_json(indent=2) + "\n").encode()
            )
            return await self.history.commit(project.slug, scene, BASELINE_DESCRIPTION, "import")
        except BaseException:
            shutil.rmtree(folder)
            raise

    def thumbnail_path(self, slug: str) -> Path:
        """Where the project-picker image lives (it may not exist yet)."""
        return self.require(slug) / _THUMBNAIL

    def save_thumbnail(self, slug: str, data: bytes) -> None:
        """Store the project-picker image as a JPEG of at most 640 px."""
        write_atomic(self.thumbnail_path(slug), thumbnail_jpeg(data, PROJECT_THUMB_PX))
