"""Project, scene, history, asset and thumbnail endpoints under /api/projects."""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from app.images.processing import InvalidImage
from app.schema.history import ChangeSetMeta
from app.schema.project import Project
from app.schema.scene import AssetMeta, Scene
from app.store.assets import find_by_sha, with_asset
from app.store.history import SnapshotNotFound
from app.store.projects import ProjectNotFound, ProjectStore, ProjectSummary

MAX_UPLOAD_BYTES = 50 * 1024 * 1024

router = APIRouter(prefix="/api/projects")


def get_store(request: Request) -> ProjectStore:
    """The app-wide project store."""
    return request.app.state.store


Store = Annotated[ProjectStore, Depends(get_store)]


class LabelBody(BaseModel):
    """Request body for labelling a change set; null or blank clears the label."""

    label: str | None = Field(max_length=120)


class UploadedAsset(BaseModel):
    """Result of an asset upload."""

    id: str = Field(description="Asset id in scene.assets.")
    asset: AssetMeta
    created: bool = Field(description="False when an identical file was already in the scene.")


async def _read_upload(file: UploadFile) -> bytes:
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File larger than {MAX_UPLOAD_BYTES // 2**20} MB")
    return data


@router.get("")
def list_projects(store: Store) -> list[ProjectSummary]:
    """All projects, most recently edited first."""
    return store.list()


@router.get("/{slug}")
def get_project(slug: str, store: Store) -> Project:
    """project.json of one project."""
    return store.get(slug)


@router.get("/{slug}/scene")
def get_scene(slug: str, store: Store) -> Scene:
    """The current scene."""
    return store.load_scene(slug)


@router.get("/{slug}/history")
def list_history(slug: str, store: Store) -> list[ChangeSetMeta]:
    """Change sets, oldest first."""
    return store.history.list(slug)


@router.post("/{slug}/history/{seq}/restore")
async def restore(slug: str, seq: int, store: Store) -> ChangeSetMeta:
    """Commit the snapshot of `seq` as a new change set."""
    return await store.history.restore(slug, seq)


@router.post("/{slug}/history/{seq}/label")
async def label(slug: str, seq: int, body: LabelBody, store: Store) -> ChangeSetMeta:
    """Name (or unname) a change set as a checkpoint."""
    return await store.history.label(slug, seq, body.label)


@router.post("/{slug}/assets")
async def upload_asset(slug: str, file: UploadFile, store: Store) -> UploadedAsset:
    """Upload a photo; it is cleaned, stored once per content and added to scene.assets."""
    assets = store.assets(slug)
    data = await _read_upload(file)
    meta = await asyncio.to_thread(assets.add_photo, data, file.filename)
    added: list[str] = []

    def add(scene: Scene) -> Scene | None:
        existing = find_by_sha(scene, meta.sha256)
        if existing:
            added.append(existing)
            return None
        new_scene, asset_id = with_asset(scene, meta)
        added.append(asset_id)
        return new_scene

    change = await store.history.apply(
        slug, add, f"Upload photo {meta.original_name or ''}".strip(), "user"
    )
    return UploadedAsset(id=added[0], asset=meta, created=change is not None)


@router.get("/{slug}/assets/{asset_id}")
def get_asset(slug: str, asset_id: str, store: Store, thumb: bool = False) -> FileResponse:
    """An asset file, or its JPEG thumbnail with `?thumb=1`."""
    meta = store.load_scene(slug).assets.get(asset_id)
    if meta is None:
        raise HTTPException(404, f"No asset {asset_id}")
    return FileResponse(store.assets(slug).path_for(meta, thumb=thumb))


@router.post("/{slug}/thumbnail", status_code=204)
async def put_thumbnail(slug: str, file: UploadFile, store: Store) -> None:
    """Replace the project-picker image (re-encoded as JPEG, at most 640 px)."""
    data = await _read_upload(file)
    await asyncio.to_thread(store.save_thumbnail, slug, data)


@router.get("/{slug}/thumbnail")
def get_thumbnail(slug: str, store: Store) -> FileResponse:
    """The project-picker image."""
    path = store.thumbnail_path(slug)
    if not path.is_file():
        raise HTTPException(404, "No thumbnail yet")
    return FileResponse(path, media_type="image/jpeg")


def install(app: FastAPI, store: ProjectStore) -> None:
    """Mount the router on `app` and map store errors to HTTP status codes."""
    app.state.store = store
    app.include_router(router)

    def handler(status: int):
        async def respond(_request: Request, exc: Exception) -> JSONResponse:
            return JSONResponse({"detail": str(exc)}, status_code=status)

        return respond

    app.add_exception_handler(ProjectNotFound, handler(404))
    app.add_exception_handler(SnapshotNotFound, handler(404))
    app.add_exception_handler(InvalidImage, handler(422))
