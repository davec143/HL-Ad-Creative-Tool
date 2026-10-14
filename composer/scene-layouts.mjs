// Explicit photographic layouts. Scene pixels stay sharp and occupy a meaningful
// share of the ad; the real product is a separate foreground layer.
export function photographicLayout(tpl, kind, mode, theme = {}) {
  const full = mode === 'full', portrait = kind === 'portrait', landscape = kind === 'landscape';
  const size = landscape ? 'wide' : portrait ? 'tall' : 'square';
  const boxes = {
    square: full ? {
      logo: { x: 64, y: 64 }, copy: { x: 64, y: 202, w: 570, maxH: 690 },
      photo: { x: 0, y: 0, w: 1080, h: 1080 }, product: { x: 680, y: 650, w: 340, h: 350 },
      contact: { x: 64, y: 1008, maxW: 600, size: [20, 14] },
    } : {
      logo: { x: 56, y: 64 }, copy: { x: 56, y: 200, w: 450, maxH: 490 },
      photo: { x: 550, y: 0, w: 530, h: 1080 }, product: { x: 88, y: 724, w: 350, h: 260 },
      contact: { x: 56, y: 1010, maxW: 450, size: [17, 12] },
    },
    tall: full ? {
      logo: { x: 64, y: 288 }, copy: { x: 64, y: 444, w: 690, maxH: 860 },
      photo: { x: 0, y: 0, w: 1080, h: 1920 }, product: { x: 704, y: 1160, w: 320, h: 350 },
      contact: { x: 64, y: 1492, maxW: 620, size: [22, 15] },
    } : {
      logo: { x: 64, y: 832 }, copy: { x: 64, y: 980, w: 610, maxH: 480 },
      photo: { x: 0, y: 0, w: 1080, h: 780 }, product: { x: 728, y: 1160, w: 300, h: 340 },
      contact: { x: 64, y: 1496, maxW: 650, size: [22, 15] },
    },
    wide: full ? {
      logo: { x: 56, y: 48 }, copy: { x: 56, y: 164, w: 570, maxH: 360 },
      photo: { x: 0, y: 0, w: 1200, h: 628 }, product: { x: 840, y: 298, w: 304, h: 282 },
      contact: { x: 56, y: 560, maxW: 650, size: [17, 12] },
    } : {
      logo: { x: 56, y: 48 }, copy: { x: 56, y: 164, w: 500, maxH: 355 },
      photo: { x: 610, y: 0, w: 590, h: 628 }, product: { x: 920, y: 360, w: 230, h: 222 },
      contact: { x: 56, y: 560, maxW: 500, size: [16, 12] },
    },
  };
  const B = boxes[size], promo = tpl === 't3';
  const small = landscape || (portrait && !full);
  return {
    ...B, photographic: true, mode, theme,
    logo: { ...B.logo, colour: full || theme.dark ? 'white' : 'black' },
    head: { h1: promo ? (small ? [94, 48] : [140, 68]) : small ? [58, 32] : [80, 42], h2: promo ? (small ? [34, 22] : [46, 28]) : small ? [48, 30] : [66, 38] },
    sub: { size: small ? [24, 17] : [32, 22], lines: 2 },
    proof: { size: small ? [21, 15] : [29, 20], lines: 1, gap: small ? 7 : 10 },
    deadline: { size: small ? [23, 16] : [30, 20] },
    cta: { h: small ? 58 : 76, maxW: B.copy.w, size: small ? [24, 17] : [30, 20] },
    safe: portrait ? { top: 269, bottom: 1536 } : undefined,
    bleed: ['photo'], ground: ['photo', 'copy'], apart: [['product', 'head'], ['product', 'cta'], ['product', 'contact']],
  };
}

// Reference defaults are distinct compositions; the explicit Full/Panel controls
// deliberately override these with the simpler photographic layouts above.
export function referenceLayout(tpl, kind, mode, theme) {
  const L = photographicLayout(tpl, kind, mode, theme), tall = kind === 'portrait', wide = kind === 'landscape';
  L.reference = true;
  if (tpl === 't6') {
    L.mode = 'none'; L.logo.colour = 'white';
    Object.assign(L, wide ? {
      logo: { x: 56, y: 64, colour: 'white' }, copy: { x: 56, y: 174, w: 560, maxH: 350 }, product: { x: 654, y: 76, w: 490, h: 504 }, contact: { x: 56, y: 558, maxW: 560, size: [17, 12] },
    } : tall ? {
      center: true, logo: { x: 350, y: 288, colour: 'white' }, copy: { x: 90, y: 432, w: 900, maxH: 500 }, product: { x: 190, y: 1060, w: 700, h: 710 }, contact: { x: 90, y: 950, maxW: 900, size: [23, 16] },
    } : {
      center: true, logo: { x: 370, y: 64, colour: 'white' }, copy: { x: 64, y: 196, w: 952, maxH: 390 }, product: { x: 230, y: 640, w: 620, h: 392 }, contact: { x: 64, y: 586, maxW: 952, size: [20, 14] },
    });
    if (!wide) { L.head = { h1: [tall ? 86 : 68, 42], h2: [tall ? 86 : 68, 42] }; L.sub = { size: [tall ? 34 : 28, 20], lines: 2 }; }
  }
  if (tpl === 't7') {
    L.center = !wide;
    Object.assign(L, wide ? {
      photo: { x: 654, y: 64, w: 490, h: 390, arches: true }, product: { x: 904, y: 472, w: 240, h: 116 }, copy: { x: 56, y: 174, w: 545, maxH: 360 },
      contact: { x: 56, y: 560, maxW: 545, size: [17, 12] },
    } : tall ? {
      logo: { x: 350, y: 288, colour: 'white' }, copy: { x: 64, y: 432, w: 952, maxH: 480 }, photo: { x: 64, y: 982, w: 720, h: 790, arches: true }, product: { x: 808, y: 1170, w: 216, h: 330 }, contact: { x: 64, y: 924, maxW: 952, size: [23, 16] },
    } : {
      logo: { x: 370, y: 64, colour: 'white' }, copy: { x: 64, y: 196, w: 952, maxH: 364 }, photo: { x: 64, y: 586, w: 720, h: 410, arches: true }, product: { x: 808, y: 744, w: 216, h: 250 }, contact: { x: 64, y: 1010, maxW: 952, size: [18, 13] },
    });
    if (!wide) { L.head = { h1: [tall ? 82 : 64, 40], h2: [tall ? 82 : 64, 40] }; L.sub = { size: [tall ? 32 : 28, 20], lines: 2 }; }
  }
  if (tpl === 't9' || tpl === 't11') {
    Object.assign(L, wide ? {
      logo: { x: 56, y: 64, colour: 'white' }, copy: { x: 56, y: 178, w: 590, maxH: 360 },
      backdrop: { x: 24, y: 24, w: 660, h: 580 },
    } : tall ? {
      logo: { x: 64, y: 700, colour: 'white' }, copy: { x: 64, y: 844, w: 650, maxH: 600 },
      backdrop: { x: 28, y: 660, w: 724, h: 880 }, product: { x: 770, y: 1200, w: 254, h: 310 },
    } : {
      logo: { x: 64, y: 390, colour: 'white' }, copy: { x: 64, y: 524, w: 600, maxH: 460 },
      backdrop: { x: 28, y: 352, w: 670, h: 690 }, product: { x: 746, y: 710, w: 280, h: 310 },
    });
    L.head = { h1: [wide ? 62 : tall ? 82 : 66, 38], h2: [wide ? 62 : tall ? 82 : 66, 38] };
    L.proof = { size: [wide ? 21 : 26, 17], lines: 1, gap: 8 };
    L.sub = { size: [wide ? 25 : 30, 19], lines: 2 };
  }
  if (tpl === 't10') {
    L.photo = tall ? { x: 260, y: 40, w: 756, h: 770, r: 34 } : wide ? { x: 730, y: 40, w: 414, h: 548, r: 26 } : { x: 560, y: 64, w: 456, h: 810, r: 30 };
    if (wide) { L.copy.w = 600; L.product = { x: 638, y: 370, w: 330, h: 218 }; }
    if (!tall && !wide) { L.copy.w = 450; L.head = { h1: [66, 40], h2: [62, 38] }; L.product = { x: 570, y: 734, w: 400, h: 290 }; }
  }
  L.cta.maxW = L.copy.w;
  L.apart = [['product', 'head'], ['product', 'cta'], ['product', 'contact']];
  return L;
}
