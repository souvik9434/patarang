/**
 * src/presets.js — GenSpark-derived high-design slide presets & creative objects.
 *
 * Modeled on recon/genspark-slide-1.html and recon/skills-catalog.json (docs/11 CS.3).
 * Uses theme CSS custom properties (--surface, --ink, --muted, --accent, --accent2,
 * --line, --positive) so every preset adapts to all 10 themes and custom palettes.
 */

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const PRESET_CATALOG = {
  'cover-keynote': {
    label: 'Keynote Cover (GenSpark Slide 1)',
    description: 'Centered full-bleed cover with badge, 60px display headline, 3 KPI stat cards, and 2x2 glass highlight grid.',
    fields: ['badge', 'title', 'subtitle', 'stats[{value,label}]', 'highlights[{head,text}]'],
  },
  'split-bleed': {
    label: '50/50 Full-Bleed Split',
    description: 'Edge-to-edge left visual/hero stat showcase + right editorial thesis and 3 numbered pillars.',
    fields: ['kicker', 'title', 'subtitle', 'heroStat', 'heroLabel', 'imageUrl?', 'pillars[{head,text}]'],
  },
  'architecture-flow': {
    label: 'System Architecture Flowchart',
    description: '4-stage connected SVG pipeline with marker arrowheads + 3 telemetry cards below.',
    fields: ['kicker', 'title', 'subtitle', 'nodes[{stage,title,sub}]', 'cards[{label,value,text}]'],
  },
  'funnel-conversion': {
    label: 'Conversion Funnel & Diagnostics',
    description: 'Left 4-stage tapered SVG funnel with conversion rates + right 3 diagnostic cards.',
    fields: ['kicker', 'title', 'subtitle', 'stages[{label,value,pct}]', 'insights[{head,text}]'],
  },
  'pricing-tiers': {
    label: '3-Tier Package & Unit Economics',
    description: '3-column pricing/tier cards with featured center tier, badge, price, and bullet checks.',
    fields: ['kicker', 'title', 'subtitle', 'tiers[{name,price,unit,badge?,featured?,features[]}]'],
  },
  'device-showcase': {
    label: 'Product UI Device Mockup',
    description: 'Browser/app window frame with traffic-light dots, 3D shadow, live dashboard preview + 3 callouts.',
    fields: ['kicker', 'title', 'subtitle', 'url', 'metrics[{label,value}]', 'callouts[{head,text}]'],
  },
};

export function expandPreset(raw = {}) {
  const id = String(raw.preset || '').trim();
  const d = (raw.presetData && typeof raw.presetData === 'object') ? raw.presetData : raw;
  if (!PRESET_CATALOG[id]) return raw;

  if (id === 'cover-keynote') {
    const stats = (d.stats || [
      { value: '100%', label: 'Verified Signal' },
      { value: '24 hrs', label: 'Turnaround' },
      { value: '3.4×', label: 'ROI Velocity' },
    ]).slice(0, 3);
    const highs = (d.highlights || [
      { head: 'Pillar One', text: 'Core architectural thesis and market timing.' },
      { head: 'Pillar Two', text: 'Defensible moat and proprietary data loop.' },
      { head: 'Pillar Three', text: 'Unit economics and capital efficiency.' },
      { head: 'Pillar Four', text: '12-month scale roadmap and milestones.' },
    ]).slice(0, 4);
    const html = `
      <div data-sf-id="cover_wrap" style="width:1280px;height:720px;padding:48px 80px;display:flex;flex-direction:column;justify-content:space-between;align-items:center;text-align:center">
        <div data-sf-id="cover_top" style="display:flex;flex-direction:column;align-items:center;gap:12px;max-width:960px">
          <div data-sf-id="cover_badge" style="padding:6px 18px;border-radius:999px;background:var(--surface);border:1px solid var(--line);color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase">${esc(d.badge || d.kicker || 'EXECUTIVE KEYNOTE')}</div>
          <h1 data-sf-id="cover_h1" style="font-family:var(--font-display);font-size:56px;font-weight:800;line-height:1.05;letter-spacing:-.025em;color:var(--ink)">${esc(d.title || 'Keynote Presentation')}</h1>
          <p data-sf-id="cover_sub" style="font-size:20px;line-height:1.45;color:var(--muted);max-width:760px">${esc(d.subtitle || '')}</p>
        </div>
        <div data-sf-id="cover_stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:22px;width:100%">
          ${stats.map((s, i) => `
            <div data-sf-id="cstat_${i}" style="background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:20px 24px;box-shadow:0 16px 36px -22px rgba(0,0,0,.35)">
              <div style="font-family:var(--font-display);font-size:38px;font-weight:800;color:var(--accent)">${esc(s.value)}</div>
              <div style="font-size:14px;font-weight:600;color:var(--muted);margin-top:4px">${esc(s.label)}</div>
            </div>
          `).join('')}
        </div>
        <div data-sf-id="cover_grid" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;width:100%;background:var(--surface-alt);border:1px solid var(--line);border-radius:22px;padding:20px 24px;text-align:left">
          ${highs.map((h, i) => `
            <div data-sf-id="chigh_${i}" style="display:flex;align-items:flex-start;gap:12px;padding:8px 10px">
              <span style="width:10px;height:10px;border-radius:50%;background:var(--accent);margin-top:6px;flex:0 0 auto"></span>
              <div>
                <div style="font-size:16px;font-weight:700;color:var(--ink)">${esc(h.head)}</div>
                <div style="font-size:14px;color:var(--muted);margin-top:2px">${esc(h.text)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
    return { ...raw, archetype: 'custom', canvasMode: 'full-bleed', hideHeader: true, title: d.title || 'Keynote Cover', content: { html } };
  }

  if (id === 'split-bleed') {
    const pillars = (d.pillars || []).slice(0, 3);
    const leftVisual = d.imageUrl
      ? `<img src="${esc(d.imageUrl)}" alt="" style="width:100%;height:340px;object-fit:contain;border-radius:18px;margin-top:18px">`
      : `<div data-sf-id="sb_statbox" style="margin-top:28px;padding:32px;border-radius:24px;background:var(--surface);border:1px solid var(--line)">
           <div style="font-family:var(--font-display);font-size:76px;font-weight:800;line-height:1;color:var(--accent)">${esc(d.heroStat || '94%')}</div>
           <div style="font-size:18px;font-weight:600;color:var(--ink);margin-top:10px">${esc(d.heroLabel || 'Verified Benchmark')}</div>
         </div>`;
    const html = `
      <div data-sf-id="sb_wrap" style="width:1280px;height:720px;display:grid;grid-template-columns:540px 1fr">
        <div data-sf-id="sb_left" style="background:var(--surface-alt);border-right:1px solid var(--line);padding:64px 52px;display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div data-sf-id="sb_kicker" style="font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)">${esc(d.kicker || 'STRATEGIC SPLIT')}</div>
            <h1 data-sf-id="sb_title" style="font-family:var(--font-display);font-size:44px;font-weight:800;line-height:1.08;color:var(--ink);margin-top:12px">${esc(d.title || 'Split Bleed Layout')}</h1>
            <p data-sf-id="sb_sub" style="font-size:17px;line-height:1.5;color:var(--muted);margin-top:12px">${esc(d.subtitle || '')}</p>
          </div>
          ${leftVisual}
        </div>
        <div data-sf-id="sb_right" style="padding:64px 64px;display:flex;flex-direction:column;justify-content:center;gap:22px">
          ${pillars.map((p, i) => `
            <div data-sf-id="sb_p_${i}" style="background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:24px 28px;display:flex;gap:20px;align-items:flex-start">
              <div style="width:40px;height:40px;border-radius:12px;background:var(--surface-alt);border:1px solid var(--line);color:var(--accent);font-family:var(--font-display);font-weight:800;font-size:16px;display:flex;align-items:center;justify-content:center;flex:0 0 auto">0${i + 1}</div>
              <div>
                <div style="font-family:var(--font-display);font-size:21px;font-weight:700;color:var(--ink)">${esc(p.head)}</div>
                <div style="font-size:15px;line-height:1.45;color:var(--muted);margin-top:4px">${esc(p.text)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
    return { ...raw, archetype: 'custom', canvasMode: 'full-bleed', hideHeader: true, title: d.title || 'Split Bleed', content: { html } };
  }

  if (id === 'architecture-flow') {
    const nodes = (d.nodes || []).slice(0, 4);
    const cards = (d.cards || []).slice(0, 3);
    const svgNodes = nodes.map((n, i) => {
      const x = 20 + i * 275;
      const arrow = i < nodes.length - 1
        ? `<line x1="${x + 230}" y1="75" x2="${x + 268}" y2="75" stroke="var(--accent)" stroke-width="2.5" marker-end="url(#sf_arrow)"/>`
        : '';
      return `
        <g transform="translate(${x},15)">
          <rect width="230" height="120" rx="18" fill="var(--surface)" stroke="var(--line)" stroke-width="1.5"/>
          <text x="22" y="36" font-size="11" font-weight="700" fill="var(--accent)" letter-spacing="1.5">${esc(n.stage || `STAGE 0${i + 1}`)}</text>
          <text x="22" y="66" font-size="19" font-weight="800" fill="var(--ink)">${esc(n.title || '')}</text>
          <text x="22" y="94" font-size="13" fill="var(--muted)">${esc(n.sub || '')}</text>
        </g>${arrow}`;
    }).join('');
    const html = `
      <div data-sf-id="arch_svg" style="background:var(--surface-alt);border:1px solid var(--line);border-radius:22px;padding:18px 20px">
        <svg viewBox="0 0 1080 150" width="100%" height="150">
          <defs>
            <marker id="sf_arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 1 L9 5 L0 9 Z" fill="var(--accent)"/>
            </marker>
          </defs>
          ${svgNodes}
        </svg>
      </div>
      <div data-sf-id="arch_cards" style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;flex:1">
        ${cards.map((c, i) => `
          <div data-sf-id="acard_${i}" style="background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:24px;display:flex;flex-direction:column;justify-content:center;gap:8px">
            <div style="font-size:12px;font-weight:700;letter-spacing:.14em;color:var(--muted);text-transform:uppercase">${esc(c.label)}</div>
            <div style="font-family:var(--font-display);font-size:34px;font-weight:800;color:var(--accent)">${esc(c.value)}</div>
            <div style="font-size:15px;color:var(--muted);line-height:1.45">${esc(c.text)}</div>
          </div>
        `).join('')}
      </div>`;
    return { ...raw, archetype: 'custom', title: d.title || 'Architecture Flow', kicker: d.kicker || raw.kicker, subtitle: d.subtitle || raw.subtitle, content: { html } };
  }

  if (id === 'funnel-conversion') {
    const stages = (d.stages || []).slice(0, 4);
    const insights = (d.insights || []).slice(0, 3);
    const poly = stages.map((st, i) => {
      const y1 = 10 + i * 74, y2 = y1 + 62;
      const inset1 = i * 38, inset2 = (i + 1) * 38;
      const pts = `${20 + inset1},${y1} ${460 - inset1},${y1} ${460 - inset2},${y2} ${20 + inset2},${y2}`;
      return `
        <polygon points="${pts}" fill="var(--surface)" stroke="var(--accent)" stroke-width="2"/>
        <text x="240" y="${y1 + 28}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--muted)">${esc(st.label)}</text>
        <text x="240" y="${y1 + 50}" text-anchor="middle" font-size="18" font-weight="800" fill="var(--accent)">${esc(st.value)} (${esc(st.pct)})</text>`;
    }).join('');
    const html = `
      <div data-sf-id="fn_wrap" style="display:grid;grid-template-columns:490px 1fr;gap:26px;flex:1;align-items:center">
        <div data-sf-id="fn_svg" style="background:var(--surface-alt);border:1px solid var(--line);border-radius:22px;padding:16px">
          <svg viewBox="0 0 480 310" width="100%" height="310">${poly}</svg>
        </div>
        <div data-sf-id="fn_cards" style="display:flex;flex-direction:column;gap:16px">
          ${insights.map((ins, i) => `
            <div data-sf-id="fcard_${i}" style="background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:20px 24px">
              <div style="font-family:var(--font-display);font-size:19px;font-weight:700;color:var(--ink)">${esc(ins.head)}</div>
              <div style="font-size:15px;color:var(--muted);margin-top:4px;line-height:1.45">${esc(ins.text)}</div>
            </div>
          `).join('')}
        </div>
      </div>`;
    return { ...raw, archetype: 'custom', title: d.title || 'Conversion Funnel', kicker: d.kicker || raw.kicker, subtitle: d.subtitle || raw.subtitle, content: { html } };
  }

  if (id === 'pricing-tiers') {
    const tiers = (d.tiers || []).slice(0, 3);
    const html = `
      <div data-sf-id="pt_grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:22px;flex:1;align-items:stretch">
        ${tiers.map((t, i) => `
          <div data-sf-id="pt_${i}" style="background:${t.featured ? 'var(--surface-alt)' : 'var(--surface)'};border:${t.featured ? '2px solid var(--accent)' : '1px solid var(--line)'};border-radius:22px;padding:26px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 18px 40px -24px rgba(0,0,0,.4)">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)">${esc(t.name)}</span>
                ${t.badge ? `<span style="padding:3px 10px;border-radius:999px;background:var(--accent);color:#ffffff;font-size:11px;font-weight:700">${esc(t.badge)}</span>` : ''}
              </div>
              <div style="font-family:var(--font-display);font-size:42px;font-weight:800;color:var(--ink);margin-top:10px">${esc(t.price)} <span style="font-size:15px;font-weight:500;color:var(--muted)">${esc(t.unit || '')}</span></div>
              <ul style="list-style:none;display:flex;flex-direction:column;gap:10px;margin-top:18px">
                ${(t.features || []).slice(0, 4).map((f) => `<li style="font-size:15px;color:var(--ink);display:flex;gap:8px;align-items:center"><span style="color:var(--positive);font-weight:800">✓</span>${esc(f)}</li>`).join('')}
              </ul>
            </div>
          </div>
        `).join('')}
      </div>`;
    return { ...raw, archetype: 'custom', title: d.title || 'Pricing Tiers', kicker: d.kicker || raw.kicker, subtitle: d.subtitle || raw.subtitle, content: { html } };
  }

  if (id === 'device-showcase') {
    const metrics = (d.metrics || []).slice(0, 3);
    const callouts = (d.callouts || []).slice(0, 3);
    const html = `
      <div data-sf-id="dev_wrap" style="display:grid;grid-template-columns:1.15fr .85fr;gap:26px;flex:1;align-items:stretch">
        <div data-sf-id="dev_frame" style="background:var(--surface);border:1px solid var(--line);border-radius:20px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 48px -20px rgba(0,0,0,.55)">
          <div style="background:var(--surface-alt);padding:12px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px">
            <span style="width:10px;height:10px;border-radius:50%;background:#f87171"></span>
            <span style="width:10px;height:10px;border-radius:50%;background:#fbbf24"></span>
            <span style="width:10px;height:10px;border-radius:50%;background:#34d399"></span>
            <span style="margin-left:12px;font-size:12px;color:var(--muted);font-family:monospace">${esc(d.url || 'app.slideforge.local/live')}</span>
          </div>
          <div style="padding:24px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px;flex:1;align-content:center">
            ${metrics.map((m, i) => `
              <div data-sf-id="dev_m_${i}" style="background:var(--surface-alt);border:1px solid var(--line);border-radius:14px;padding:18px">
                <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase">${esc(m.label)}</div>
                <div style="font-family:var(--font-display);font-size:28px;font-weight:800;color:var(--accent);margin-top:6px">${esc(m.value)}</div>
              </div>
            `).join('')}
          </div>
        </div>
        <div data-sf-id="dev_calls" style="display:flex;flex-direction:column;justify-content:center;gap:14px">
          ${callouts.map((c, i) => `
            <div data-sf-id="dev_c_${i}" style="background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:18px 22px">
              <div style="font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--ink)">${esc(c.head)}</div>
              <div style="font-size:14px;color:var(--muted);margin-top:4px;line-height:1.45">${esc(c.text)}</div>
            </div>
          `).join('')}
        </div>
      </div>`;
    return { ...raw, archetype: 'custom', title: d.title || 'Product Showcase', kicker: d.kicker || raw.kicker, subtitle: d.subtitle || raw.subtitle, content: { html } };
  }

  return raw;
}


