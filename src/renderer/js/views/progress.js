/**
 * PRO Link: turn Pokemon Revolution Online progress into pack rewards.
 *
 * PRO exposes no public API for your own account, so the honest way to read
 * progress from outside the game is its log output. Point this at a folder of
 * logs (PROShine writes one .txt per day under Logs/<account>-<server>/) and
 * every new line is matched against the rules below.
 */
import { el, ago, toast } from '../util.js';
import { app, notify } from '../store.js';

let cfg = null;

export async function renderProgress(root) {
  root.innerHTML = '';
  const pad = el('div', { class: 'pad' });
  root.append(pad);

  cfg = await window.api.tracker.get();

  pad.append(
    el('h2', { class: 'section' }, 'PRO LINK'),
    el('p', { class: 'sub' },
      'Earn packs by playing Pokemon Revolution Online. PRO has no public API for your own '
      + 'progress, so this watches the log files your client writes and pays out when a line '
      + 'matches one of your rules. Everything below is editable - tune it to how you play.'),
  );

  pad.append(sourcePanel(root));
  pad.append(rulesPanel());
  pad.append(testerPanel());
  pad.append(manualPanel());
  pad.append(feedPanel());
}

/* ------------------------------------------------------------ log source */

function sourcePanel(root) {
  const dirInput = el('input', { type: 'text', value: cfg.logDir || '', placeholder: 'e.g. C:\\PROShine\\Logs' });
  const status = el('span', { class: 'faint', style: 'font-size:12px' });

  const setStatus = (res) => {
    if (!res) return;
    if (res.status?.ok) {
      status.textContent = `watching ${res.status.files} log file${res.status.files === 1 ? '' : 's'}`;
      status.className = 'green';
    } else {
      status.textContent = res.status?.reason === 'disabled' ? 'not watching' : `not watching - ${res.status?.reason}`;
      status.className = 'faint';
    }
    status.style.fontSize = '12px';
  };

  const toggle = el('input', { type: 'checkbox' });
  toggle.checked = !!cfg.enabled;

  const apply = async () => {
    const res = await window.api.tracker.set({
      enabled: toggle.checked,
      logDir: dirInput.value.trim(),
    });
    cfg = { ...cfg, ...res.tracker };
    setStatus(res);
  };

  toggle.addEventListener('change', apply);

  const browse = el('button', {
    class: 'btn',
    onclick: async () => {
      const dir = await window.api.tracker.browse();
      if (dir) { dirInput.value = dir; await apply(); }
    },
  }, 'BROWSE');

  const suggestions = (cfg.suggestions || []).map((s) => el('button', {
    class: 'btn', style: 'font-size:8px',
    onclick: async () => { dirInput.value = s; await apply(); },
  }, s));

  const panel = el('div', { class: 'panel' },
    el('h3', {}, 'LOG FOLDER'),
    el('div', { style: 'display:flex;gap:10px;align-items:flex-end' },
      el('label', { class: 'field', style: 'flex:1;margin:0' }, el('span', {}, 'Folder to watch'), dirInput),
      browse,
      el('button', { class: 'btn primary', onclick: apply }, 'SAVE')),
    suggestions.length
      ? el('div', { style: 'margin-top:12px' },
        el('div', { class: 'faint', style: 'font-size:11px;margin-bottom:6px' }, 'Found on this machine:'),
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, suggestions))
      : null,
    el('div', { style: 'display:flex;gap:12px;align-items:center;margin-top:16px' },
      el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer' },
        toggle, 'Watch for progress and award packs automatically'),
      status),
    el('p', { class: 'faint', style: 'font-size:12px;margin:14px 0 0' },
      'PROShine writes logs to its own Logs folder, one .txt per day per account. '
      + 'Any folder of .txt or .log files works. When you first enable this, existing lines are '
      + 'skipped so a month of old logs does not pay out at once.'),
  );
  setStatus({ status: cfg.enabled && cfg.logDir ? { ok: true, files: 0 } : { ok: false, reason: 'disabled' } });
  return panel;
}

/* ----------------------------------------------------------------- rules */

function rulesPanel() {
  const list = el('div', { class: 'rules-editor' });

  const header = el('div', { class: 'rule-row', style: 'background:transparent;border-color:transparent;padding-bottom:0' },
    el('span', {}),
    el('span', { class: 'col-head' }, 'EVENT / PATTERN'),
    el('span', { class: 'col-head' }, 'PACKS'),
    el('span', { class: 'col-head' }, 'EVERY N'),
    el('span', { class: 'col-head' }, 'COOLDOWN'),
    el('span', { class: 'col-head' }, 'DAILY CAP'),
  );

  const save = async () => {
    await window.api.tracker.set({ rules: cfg.rules });
  };

  const paint = () => {
    list.innerHTML = '';
    list.append(header);
    for (const rule of cfg.rules) {
      const on = el('input', { type: 'checkbox' });
      on.checked = rule.enabled !== false;
      on.addEventListener('change', () => { rule.enabled = on.checked; save(); });

      const pattern = el('input', { type: 'text', value: rule.pattern });
      pattern.addEventListener('change', () => {
        try { new RegExp(pattern.value, 'i'); pattern.style.borderColor = ''; } catch {
          pattern.style.borderColor = 'var(--red)';
          return;
        }
        rule.pattern = pattern.value;
        save();
      });

      const num = (key, min = 0) => {
        const i = el('input', { type: 'number', min: String(min), value: String(rule[key] ?? 0) });
        i.addEventListener('change', () => { rule[key] = Number(i.value); save(); });
        return i;
      };

      const progress = cfg.progress?.[rule.id];
      list.append(el('div', { class: 'rule-row' },
        on,
        el('div', { class: 'rl-label' }, rule.label,
          el('small', {}, pattern.value),
          progress ? el('small', { class: 'faint' }, `${progress.hits} matches, ${progress.awarded} packs awarded`) : null),
        num('packs', 1), num('everyN', 1), num('cooldownSec'), num('dailyCap')));

      // The editable pattern lives under the label so the row stays compact.
      const row = list.lastChild;
      row.querySelector('.rl-label').append(pattern);
      pattern.style.marginTop = '6px';
    }
  };
  paint();

  return el('div', { class: 'panel' },
    el('h3', {}, 'REWARD RULES'),
    el('p', { class: 'faint', style: 'font-size:12px;margin:0 0 14px' },
      'A rule fires when a log line matches its pattern (a case-insensitive regular expression). '
      + '"Every N" means only pay out on every Nth match; cooldown and daily cap stop a chatty log '
      + 'from flooding you with packs.'),
    list);
}

/* ---------------------------------------------------------------- tester */

function testerPanel() {
  const input = el('textarea', {
    rows: '4',
    placeholder: 'Paste a few real lines from your log here to see which rules they hit.',
  });
  const out = el('div', { style: 'margin-top:12px' });

  const run = async () => {
    const lines = input.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { out.innerHTML = ''; return; }
    const results = await window.api.tracker.test(lines);
    out.innerHTML = '';
    out.append(el('table', { class: 'grid' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Line'), el('th', {}, 'Matches'), el('th', {}, 'Reward'))),
      el('tbody', {}, results.map((r) => el('tr', {},
        el('td', { class: 'mono', style: 'font-size:11px' }, r.line.slice(0, 90)),
        r.ruleId
          ? el('td', { class: 'green' }, r.label)
          : el('td', { class: 'faint' }, 'no rule'),
        el('td', { class: 'mono' }, r.ruleId ? `${r.packs} pack(s) every ${r.everyN || 1}` : '--'))))));
  };

  input.addEventListener('input', run);

  return el('div', { class: 'panel' },
    el('h3', {}, 'RULE TESTER'),
    el('p', { class: 'faint', style: 'font-size:12px;margin:0 0 12px' },
      'The exact wording of a log line depends on your client and script, so the defaults are a '
      + 'starting point rather than a guarantee. Paste real lines here and adjust the patterns '
      + 'until they light up. Nothing here awards packs.'),
    input, out);
}

/* ---------------------------------------------------------------- manual */

function manualPanel() {
  const n = el('input', { type: 'number', min: '1', value: '1', style: 'width:90px' });
  const why = el('input', { type: 'text', placeholder: 'what did you do?', value: '' });
  return el('div', { class: 'panel' },
    el('h3', {}, 'ADD PACKS BY HAND'),
    el('p', { class: 'faint', style: 'font-size:12px;margin:0 0 12px' },
      'For milestones the log does not capture - a gym cleared, a boss down, a shiny caught.'),
    el('div', { style: 'display:flex;gap:10px;align-items:flex-end' },
      el('label', { class: 'field', style: 'margin:0' }, el('span', {}, 'Packs'), n),
      el('label', { class: 'field', style: 'flex:1;margin:0' }, el('span', {}, 'Reason'), why),
      el('button', {
        class: 'btn primary',
        onclick: async () => {
          const count = Math.max(1, Number(n.value) || 1);
          app.state.wallet = await window.api.addPacks(count, why.value.trim() || 'Added by hand');
          why.value = '';
          notify();
          toast('PACKS ADDED', `${count} pack${count === 1 ? '' : 's'} added to your wallet.`);
        },
      }, 'ADD')));
}

/* ------------------------------------------------------------------ feed */

function feedPanel() {
  const feed = cfg.feed || [];
  return el('div', { class: 'panel' },
    el('h3', {}, 'REWARD HISTORY'),
    feed.length
      ? el('div', { class: 'feed' }, feed.slice(0, 60).map((f) => el('div', { class: 'feed-row' },
        el('span', { class: 'fr-packs' }, `+${f.packs}`),
        el('span', { style: 'flex:1' }, f.reason),
        el('span', { class: 'fr-when' }, ago(f.at)))))
      : el('p', { class: 'faint', style: 'margin:0;font-size:13px' }, 'No packs earned yet.'));
}

export default renderProgress;
