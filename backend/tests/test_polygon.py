import pytest

from app.geometry.polygon import (
    is_ccw_from_above,
    normalise_polygon,
    open_ring,
    signed_area,
    validate_simple_ring,
)

# Drawn on the board (y down): top-left, bottom-left, bottom-right, top-right.
CCW_SQUARE = [(0.0, 0.0), (0.0, 2.0), (2.0, 2.0), (2.0, 0.0)]


def test_ccw_from_above_has_negative_raw_area() -> None:
    assert signed_area(CCW_SQUARE) == -4.0
    assert is_ccw_from_above(CCW_SQUARE)
    assert not is_ccw_from_above(CCW_SQUARE[::-1])


def test_open_ring_drops_closing_point_and_repeats() -> None:
    assert open_ring([*CCW_SQUARE, CCW_SQUARE[0]]) == CCW_SQUARE
    assert open_ring([(0, 0), (0, 0), (0, 2), (2, 2)]) == [(0, 0), (0, 2), (2, 2)]


def test_normalise_reverses_clockwise_and_keeps_ccw() -> None:
    assert normalise_polygon(CCW_SQUARE) == CCW_SQUARE
    assert is_ccw_from_above(normalise_polygon(CCW_SQUARE[::-1]))


@pytest.mark.parametrize(
    ("points", "message"),
    [
        ([(0, 0), (1, 1)], "at least 3"),
        ([(0, 0), (1, 1), (0, 0)], "at least 3"),
        ([(0, 0), (1, 1), (1, 0), (0, 1)], "self-intersecting"),
        ([(0, 0), (1, 0), (2, 0)], "self-intersecting|zero area"),
    ],
)
def test_validate_rejects_bad_rings(points: list[tuple[float, float]], message: str) -> None:
    with pytest.raises(ValueError, match=message):
        validate_simple_ring(points)
