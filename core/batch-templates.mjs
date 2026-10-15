// Shared, deterministic batch planning. Templates may rearrange approved words, never rewrite them.
import { TPL, TPL_ORDER } from './brand.mjs';
import { COMPOSED_TEMPLATES, resolveSceneLayout } from './composed.mjs';
import { validateForGenerate } from './engine.mjs';

const text = value => String(value || '').trim();
const issue = (title, body) => ({ title, body });

function adaptForm(source, tpl) {
  if (tpl === source.tpl) return { ...source };
  const from = TPL[source.tpl], to = TPL[tpl];
  const form = { ...source, tpl, sub: '', p1: '', p2: '', p3: '', deadline: '' };
  // Ignore hidden leftovers from an earlier template. Only the copy visible in the source ad
  // is eligible to appear in another layout; in particular, never invent a promotional deadline.
  const body = from.deadline ? [text(source.deadline)] : from.sub ? [text(source.sub)] : from.proof !== 'none' ? ['p1', 'p2', 'p3'].map(k => text(source[k])) : [];
  const lines = body.filter(Boolean);
  if (!from.contact) { form.phone = ''; form.email = ''; }
  if (to.deadline) {
    if (!from.deadline || !text(source.deadline)) return null;
    form.deadline = source.deadline;
  } else if (to.sub) form.sub = lines.join(' · ');
  else if (to.proof !== 'none' && lines.length <= 3) lines.forEach((line, i) => { form['p' + (i + 1)] = line; });
  else if (lines.length) return null;
  // Contact details must not disappear from an otherwise suitable alternative.
  if (!to.contact && from.contact && (text(source.phone) || text(source.email))) return null;
  return form;
}

export function planBatch(form, { count = 1, templateMode = 'same', availableTemplates = COMPOSED_TEMPLATES } = {}) {
  const errors = [];
  if (!Number.isInteger(count) || count < 1 || count > 5) errors.push(issue('Choose the number of sets', 'Choose between 1 and 5 sets.'));
  if (!['same', 'different'].includes(templateMode)) errors.push(issue('Choose template variety', 'Choose Different templates or Same template.'));
  const allowed = new Set(availableTemplates.filter(id => Object.hasOwn(TPL, id) && COMPOSED_TEMPLATES.includes(id)));
  if (!form || !Object.hasOwn(TPL, form.tpl) || !allowed.has(form.tpl)) errors.push(issue('Choose an available template', 'Batch generation requires an available composed template.'));
  if (errors.length) return { templateMode, plans: [], errors };
  const makePlan = (candidate, index) => ({ index, tpl: candidate.tpl, tplName: TPL[candidate.tpl].name, form: candidate, sceneRequired: resolveSceneLayout(candidate.tpl, candidate.sceneLayout) !== 'none', errors: validateForGenerate(candidate, { hasImage: true }) });
  if (templateMode === 'same' || count === 1) {
    const plans = Array.from({ length: count }, (_, i) => makePlan({ ...form }, i + 1));
    if (count > 1 && !plans[0].sceneRequired) errors.push(issue('Choose a photo background or different templates', 'This graphic template has no scene, so repeated copies would be identical. Choose Different templates, Full background, or Photo panel.'));
    errors.push(...plans[0].errors);
    return { templateMode, plans, errors };
  }
  const order = TPL_ORDER.filter(id => allowed.has(id)), start = order.indexOf(form.tpl);
  const candidates = [...order.slice(start), ...order.slice(0, start)];
  const plans = [makePlan({ ...form }, 1)];
  errors.push(...plans[0].errors);
  for (const tpl of candidates.slice(1)) {
    if (plans.length === count) break;
    const adapted = adaptForm(form, tpl);
    if (!adapted) continue;
    const plan = makePlan(adapted, plans.length + 1);
    if (!plan.errors.length) plans.push(plan);
  }
  if (plans.length < count) errors.push(issue('The copy fits ' + plans.length + ' different template' + (plans.length === 1 ? '' : 's'), 'Shorten the headline or supporting copy, choose fewer sets, or choose Same template. Your offer, deadline and other visible words will not be shortened or removed automatically.'));
  return { templateMode, plans, errors };
}
