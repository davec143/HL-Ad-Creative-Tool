// Structured JSON logs and basic operational metrics. Logs never include prompts, tokens or file
// paths; set LOG_PROMPTS=1 only to debug locally.
export class Obs {
  constructor({ store, write = (line) => process.stdout.write(line + "\n"), now = () => Date.now() } = {}) {
    this.store = store; this.write = write; this.now = now;
  }
  log(level, event, fields = {}) {
    const rec = { t: new Date(this.now()).toISOString(), level, event };
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && k !== "prompt") rec[k] = v;
    try { this.write(JSON.stringify(rec)); } catch { /* never let logging break a run */ }
  }
  count(name, n = 1) {
    if (!this.store) return;
    const m = this.store.getState("metrics", { since: new Date(this.now()).toISOString(), counters: {}, durations: [] });
    m.counters[name] = (m.counters[name] || 0) + n;
    this.store.setState("metrics", m);
  }
  duration(ms) {
    if (!this.store) return;
    const m = this.store.getState("metrics", { since: new Date(this.now()).toISOString(), counters: {}, durations: [] });
    m.durations = (m.durations || []).concat(Math.round(ms)).slice(-200);
    this.store.setState("metrics", m);
  }
  metrics() {
    const m = this.store ? this.store.getState("metrics", { counters: {}, durations: [] }) : { counters: {}, durations: [] };
    const d = (m.durations || []).slice().sort((a, b) => a - b);
    const pct = (p) => (d.length ? d[Math.min(d.length - 1, Math.floor(p * d.length))] : null);
    return { since: m.since || null, counters: m.counters || {}, runDurationMs: { count: d.length, p50: pct(0.5), p90: pct(0.9) } };
  }
}
