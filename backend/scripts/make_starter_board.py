"""Create the "RoomLoom starter" board on Miro: an example building plus a Legend frame.

Needs `MIRO_TOKEN` in `.env` with the `boards:read` and `boards:write` scopes. It always creates
a new board (never touches an existing one) and prints its id and link. Check the result with:

    uv run python -m app.importers.miro --board <id> --project starter-check --dry-run

Scale: 1 board unit = 1 cm. The drawing follows `plan/miro-conventions.md`.
"""

import sys
import time
from typing import Any

import httpx

from app.config import get_settings

API_BASE = "https://api.miro.com/v2"
RETRIES = 5

WHITE, DOOR, WINDOW, PASSAGE = "#ffffff", "#f24726", "#2d9bf0", "#808080"
INK, WARNING = "#1a1a1a", "#b00020"


class Miro:
    """A tiny Miro REST client for one board, with retries on rate limits and server errors."""

    def __init__(self, token: str) -> None:
        self.client = httpx.Client(
            base_url=API_BASE,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            timeout=30.0,
        )
        self.board_id = ""

    def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        """POST JSON and return the response; exit with the API's message on failure."""
        for attempt in range(RETRIES):
            response = self.client.post(path, json=body)
            if response.status_code < 500 and response.status_code != 429:
                break
            time.sleep(2 * (attempt + 1))
        if response.status_code >= 300:
            sys.exit(f"Miro {path}: {response.status_code} {response.text[:300]}")
        return response.json()

    def create_board(self) -> dict[str, Any]:
        """Create the empty board and remember its id."""
        board = self.post(
            "/boards",
            {
                "name": "RoomLoom starter",
                "description": "Example sketch and legend for the RoomLoom importer",
            },
        )
        self.board_id = board["id"]
        return board

    def frame(self, title: str, cx: float, cy: float, width: float, height: float) -> str:
        """Create a frame centred at (cx, cy) on the canvas and return its id."""
        frame = self.post(
            f"/boards/{self.board_id}/frames",
            {
                "data": {"title": title, "format": "custom", "type": "freeform"},
                "position": {"x": cx, "y": cy},
                "geometry": {"width": width, "height": height},
            },
        )
        return frame["id"]


class Area:
    """Places items at (x, y) shifted by (ox, oy), inside a frame or on the canvas.

    Inside a frame Miro positions items from the frame's top-left corner, so `ox, oy` turns plan
    coordinates into frame coordinates. Positions are item centres.
    """

    def __init__(self, miro: Miro, frame_id: str | None = None, ox: float = 0, oy: float = 0):
        self.miro, self.frame_id, self.ox, self.oy = miro, frame_id, ox, oy

    def _create(self, kind: str, body: dict[str, Any], x: float, y: float) -> None:
        if self.frame_id:
            body["parent"] = {"id": self.frame_id}
        body["position"] = {"x": x + self.ox, "y": y + self.oy}
        self.miro.post(f"/boards/{self.miro.board_id}/{kind}", body)

    def shape(
        self, text: str, x: float, y: float, w: float, h: float, fill: str, size: int = 20
    ) -> None:
        """A rectangle with centred text."""
        self._create(
            "shapes",
            {
                "data": {"shape": "rectangle", "content": f"<p>{text}</p>" if text else ""},
                "style": {
                    "fillColor": fill,
                    "borderColor": INK,
                    "borderWidth": "1",
                    "fillOpacity": "1",
                    "fontSize": str(size),
                    "textAlign": "center",
                    "textAlignVertical": "middle",
                },
                "geometry": {"width": w, "height": h},
            },
            x,
            y,
        )

    def sticky(self, text: str, x: float, y: float, w: float, color: str) -> None:
        """A square sticky note of the given Miro colour name."""
        self._create(
            "sticky_notes",
            {
                "data": {"shape": "square", "content": f"<p>{text}</p>"},
                "style": {"fillColor": color},
                "geometry": {"width": w},
            },
            x,
            y,
        )

    def text(
        self,
        text: str,
        x: float,
        y: float,
        w: float,
        size: int = 14,
        color: str = "#555555",
        align: str = "center",
    ) -> None:
        """A plain text item (ignored by the importer)."""
        self._create(
            "texts",
            {
                "data": {"content": f"<p>{text}</p>"},
                "style": {"fontSize": str(size), "color": color, "textAlign": align},
                "geometry": {"width": w},
            },
            x,
            y,
        )


def draw_plan(plan: Area) -> None:
    """The example building: four rooms, a wing, doors, windows, a passage and level notes."""
    plan.shape("Room A #classroom h=3.2", 250, 200, 500, 400, WHITE)
    plan.shape("Room B #classroom", 750, 200, 500, 400, WHITE)
    plan.shape("Corridor #corridor", 500, 500, 1000, 200, WHITE)
    plan.shape("Gym #gym", 250, 800, 500, 400, WHITE)
    # The wing touches the corridor along part of one side only (x 700-1000).
    plan.shape("Wing #storage", 850, 750, 300, 300, WHITE)

    plan.shape("", 250, 400, 100, 20, DOOR)  # room A <-> corridor
    plan.shape("", 750, 400, 100, 20, DOOR)  # room B <-> corridor
    plan.shape("", 250, 600, 100, 20, DOOR)  # corridor <-> gym (steps)
    plan.shape("", 600, 600, 100, 20, DOOR)  # entrance from outside
    plan.shape("", 850, 600, 100, 20, DOOR)  # corridor <-> wing
    plan.shape("", 500, 200, 20, 100, PASSAGE)  # room A <-> room B, no door
    plan.shape("sill=0.9 h=1.4", 250, 0, 120, 20, WINDOW)
    plan.shape("", 750, 0, 120, 20, WINDOW)
    plan.shape("", 1000, 200, 20, 120, WINDOW)
    plan.shape("", 0, 800, 20, 120, WINDOW)
    plan.shape("", 850, 900, 120, 20, WINDOW)

    plan.sticky("level -0.3", 130, 850, 140, "orange")
    plan.sticky("steps 2", 250, 690, 140, "orange")
    plan.sticky(
        "Green oil paint up to 1.5 m, plants on windowsills — Ania", 250, 200, 200, "yellow"
    )

    labels = [
        ("window", 250, -40),
        ("window", 750, -40),
        ("window", 1050, 200),
        ("window", -50, 800),
        ("window", 850, 940),
        ("door (entrance)", 600, 640),
        ("door", 330, 430),
        ("door", 830, 430),
        ("door", 330, 580),
        ("door", 850, 640),
        ("passage (no door)", 560, 130),
        ("wing", 850, 840),
    ]
    for label, x, y in labels:
        plan.text(label, x, y, 120 if len(label) > 8 else 80)


def draw_outside_plan(canvas: Area) -> None:
    """The scale bar and the notes area: read from anywhere on the board."""
    canvas.shape("5 m", 500, -250, 500, 20, "#cccccc")
    canvas.text(
        "Scale bar: a thin rectangle labelled with its real length. Exactly one on the board.",
        500,
        -300,
        700,
    )
    canvas.shape("Notes", 1800, 300, 500, 400, "#8fd14f")
    canvas.sticky("The whole building smelled of floor polish", 1650, 330, 160, "light_blue")
    canvas.sticky("Corridor floor: terrazzo", 1900, 330, 160, "light_blue")


def draw_legend(legend: Area) -> None:
    """One row per element: a sample shape and the rule for drawing it."""
    legend.text(
        "<b>HOW TO DRAW THE PLAN</b> — top of the board is north · 100 board units = 1 m when the "
        "scale bar is 5 m long · walls come from the room outlines: rooms that should touch must "
        "touch",
        650,
        60,
        1200,
        18,
        INK,
    )
    rows = [
        (
            lambda y: legend.shape("Room name #tag h=3.2", 150, y, 200, 70, WHITE, 14),
            "<b>ROOM</b> — white rectangle with its name. Optional <i>#tags</i> and <i>h=3.2</i> "
            "(ceiling height, m; default 2.6).",
        ),
        (
            lambda y: (
                legend.shape("Hall", 110, y, 120, 60, WHITE, 14),
                legend.shape("Hall", 170, y + 45, 60, 50, WHITE, 14),
            ),
            "<b>L / T-SHAPED ROOM</b> — several rectangles with exactly the same name. They must "
            "touch or overlap.",
        ),
        (
            lambda y: (
                legend.shape("Main", 110, y, 140, 80, WHITE, 14),
                legend.shape("Wing", 190, y + 70, 60, 60, WHITE, 14),
            ),
            "<b>WING / EXTENSION</b> — a separate named room that touches another one along part "
            "of one side (like “Wing” in the example). Touching along any length is enough.",
        ),
        (
            lambda y: legend.shape("", 150, y, 100, 20, DOOR),
            "<b>DOOR</b> — red rectangle laid across a wall (between two rooms, or room and "
            "outside). Long side = door width. Text: <i>h=2.1</i> (default 2.0).",
        ),
        (
            lambda y: legend.shape("", 150, y, 120, 20, WINDOW),
            "<b>WINDOW</b> — light-blue rectangle across an outside wall. Text: "
            "<i>sill=0.9 h=1.4</i> (defaults).",
        ),
        (
            lambda y: legend.shape("", 150, y, 100, 20, PASSAGE),
            "<b>PASSAGE</b> — grey rectangle across a wall: an opening with no door. Text: "
            "<i>h=2.2</i>.",
        ),
        (
            lambda y: legend.sticky("level -0.3", 150, y, 110, "orange"),
            "<b>FLOOR LEVEL</b> — orange sticky inside a room: <i>level -0.3</i> = floor 30 cm "
            "lower.",
        ),
        (
            lambda y: legend.sticky("steps 2", 150, y, 110, "orange"),
            "<b>STEPS</b> — orange sticky touching a door: <i>steps 2</i>. Without it, steps of "
            "about 18 cm are assumed.",
        ),
        (
            lambda y: legend.sticky("Green paint to 1.5 m", 150, y, 110, "yellow"),
            "<b>ROOM MEMORY</b> — yellow sticky inside a room, any text. End with <i>— Ania</i> "
            "to credit the author.",
        ),
        (
            lambda y: legend.sticky("Any note", 150, y, 110, "light_blue"),
            "<b>BUILDING NOTES</b> — stickies or text inside the green rectangle labelled “Notes” "
            "(see right of the plan). Mention room names to link a note to rooms.",
        ),
    ]
    y = 190
    for sample, label in rows:
        sample(y)
        legend.text(label, 750, y + 15, 850, 15, INK, "left")
        y += 110
    legend.text(
        "<b>NOT SUPPORTED YET — free-standing wall</b> (a partition inside a room that touches no "
        "other wall, or a wall stub). The 3D shell is built only from room outlines. For now: "
        "leave it out, and describe it in a yellow room-memory sticky (e.g. “partition 2 m long, "
        "1.2 m from the north wall”).",
        650,
        y + 40,
        1200,
        15,
        WARNING,
    )


def main() -> None:
    """Build the board and print where to find it."""
    token = get_settings().miro_token
    if not token:
        sys.exit("MIRO_TOKEN is not set in .env (it needs boards:read and boards:write)")
    miro = Miro(token)
    board = miro.create_board()

    # The plan frame spans canvas (-100,-100)..(1100,1100); plan coordinates are canvas-like.
    plan = Area(miro, miro.frame("Plan", 500, 500, 1200, 1200), 100, 100)
    draw_plan(plan)
    draw_outside_plan(Area(miro))
    # The legend sits to the right of the plan, outside it, so the importer ignores it.
    draw_legend(Area(miro, miro.frame("Legend", 1900, 1375, 1300, 1450)))

    print(f"board id: {board['id']}\nurl: {board['viewLink']}")


if __name__ == "__main__":
    main()
