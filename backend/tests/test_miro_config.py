from pathlib import Path

import pytest
import yaml

from app.importers.miro import MiroImportError
from app.importers.miro.config import CONFIG_FILE, DEFAULT_CONFIG_YAML, ImportConfig, load_config


def test_default_file_matches_the_model_defaults() -> None:
    assert ImportConfig.model_validate(yaml.safe_load(DEFAULT_CONFIG_YAML)) == ImportConfig()


def test_first_load_creates_the_file(tmp_path: Path) -> None:
    folder = tmp_path / "new-project"
    config, created = load_config(folder)
    assert created and (folder / CONFIG_FILE).read_text() == DEFAULT_CONFIG_YAML
    assert config == ImportConfig()
    assert load_config(folder) == (config, False)


def test_colours_are_normalised_and_partial_files_keep_defaults(tmp_path: Path) -> None:
    (tmp_path / CONFIG_FILE).write_text('shape_colors:\n  door: [" #ABCDEF "]\n')
    config, created = load_config(tmp_path)
    assert not created
    assert config.shape_colors.door == ["#abcdef"]
    assert config.shape_colors.window == ImportConfig().shape_colors.window
    assert config.defaults.window.sill == 0.9


@pytest.mark.parametrize("text", ["snap_tolerance_m: [", "unknown_key: 1", "snap_tolerance_m: 2"])
def test_invalid_config_is_a_clear_error(tmp_path: Path, text: str) -> None:
    (tmp_path / CONFIG_FILE).write_text(text)
    with pytest.raises(MiroImportError, match="not a valid import config"):
        load_config(tmp_path)
