// New reference families and explicit room layout modes: real Chromium, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TPL, TPL_ORDER, SAMPLE, LIMITS, LOGOGRID, KINDS, CANVAS } from '../core/brand.mjs';
import { SCENE_LAYOUTS, resolveSceneLayout } from '../core/composed.mjs';
import { FORM_FIELDS, checkLimits, validateForGenerate, draftBrief } from '../core/engine.mjs';
import { layoutFor } from '../composer/templates.mjs';
import { buildHtml } from '../composer/page.mjs';
import { Composer, chromiumPath } from '../composer/render.mjs';
const NEW = ['t6', 't7', 't8', 't9', 't10', 't11'];
const svg = s => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');
const product = svg('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect x="60" y="20" width="280" height="560" rx="20" fill="#eeeeee"/><rect x="100" y="130" width="200" height="340" fill="white"/></svg>');
const scene = svg('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1000"><rect width="1200" height="1000" fill="#31576b"/><path d="M0 170L600 310L1200 80" stroke="#f7d879" stroke-width="25" fill="none"/><rect x="750" y="350" width="350" height="400" fill="#8caaa4"/></svg>');
const form = (tpl, sceneLayout = 'template') => ({ tpl, ...SAMPLE[tpl], sceneLayout, phone: '+1 855 768 4135', email: 'customerservice@hitlights.com', ...(tpl === 't3' ? { h1: '10% OFF', deadline: 'Ends Friday' } : {}) });

test('six new reference families have complete reusable metadata and conservative sample copy', () => {
  assert.deepEqual(TPL_ORDER.slice(-6), NEW);
  assert.ok(FORM_FIELDS.includes('sceneLayout'));
  for (const tpl of NEW) {
    assert.ok(TPL[tpl].referenceFamily && TPL[tpl].summary && LIMITS[tpl] && LOGOGRID[tpl]);
    assert.equal(checkLimits(form(tpl)).bad.length, 0, tpl);
    assert.deepEqual(validateForGenerate(form(tpl), { hasImage: true }), []);
    assert.match(draftBrief(tpl, null, ''), /h1 — a clear benefit headline/);
    assert.equal(/\d/.test([SAMPLE[tpl].h1, SAMPLE[tpl].h2, SAMPLE[tpl].sub, SAMPLE[tpl].p1, SAMPLE[tpl].p2, SAMPLE[tpl].p3].join(' ')), false);
  }
  assert.deepEqual(SCENE_LAYOUTS, ['template', 'full', 'panel']);
  assert.ok(validateForGenerate(form('t6', 'unknown'), { hasImage: true }).length);
});

test('full and panel modes always show a substantial unblurred scene; default T3 shows the whole room', () => {
  for (const tpl of TPL_ORDER) for (const kind of KINDS) for (const mode of ['full', 'panel']) {
    const s = layoutFor(tpl, kind, form(tpl, mode));
    assert.equal(s.sceneMode, mode);
    if (mode === 'full') assert.deepEqual(s.L.photo, { x: 0, y: 0, w: s.W, h: s.H });
    else assert.ok(s.L.photo.w * s.L.photo.h / (s.W * s.H) >= .39, tpl + kind);
    const html = buildHtml(s, { scene, product });
    assert.ok(html.includes(scene) && html.includes(product));
    assert.ok(!html.includes('blur('), tpl + kind + mode);
  }
  for (const kind of KINDS) assert.equal(layoutFor('t3', kind, form('t3')).L.mode, 'full');
  assert.equal(resolveSceneLayout('t6', 'template'), 'none');
});

test('reference defaults retain distinctive geometry and real product layers without copying claims', () => {
  for (const kind of KINDS) {
    const s6 = layoutFor('t6', kind, form('t6')), s7 = layoutFor('t7', kind, form('t7'));
    assert.equal(s6.L.mode, 'none');
    assert.ok(!buildHtml(s6, { scene, product }).includes(scene), 'graphic template must not secretly display a scene');
    assert.ok(buildHtml(s6, { scene, product }).includes(product));
    assert.equal(s7.L.photo.arches, true);
    assert.ok(buildHtml(s7, { scene, product }).includes('clipPath id="arches"'));
    assert.ok(buildHtml(s7, { scene, product }).includes(product));
    assert.ok(layoutFor('t9', kind, form('t9')).L.backdrop);
    assert.ok(layoutFor('t10', kind, form('t10')).L.photo.r > 0);
    assert.ok(layoutFor('t11', kind, form('t11')).L.backdrop);
  }
});

test('all eleven families fit in all three sizes and scene modes, with intact source aspect ratio', { skip: !chromiumPath() }, async () => {
  const c = new Composer();
  try {
    for (const tpl of TPL_ORDER) for (const mode of SCENE_LAYOUTS) for (const kind of KINDS) {
      const s = layoutFor(tpl, kind, form(tpl, mode));
      const { report } = await c.compose(s, { scene: s.sceneMode === 'none' ? null : scene, product }, { screenshot: false, allowInvalid: true });
      assert.equal(report.ok, true, `${tpl}/${mode}/${kind}: ${JSON.stringify(report.errors)}`);
      assert.ok(Math.abs(report.rects.product.w / report.rects.product.h - 2 / 3) < .001, 'product must not stretch');
      assert.deepEqual([s.W, s.H], [CANVAS[kind].W, CANVAS[kind].H]);
    }
    await assert.rejects(() => c.compose(layoutFor('t10', 'landscape', { ...form('t10'), h1: 'LONG COPY '.repeat(40) }), { scene, product }, { screenshot: false }), /too long|too tall/);
  } finally { await c.close(); }
});
