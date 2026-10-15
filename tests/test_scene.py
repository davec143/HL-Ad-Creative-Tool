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


def test_removes_noisy_two_pixel_frame_and_grey_companion_edges_exactly():
    # Reproduces the real provider frame: coloured JPEG speckles stop the old
    # >=245 / 99.5% detector; a grey fringe and opposite edges remain visible.
    rgb = np.full((700, 600, 3), (30, 25, 25), dtype=np.uint8)
    rgb[:, 0] = (85, 85, 90)
    rgb[:, -3] = (110, 105, 105)
    rgb[:, -2:] = (254, 253, 251)
    rgb[::10, -2:] = (250, 248, 235)
    rgb[-1, :-2] = (170, 170, 170)
    im = Image.fromarray(rgb)
    out, result = scene.prepare(im)
    assert result["algo"] == 2
    assert result["box"] == [1, 0, 597, 699]
    assert np.array_equal(np.asarray(out), rgb[:-1, 1:-3])
    twice, again = scene.prepare(out)
    assert not again["cropped"]
    assert np.array_equal(np.asarray(twice), np.asarray(out))


def test_thin_noisy_frame_is_detected_on_every_side():
    photo = np.full((600, 600, 3), (30, 50, 70), dtype=np.uint8)
    for turns in range(4):
        rgb = photo.copy()
        rgb[:, :2] = (252, 251, 250)
        rgb[::10, :2] = (237, 245, 249)
        rgb = np.rot90(rgb, turns).copy()
        out, result = scene.prepare(Image.fromarray(rgb))
        assert result["cropped"]
        assert out.size in [(598, 600), (600, 598)]
        assert np.all(np.asarray(out) == (30, 50, 70))


def test_does_not_treat_broad_pale_walls_or_unaccompanied_grey_edges_as_frame():
    for thickness, color in [(5, (235, 230, 225)), (100, (240, 240, 240)),
                             (1, (170, 170, 170))]:
        im = Image.new("RGB", (600, 600), (30, 50, 70))
        ImageDraw.Draw(im).rectangle((0, 0, thickness - 1, 599), fill=color)
        out, result = scene.prepare(im)
        assert not result["cropped"]
        assert np.array_equal(np.asarray(out), np.asarray(im))


def test_white_padding_crop_also_removes_one_pixel_grey_fringe_on_each_side():
    for turns in range(4):
        rgb = np.full((600, 600, 3), (30, 50, 70), dtype=np.uint8)
        rgb[:, :3] = 255
        rgb[:, 3] = 170
        rgb = np.rot90(rgb, turns).copy()
        out, result = scene.prepare(Image.fromarray(rgb))
        assert result["cropped"]
        assert out.size in [(596, 600), (600, 596)]
        assert np.all(np.asarray(out) == (30, 50, 70))
