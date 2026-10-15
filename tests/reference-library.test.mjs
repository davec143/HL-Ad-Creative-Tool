// The builder and its separately served library must never diverge again.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TPL, TPL_ORDER, KINDS, CANVAS } from '../core/brand.mjs';
import { libraryFingerprint } from '../reference/library.mjs';

const html = fs.readFileSync(new URL('../reference/HitLights_Ad_Templates.html', import.meta.url), 'utf8');

function jpegSize(base64) {
  const bytes = Buffer.from(base64, 'base64');
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'valid JPEG start');
  for (let i = 2; i < bytes.length;) {
    assert.equal(bytes[i++], 0xff, 'valid JPEG marker');
    const marker = bytes[i++], length = bytes.readUInt16BE(i);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return [bytes.readUInt16BE(i + 5), bytes.readUInt16BE(i + 3)];
    i += length;
  }
  assert.fail('JPEG has no size');
}

test('published template library is regenerated whenever its compositor or registry changes', () => {
  assert.ok(html.includes(`source-sha256:${libraryFingerprint()}`), 'Template library is stale. Run npm run reference:build and commit the generated HTML.');
});

test('every available template has three correctly sized previews and a builder link', () => {
  const cards = [...html.matchAll(/<article\b[^>]*data-template="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)];
  assert.deepEqual(cards.map(m => m[1]).sort(), [...TPL_ORDER].sort());
  for (const [, tpl, card] of cards) {
    assert.ok(card.includes(TPL[tpl].name));
    assert.ok(card.includes(`href="/?template=${tpl}"`));
    const figures = [...card.matchAll(/<figure data-preview="([^"]+)"><img src="data:image\/jpeg;base64,([^"]+)" width="(\d+)" height="(\d+)"/g)];
    assert.equal(figures.length, KINDS.length, tpl);
    for (const kind of KINDS) {
      const figure = figures.find(m => m[1] === `${tpl}-${kind}`);
      assert.ok(figure, `${tpl} ${kind}`);
      const { W: w, H: h } = CANVAS[kind];
      assert.deepEqual([Number(figure[3]), Number(figure[4])], [w, h]);
      assert.deepEqual(jpegSize(figure[2]), [w, h], `${tpl} ${kind}: preview image must match its label`);
    }
  }
  assert.ok(html.indexOf('data-template="t6"') < html.indexOf('data-template="t1"'), 'October additions are visible first');
  assert.doesNotMatch(html, /<script\b|<iframe\b|src="https?:/i, 'previews are self-contained and work under the script-free library CSP');
});
