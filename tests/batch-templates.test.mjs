import test from 'node:test';
import assert from 'node:assert/strict';
import { planBatch } from '../core/batch-templates.mjs';
import { SAMPLE, TPL_ORDER } from '../core/brand.mjs';
import { expectedText } from '../core/engine.mjs';

const form = (tpl, extra = {}) => ({ tpl, ...SAMPLE[tpl], sceneLayout: 'template', ...extra });
const visibleBody = f => { const e = expectedText(f); return [e.sub, e.deadline, ...e.proof].filter(Boolean); };

test('different mode plans five unique immutable forms with the selected template first', () => {
  const input = form('t1'), before = structuredClone(input), out = planBatch(input, { count: 5, templateMode: 'different' });
  assert.deepEqual(out.errors, []); assert.equal(out.plans.length, 5); assert.equal(out.plans[0].tpl, 't1');
  assert.equal(new Set(out.plans.map(p => p.tpl)).size, 5); assert.deepEqual(input, before);
  out.plans[0].form.h1 = 'Mutated child'; assert.equal(input.h1, before.h1); assert.equal(out.plans[1].form.h1, before.h1);
  for (const p of out.plans.slice(1)) { assert.equal(p.form.cta, input.cta); assert.equal(p.form.h2, input.h2); }
});

test('promo deadline and exact approved offer survive every alternate template without hidden defaults', () => {
  const input = form('t3', { h1: '10% OFF', h2: 'Sitewide Sale', deadline: 'Ends Friday', sub: 'STALE SUB', p1: 'STALE CLAIM', phone: 'Hidden phone' });
  const out = planBatch(input, { count: 5, templateMode: 'different' });
  assert.deepEqual(out.errors, []);
  for (const p of out.plans) {
    assert.equal(p.form.h1, input.h1); assert.equal(p.form.h2, input.h2); assert.equal(p.form.cta, input.cta);
    assert.ok(visibleBody(p.form).includes('Ends Friday'));
    assert.ok(!visibleBody(p.form).some(v => v.includes('STALE')));
    assert.deepEqual(expectedText(p.form).contact.master, []);
  }
});

test('non-promo batches ignore a stale hidden deadline and never invent a promotional template', () => {
  const input = form('t1', { deadline: 'Expired offer', sub: 'Hidden claim' });
  const out = planBatch(input, { count: 5, templateMode: 'different' });
  assert.deepEqual(out.errors, []); assert.ok(out.plans.every(p => p.tpl !== 't3'));
  for (const p of out.plans) {
    const body = visibleBody(p.form).join(' · ');
    for (const key of ['p1', 'p2', 'p3']) assert.ok(body.includes(input[key]));
    assert.ok(!body.includes('Expired')); assert.ok(!body.includes('Hidden'));
  }
});

test('all eleven selected templates can lead five alternatives for concise compatible copy', () => {
  for (const tpl of TPL_ORDER) {
    const input = form(tpl, { h1: 'LIGHT', h2: 'YOUR SPACE', cta: 'SHOP NOW', sub: 'Find LED lighting for your space', p1: 'LED lighting', p2: 'Your space', p3: '', deadline: 'Ends Friday' });
    const out = planBatch(input, { count: 5, templateMode: 'different' });
    assert.deepEqual(out.errors, [], tpl); assert.equal(out.plans[0].tpl, tpl); assert.equal(new Set(out.plans.map(p => p.tpl)).size, 5, tpl);
  }
});

test('incompatible copy is explained, never truncated or silently dropped to fill a batch', () => {
  const input = form('t9', { p1: 'Explore LED strip lights', p2: 'Plan your lighting layout', p3: 'Find your next project' }); const out = planBatch(input, { count: 5, templateMode: 'different' });
  assert.equal(out.plans.length, 4); assert.ok(out.errors.some(e => /Shorten/.test(e.body)));
  for (const p of out.plans) assert.deepEqual(visibleBody(p.form), visibleBody(input));
  assert.deepEqual(planBatch(input, { count: 4, templateMode: 'different' }).errors, []);
});

test('same and single keep exact forms, while different allows exactly one free graphic layout', () => {
  const input = form('t6');
  assert.ok(planBatch(input, { count: 5 }).errors.length);
  const single = planBatch(input, { count: 1, templateMode: 'different' }); assert.deepEqual(single.plans[0].form, input);
  const mixed = planBatch(input, { count: 5, templateMode: 'different' });
  assert.deepEqual(mixed.errors, []); assert.equal(mixed.plans.filter(p => !p.sceneRequired).length, 1);
  const override = planBatch({ ...input, sceneLayout: 'panel' }, { count: 5, templateMode: 'different' });
  assert.ok(override.plans.every(p => p.sceneRequired && p.form.sceneLayout === 'panel'));
  const same = planBatch(form('t1'), { count: 5 }); assert.ok(same.plans.every(p => p.tpl === 't1'));
});

test('planner rejects invalid mode, count, inherited keys and unavailable templates', () => {
  for (const count of [0, 6, '5', 2.5]) assert.ok(planBatch(form('t1'), { count }).errors.length);
  for (const templateMode of ['random', '', null]) assert.ok(planBatch(form('t1'), { templateMode }).errors.length);
  for (const tpl of ['__proto__', 'constructor', 'toString']) assert.ok(planBatch({ tpl }, { count: 5, templateMode: 'different' }).errors.length);
  assert.ok(planBatch(form('t1'), { availableTemplates: ['t6'] }).errors.length);
});
