"""Miro board importer: `uv run python -m app.importers.miro --board <id> --project <slug>`."""


class MiroImportError(Exception):
    """The board cannot be imported; the message tells the user what to fix."""
