"""Stress regressions for mask confidence, studio edges, and physical openings."""
import io
import os
import sys
import numpy as np
import pytest
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'finishing'))
import cutout
from test_cutout_studio import studio_fixture


def test_partially_deleted_white_package_face_is_restored():
    rgb, alpha = studio_fixture()
    alpha = alpha.copy()
    # IS-Net's confidence changes with resizing; it can leave a whole box face
    # faintly present instead of fully deleting it. The same photo must stay solid.
    alpha[91:315, 76:258] = 105
    result, _ = cutout.refine(rgb, alpha)
    assert result[150, 150] == 255
    assert result[220, 160] == 255
    assert result[60, 150] == 255


def test_faint_studio_package_outline_does_not_leak_into_white_face():
    rgb, alpha = studio_fixture()
    rgb, alpha = rgb.copy(), alpha.copy()
    # A visible but pale right edge survives JPEG resizing. It is a boundary,
    # not backdrop; an 8-level colour tolerance erased it and then the box face.
    rgb[91:315, 258:261] = 249
    alpha[91:315, 258:261] = 0
    result, _ = cutout.refine(rgb, alpha)
    assert result[150, 150] == 255
    assert result[200, 310] == 0


@pytest.mark.parametrize('opening', ['large', 'long_slot'])
def test_model_confirmed_real_holes_are_not_filled_by_neutral_opacity_pass(opening):
    im = Image.new('RGB', (420, 420), 'white')
    d = ImageDraw.Draw(im)
    d.rectangle((40, 40, 380, 380), fill=(135, 135, 135))
    box = (100, 100, 320, 300) if opening == 'large' else (90, 180, 330, 210)
    d.rectangle(box, fill='white')
    alpha = np.zeros((420, 420), np.uint8)
    alpha[40:381, 40:381] = 255
    x0, y0, x1, y1 = box
    alpha[y0:y1+1, x0:x1+1] = 0
    result, _ = cutout.refine(np.asarray(im), alpha)
    assert np.all(result[y0+3:y1-2, x0+3:x1-2] == 0)
    assert result[60, 60] == 255


@pytest.mark.parametrize('size', [(600, 500), (300, 250), (150, 125)])
@pytest.mark.parametrize('background', [(255, 255, 255), (244, 244, 244), (250, 246, 242)])
def test_packaging_and_holes_survive_scaled_compressed_studio_photos(size, background):
    rgb, alpha = studio_fixture()
    rgb = rgb.copy()
    rgb[rgb.min(2) > 245] = background
    im = Image.fromarray(rgb).resize(size, Image.Resampling.LANCZOS)
    # Real JPEG quantization is intentional: it shifts edge colours and adds ringing.
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=45)
    im = Image.open(io.BytesIO(b.getvalue())).convert('RGB')
    a = np.asarray(Image.fromarray(alpha).resize(size, Image.Resampling.NEAREST))
    pixels = np.asarray(im)
    original = pixels.copy()
    result, _ = cutout.refine(pixels, a)
    for x, y in [(150, 150), (150, 60), (160, 220), (440, 250)]:
        assert result[round(y*size[1]/500), round(x*size[0]/600)] == 255
    for x, y in [(435, 122), (435, 382), (310, 200)]:
        assert result[round(y*size[1]/500), round(x*size[0]/600)] == 0
    assert np.array_equal(pixels, original)


def test_colored_reel_keeps_a_large_round_model_confirmed_opening():
    im = Image.new('RGB', (500, 500), 'white')
    d = ImageDraw.Draw(im)
    d.ellipse((70, 70, 430, 430), fill=(85, 30, 140))
    d.ellipse((150, 150, 350, 350), fill='white')
    a = Image.new('L', im.size, 0)
    ad = ImageDraw.Draw(a)
    ad.ellipse((70, 70, 430, 430), fill=255)
    ad.ellipse((150, 150, 350, 350), fill=0)
    result, _ = cutout.refine(np.asarray(im), np.asarray(a))
    assert result[250, 250] == 0
    assert result[250, 100] == 255


def test_white_round_artwork_on_rectangular_package_is_not_a_physical_hole():
    im = Image.new('RGB', (500, 500), 'white')
    d = ImageDraw.Draw(im)
    d.rectangle((70, 70, 430, 430), fill=(85, 30, 140))
    d.ellipse((150, 150, 350, 350), fill='white')
    a = Image.new('L', im.size, 0)
    ad = ImageDraw.Draw(a)
    ad.rectangle((70, 70, 430, 430), fill=255)
    ad.ellipse((150, 150, 350, 350), fill=0)
    result, _ = cutout.refine(np.asarray(im), np.asarray(a))
    assert result[250, 250] == 255
    assert result[250, 100] == 255


def test_small_low_resolution_mounting_hole_is_not_filled():
    rgb = np.full((400, 400, 3), 255, np.uint8)
    rgb[40:360, 70:330] = 130
    rgb[90:270, 90:310] = 253
    rgb[299:302, 199:202] = 255
    alpha = np.zeros((400, 400), np.uint8)
    alpha[40:360, 70:330] = 255
    alpha[299:302, 199:202] = 128
    result, _ = cutout.refine(rgb, alpha)
    assert result[300, 200] == 0
    assert result[200, 200] == 255
