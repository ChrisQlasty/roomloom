"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI app with dev CORS and all routers.

    Served with `uvicorn --factory app.main:create_app`, so importing this module reads no config.
    Tests pass their own `settings` to stay independent of the local `.env`.
    """
    settings = settings or get_settings()
    app = FastAPI(title="RoomLoom")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        """Liveness probe used by the frontend."""
        return {"status": "ok"}

    return app
