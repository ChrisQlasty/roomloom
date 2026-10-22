from app.config import Settings


def test_settings_defaults_need_no_keys() -> None:
    settings = Settings(_env_file=None)
    assert settings.anthropic_api_key == ""
    assert settings.monthly_budget_usd == 30.0


def test_settings_read_env_file(tmp_path) -> None:
    env = tmp_path / ".env"
    env.write_text("MONTHLY_BUDGET_USD=12.5\nMIRO_TOKEN=abc\n")
    settings = Settings(_env_file=env)
    assert settings.monthly_budget_usd == 12.5
    assert settings.miro_token == "abc"
