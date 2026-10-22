import hashlib

from app.store.assets import AssetStore, find_by_sha, with_asset
from app.store.projects import ProjectStore
from tests.images import jpeg, open_bytes, png

SLUG = "example-l-house"


def test_add_photo_is_content_addressed_with_thumbnail(store: ProjectStore) -> None:
    assets = store.assets(SLUG)
    meta = assets.add_photo(jpeg((800, 400)), "Hall 1985.JPG")
    path = assets.path_for(meta)
    assert meta.kind == "photo" and meta.original_name == "Hall 1985.JPG"
    assert meta.path == f"assets/{meta.sha256}.jpg"
    assert hashlib.sha256(path.read_bytes()).hexdigest() == meta.sha256
    assert (meta.w, meta.h) == (800, 400)
    thumb = assets.path_for(meta, thumb=True)
    assert thumb.parent.name == "thumbs" and open_bytes(thumb.read_bytes()).size == (320, 160)


def test_identical_upload_is_stored_once(store: ProjectStore) -> None:
    assets = store.assets(SLUG)
    folder = store.require(SLUG) / "assets"

    def files() -> set[str]:
        return {p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file()}

    before = files()
    a = assets.add_photo(jpeg(gps=True), "a.jpg")
    b = assets.add_photo(jpeg(gps=True), "b.jpg")
    assert a.sha256 == b.sha256 and a.path == b.path
    assert files() - before == {f"{a.sha256}.jpg", f"thumbs/{a.sha256}.jpg"}


def test_uploaded_file_has_no_gps(store: ProjectStore) -> None:
    assets = store.assets(SLUG)
    stored = assets.path_for(assets.add_photo(jpeg(gps=True, orientation=8), "gps.jpg"))
    img = open_bytes(stored.read_bytes())
    assert not img.getexif().get_ifd(0x8825)
    assert len(img.getexif()) == 0


def test_add_texture_stores_png(store: ProjectStore) -> None:
    assets = store.assets(SLUG)
    meta = assets.add_texture(png((128, 128)), "brick.png")
    assert meta.kind == "texture" and meta.path.endswith(".png")
    assert open_bytes(assets.path_for(meta).read_bytes()).format == "PNG"
    assert assets.path_for(meta, thumb=True).exists()


def test_missing_thumbnail_of_an_existing_asset_is_created_on_demand(store: ProjectStore) -> None:
    meta = store.load_scene(SLUG).assets["ast_entrance_hall_photo"]
    thumb = AssetStore(store.require(SLUG)).path_for(meta, thumb=True)
    assert open_bytes(thumb.read_bytes()).size == (320, 240)


def test_with_asset_adds_a_readable_id_and_find_by_sha_finds_it(store: ProjectStore) -> None:
    scene = store.load_scene(SLUG)
    meta = store.assets(SLUG).add_photo(jpeg(), "Sala gimnastyczna.jpg")
    assert find_by_sha(scene, meta.sha256) is None
    new_scene, asset_id = with_asset(scene, meta)
    assert asset_id == "ast_sala_gimnastyczna"
    assert find_by_sha(new_scene, meta.sha256) == asset_id
    assert asset_id not in scene.assets  # the input scene is untouched
    _, second_id = with_asset(new_scene, meta.model_copy(update={"original_name": None}))
    assert second_id == "ast_photo"
    _, long_id = with_asset(scene, meta.model_copy(update={"original_name": "a" * 64 + ".jpg"}))
    assert long_id == "ast_" + "a" * 40
