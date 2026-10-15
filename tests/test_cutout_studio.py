"""Regressions for real cutout failures: printed white packaging is opaque.

Synthetic product artwork avoids committing live run data. Native-resolution real
catalog photos are additionally checked before deployment, on violet backgrounds.
"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'finishing'))
import cutout


def studio_fixture():
    im = Image.new('RGB', (600, 500), 'white')
    d = ImageDraw.Draw(im)
    # Printed box: a genuinely white face, purple top/footer, gray side.
    d.rectangle((40, 40, 260, 360), fill=(254, 254, 254), outline=(100, 70, 130), width=3)
    d.rectangle((40, 40, 75, 360), fill=(215, 213, 217))
    d.rectangle((75, 40, 260, 90), fill=(85, 30, 140))
    d.rectangle((75, 315, 260, 360), fill=(85, 30, 140))
    d.rectangle((100, 53, 220, 67), fill='white')  # printed logo
    d.rectangle((100, 120, 220, 137), fill=(85, 30, 140))
    d.rectangle((110, 170, 210, 280), fill=(150, 150, 150))
    d.rectangle((130, 187, 190, 263), fill='white')  # printed picture of white switch
    # Separate actual hardware: neutral white switch with mounting holes.
    d.rectangle((350, 90, 520, 410), fill=(130, 130, 130))
    d.rectangle((365, 160, 505, 350), fill=(253, 253, 253))
    d.ellipse((420, 110, 450, 135), fill='white')
    d.ellipse((420, 370, 450, 395), fill='white')
    # Model gets box silhouette but deletes white artwork and printed switch.
    alpha = np.zeros((500, 600), np.uint8)
    alpha[40:361, 40:261] = 255
    alpha[91:315, 76:258] = 0
    alpha[53:68, 100:221] = 0
    alpha[170:281, 110:211] = 255
    alpha[187:264, 130:191] = 0
    alpha[90:411, 350:521] = 255
    a = Image.fromarray(alpha)
    ad = ImageDraw.Draw(a)
    ad.ellipse((420, 110, 450, 135), fill=0)
    ad.ellipse((420, 370, 450, 395), fill=0)
    return np.asarray(im), np.asarray(a)


def test_white_packaging_and_printed_switch_are_not_background():
    rgb, alpha = studio_fixture()
    before = rgb.copy()
    result, gained = cutout.refine(rgb, alpha)
    assert result[150, 150] == 255, 'white box face must be opaque even with model alpha zero'
    assert result[60, 150] == 255, 'white printed logo must survive'
    assert result[220, 160] == 255, 'white switch printed on box must survive'
    assert result[250, 440] == 255, 'actual white hardware must be opaque'
    assert result[122, 435] == 0 and result[382, 435] == 0, 'actual mounting holes stay transparent'
    assert result[200, 310] == 0, 'gap between package and hardware stays transparent'
    assert result[480, 40] == 0, 'outer background stays transparent'
    assert np.array_equal(rgb, before), 'source RGB is never painted or replaced'
    assert gained > 0


def test_completely_missed_colored_package_is_preserved_on_white_studio_photo():
    rgb, alpha = studio_fixture()
    # Same failure as Luma: model only retains a piece of the package.
    alpha = alpha.copy()
    alpha[40:361, 76:261] = 0
    result, _ = cutout.refine(rgb, alpha)
    assert result[150, 150] == 255
    assert result[60, 250] == 255
    assert result[340, 250] == 255


def test_neutral_white_switch_details_are_solid_despite_uncertain_model():
    rgb, alpha = studio_fixture()
    alpha = alpha.copy()
    # A slightly hesitant patch surrounded by the white switch face is not a hole.
    alpha[170:180, 375:385] = 190
    result, _ = cutout.refine(rgb, alpha)
    assert np.all(result[170:180, 375:385] == 255)


def test_floor_reflection_is_removed_without_trimming_product():
    rgb, alpha = studio_fixture()
    rgb = rgb.copy()
    # A pale reflection attached just below the purple package footer.
    for y in range(361, 390):
        rgb[y, 40:261] = (230 + (y-361)//2, 224 + (y-361)//2, 239 + (y-361)//3)
    result, _ = cutout.refine(rgb, alpha)
    assert result[355, 160] == 255, 'opaque printed footer survives'
    assert result[380, 160] == 0, 'attached studio reflection is not part of the product'


def test_confident_white_product_is_not_erased_by_background_colour():
    rgb = np.full((300, 300, 3), 255, np.uint8)
    rgb[50:250, 70:230] = 253
    alpha = np.zeros((300, 300), np.uint8)
    alpha[50:250, 70:230] = 255
    result, _ = cutout.refine(rgb, alpha)
    assert np.array_equal(result, alpha)


def test_small_silver_connector_below_package_is_not_a_floor_reflection():
    rgb, alpha = studio_fixture()
    rgb, alpha = rgb.copy(), alpha.copy()
    rgb[345:380, 250:270] = 60
    alpha[345:380, 250:270] = 255
    rgb[375:386, 264:278] = 210
    alpha[375:386, 264:278] = 0
    result, _ = cutout.refine(rgb, alpha)
    assert result[380, 272] == 255


def test_studio_edge_ringing_is_removed_without_reopening_white_package():
    rgb, alpha = studio_fixture()
    rgb, alpha = rgb.copy(), alpha.copy()
    # JPEG ringing just above and beside the printed box is almost white. The
    # package-restoration pass used to promote these exterior specks to opaque.
    rgb[37:40, 90:210] = 248
    rgb[100:300, 261:264] = 248
    alpha[37:40, 90:210] = 30
    alpha[100:300, 261:264] = 30
    result, _ = cutout.refine(rgb, alpha)
    assert result[38, 150] == 0
    assert result[200, 263] == 0
    assert result[150, 150] == 255, 'interior white packaging remains solid'
    assert result[60, 150] == 255, 'white printed logo remains solid'
    assert result[250, 440] == 255, 'actual white product remains solid'


def test_small_model_confident_studio_tail_at_image_bottom_is_removed():
    rgb, alpha = studio_fixture()
    rgb, alpha = rgb.copy(), alpha.copy()
    # A flat slab of exact studio white can be retained by the model below a
    # colourful product at the photograph boundary, despite having no edge.
    rgb[450:491, 180:401] = (85, 30, 140)
    alpha[450:491, 180:401] = 255
    a = Image.fromarray(alpha)
    ImageDraw.Draw(a).polygon([(180, 499), (400, 499), (290, 491)], fill=255)
    result, _ = cutout.refine(rgb, np.asarray(a))
    assert not result[491:500, 180:401].any()
    assert result[490, 300] == 255
    assert result[150, 150] == 255


def test_white_product_touching_image_bottom_is_not_treated_as_studio_tail():
    rgb = np.full((300, 300, 3), 255, np.uint8)
    rgb[50:300, 70:230] = 253
    alpha = np.zeros((300, 300), np.uint8)
    alpha[50:300, 70:230] = 255
    result, _ = cutout.refine(rgb, alpha)
    assert np.array_equal(result, alpha)


def test_near_white_fringe_at_canvas_edge_uses_outside_transparency():
    rgb, alpha = studio_fixture()
    rgb, alpha = rgb.copy(), alpha.copy()
    rgb[50:450, 590:600] = (85, 30, 140)
    alpha[50:450, 590:600] = 255
    rgb[50:450, 597:600] = 248
    alpha[50:450, 597:600] = 30
    result, _ = cutout.refine(rgb, alpha)
    assert result[200, 599] == 0
    assert result[200, 595] == 255



def test_pale_model_supported_connector_is_not_erased_as_edge_noise():
    rgb, alpha = studio_fixture()
    rgb, alpha = rgb.copy(), alpha.copy()
    rgb[329:333, 260:351] = 248
    alpha[329:333, 260:351] = 190
    result, _ = cutout.refine(rgb, alpha)
    assert np.all(result[329:333, 262:349] == 255)


def test_white_rail_attached_to_colored_product_is_not_a_background_tail():
    rgb, alpha = studio_fixture()
    rgb, alpha = rgb.copy(), alpha.copy()
    rgb[360:497, 240:244] = 100
    alpha[360:497, 240:244] = 255
    rgb[497:500, 180:400] = 253
    alpha[497:500, 180:400] = 255
    result, _ = cutout.refine(rgb, alpha)
    assert np.all(result[497:500, 180:400] == 255)
