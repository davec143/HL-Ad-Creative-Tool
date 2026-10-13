import importlib.util
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location("scene", Path(__file__).parents[1] / "finishing/scene.py")
scene = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scene)


def test_removes_provider_padding_without_changing_photo_pixels():
    photo = Image.new("RGB", (680, 950), (60, 48, 24))
    padded = Image.new("RGB", (1000, 1000), "white")
    padded.paste(photo, (160, 0))
    out, result = scene.prepare(padded)
    assert result["cropped"]
    assert result["box"] == [160, 0, 840, 950]
    assert np.array_equal(np.asarray(out), np.asarray(photo))
    twice, again = scene.prepare(out)
    assert not again["cropped"]
    assert np.array_equal(np.asarray(twice), np.asarray(photo))


def test_keeps_full_bleed_photo_and_interior_white_panels():
    im = Image.new("RGB", (600, 600), (50, 30, 70))
    ImageDraw.Draw(im).rectangle((40, 40, 560, 560), fill="white")
    out, result = scene.prepare(im)
    assert not result["cropped"]
    assert np.array_equal(np.asarray(out), np.asarray(im))


def test_does_not_crop_away_most_of_a_white_room_or_an_empty_image():
    room = Image.new("RGB", (600, 600), "white")
    ImageDraw.Draw(room).rectangle((250, 250, 350, 350), fill="black")
    for im in [room, Image.new("RGB", (600, 600), "white")]:
        out, result = scene.prepare(im)
        assert not result["cropped"]
        assert out.size == im.size


def test_near_white_jpeg_padding_is_removed_but_not_coloured_borders():
    for color, cropped in [((250, 250, 249), True), ((235, 230, 220), False)]:
        im = Image.new("RGB", (600, 600), color)
        ImageDraw.Draw(im).rectangle((60, 0, 539, 599), fill=(30, 50, 70))
        _, result = scene.prepare(im)
        assert result["cropped"] is cropped
