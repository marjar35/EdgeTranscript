/* Scenario runner: simulates each platform's caption DOM and checks the saved transcript. */
'use strict';
(async function () {
  const stage = document.getElementById('stage');
  const out = document.getElementById('out');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const settings = { ...ETSettings.withDefaults({}), autoEnableCaptions: false, showInPageHint: false, rejoinWindowMinutes: 0 };
  const results = [];

  function adapter(id) {
    return ETPlatforms.find((p) => p.id === id);
  }

  async function run(name, platformId, buildCall, script, expected) {
    stage.innerHTML = '';
    const a = adapter(platformId);
    const fake = buildCall(stage);
    const rec = new ETRecorder.CaptionRecorder(a, settings, () => {});
    let error = null;
    let got = [];
    try {
      if (!a.isInCall(document)) throw new Error('isInCall() returned false for simulated call UI');
      await rec.start();
      if (rec.status !== 'waiting-captions' && rec.status !== 'recording') throw new Error('unexpected status ' + rec.status);
      for (const step of script) {
        step(fake);
        await sleep(320); // > READ_THROTTLE_MS so the observer fires
        rec.tick();
      }
      await rec.stop();
      const saved = await ETStorage.getTranscript(rec.transcript.id);
      got = saved.entries.map((e) => [e.speaker, e.text]);
      if (JSON.stringify(got) !== JSON.stringify(expected)) throw new Error('entries differ');
      if (!saved.endedAt) throw new Error('endedAt not set');
    } catch (e) {
      error = e.message;
    }
    results.push({ name, ok: !error });
    out.append(Object.assign(document.createElement('h3'), { className: error ? 'fail' : 'pass', textContent: `${error ? 'FAIL' : 'PASS'} — ${name}${error ? ': ' + error : ''}` }));
    out.append(Object.assign(document.createElement('pre'), { textContent: 'got:      ' + JSON.stringify(got) + '\nexpected: ' + JSON.stringify(expected) }));
  }

  // ---------- Google Meet ----------
  await run('Google Meet: growth, revision, speaker change, scroll-off, panel re-render', 'meet',
    (s) => {
      s.innerHTML = '<button jsname="CQylAd" aria-label="Leave call">Leave</button>';
      const region = document.createElement('div');
      region.setAttribute('role', 'region');
      region.setAttribute('aria-label', 'Captions');
      const list = document.createElement('div');
      region.append(list);
      return {
        region, list,
        add(speaker, text) {
          const b = document.createElement('div');
          b.className = 'nMcdL';
          b.innerHTML = '<div><img alt=""><span class="NWpY1d"></span></div><div class="ygicle"></div>';
          b.querySelector('.NWpY1d').textContent = speaker;
          b.querySelector('.ygicle').textContent = text;
          list.append(b);
          return b;
        },
        set(b, text) { b.querySelector('.ygicle').textContent = text; }
      };
    },
    [
      (f) => {}, // captions still off
      (f) => stage.append(f.region),
      (f) => { f.ann = f.add('Ann Smith', 'Good'); },
      (f) => f.set(f.ann, 'Good morning every'),
      (f) => f.set(f.ann, 'Good morning everyone, let us start.'),
      (f) => { f.bob = f.add('Bob Lee', 'Thanks Ann'); },
      (f) => f.set(f.bob, 'Thanks Ann. The report is ready'),
      (f) => { f.ann.remove(); },
      (f) => f.set(f.bob, 'Thanks Ann. The report is ready and I sent it this morning.'),
      // Meet trims the beginning of a long block:
      (f) => f.set(f.bob, 'ready and I sent it this morning. Please review it by Friday.'),
      // captions panel turned off and on again -> new DOM nodes with the same text
      (f) => { f.region.remove(); },
      (f) => { f.list.innerHTML = ''; f.bob = f.add('Bob Lee', 'Thanks Ann. The report is ready and I sent it this morning. Please review it by Friday.'); stage.append(f.region); },
      (f) => { f.ann = f.add('Ann Smith', 'Will do.'); }
    ],
    [
      ['Ann Smith', 'Good morning everyone, let us start.'],
      ['Bob Lee', 'Thanks Ann. The report is ready and I sent it this morning. Please review it by Friday.'],
      ['Ann Smith', 'Will do.']
    ]);

  // ---------- Microsoft Teams ----------
  await run('Teams: data-tid captions with live revisions', 'teams',
    (s) => {
      s.innerHTML = '<button id="hangup-button">Leave</button><div data-tid="closed-caption-renderer-wrapper"><div class="list"></div></div>';
      const list = s.querySelector('.list');
      return {
        add(speaker, text) {
          const item = document.createElement('div');
          item.className = 'fui-ChatMessageCompact';
          item.innerHTML = '<span data-tid="author"></span><span data-tid="closed-caption-text"></span>';
          item.querySelector('[data-tid="author"]').textContent = speaker;
          item.querySelector('[data-tid="closed-caption-text"]').textContent = text;
          list.append(item);
          return item;
        },
        set(item, text) { item.querySelector('[data-tid="closed-caption-text"]').textContent = text; }
      };
    },
    [
      (f) => { f.a = f.add('Karel Svoboda', 'Hello team'); },
      (f) => f.set(f.a, 'Hello team, can you hear me?'),
      (f) => { f.b = f.add('Petra Nová', 'Yes we can.'); },
      (f) => { f.c = f.add('Karel Svoboda', 'Great, first item is the site schedule.'); }
    ],
    [
      ['Karel Svoboda', 'Hello team, can you hear me?'],
      ['Petra Nová', 'Yes we can.'],
      ['Karel Svoboda', 'Great, first item is the site schedule.']
    ]);

  // ---------- Zoom ----------
  await run('Zoom: full transcript panel, name omitted on consecutive items, virtualized re-render', 'zoom',
    (s) => {
      s.innerHTML = '<button class="footer__leave-btn">Leave</button><div class="lt-full-transcript"><div class="lt-full-transcript__list"></div></div>';
      const list = s.querySelector('.lt-full-transcript__list');
      return {
        list,
        add(speaker, text) {
          const item = document.createElement('div');
          item.className = 'lt-full-transcript__item';
          item.innerHTML = '<div class="lt-full-transcript__display-name"></div><div class="lt-full-transcript__message"></div>';
          item.firstChild.textContent = speaker;
          item.lastChild.textContent = text;
          list.append(item);
          return item;
        }
      };
    },
    [
      (f) => { f.add('Alice', 'Welcome to the weekly meeting everyone.'); },
      (f) => { f.add('', 'Today we discuss the budget for next quarter.'); },
      (f) => { f.add('Carl', 'Sounds good to me.'); },
      // virtualized list re-renders all items with new nodes
      (f) => {
        f.list.innerHTML = '';
        f.add('Alice', 'Welcome to the weekly meeting everyone.');
        f.add('', 'Today we discuss the budget for next quarter.');
        f.add('Carl', 'Sounds good to me.');
      }
    ],
    [
      ['Alice', 'Welcome to the weekly meeting everyone.'],
      ['Alice', 'Today we discuss the budget for next quarter.'],
      ['Carl', 'Sounds good to me.']
    ]);

  // ---------- Not in call ----------
  {
    stage.innerHTML = '<div>Meet lobby: Ask to join</div>';
    const ok = !adapter('meet').isInCall(document) && !adapter('teams').isInCall(document) && !adapter('zoom').isInCall(document);
    results.push({ name: 'lobby is not detected as in-call', ok });
    out.append(Object.assign(document.createElement('h3'), { className: ok ? 'pass' : 'fail', textContent: `${ok ? 'PASS' : 'FAIL'} — lobby is not detected as in-call` }));
  }

  stage.innerHTML = '';
  window.__results = results;
  document.title = results.every((r) => r.ok) ? 'ALL PASS' : 'FAILURES';
})();
