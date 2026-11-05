'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../src/lib/exporters.js');

const start = new Date(2026, 10, 5, 14, 3, 0).getTime();
const sample = {
  id: 'abc',
  title: 'Weekly sync: site/plan?',
  platform: 'meet',
  url: 'https://meet.google.com/abc-defg-hij',
  meetingKey: 'meet:abc-defg-hij',
  startedAt: start,
  endedAt: start + 30 * 60000,
  participants: ['Ann', 'Bob'],
  entries: [
    { speaker: 'Ann', text: 'Hello.', ts: start + 5000, updatedTs: start + 6000 },
    { speaker: 'Ann', text: 'Let us start.', ts: start + 8000, updatedTs: start + 9000 },
    { speaker: 'Bob', text: 'Sure *now*', ts: start + 65000, updatedTs: start + 67000 }
  ]
};

test('formatElapsed', () => {
  assert.equal(X.formatElapsed(3725000), '01:02:05');
});

test('buildFilename sanitizes title', () => {
  assert.equal(X.buildFilename(sample, 'md'), '2026-11-05 1403 - Weekly sync_ site_plan_.md');
});

test('toTxt merges same speaker and uses elapsed time', () => {
  const txt = X.toTxt(sample, { mergeSameSpeaker: true, mergeGapSeconds: 20 });
  assert.match(txt, /^Weekly sync: site\/plan\?\n/);
  assert.match(txt, /\[00:00:05\] Ann: Hello\. Let us start\.\n/);
  assert.match(txt, /\[00:01:05\] Bob: Sure \*now\*\n/);
  assert.match(txt, /Participants: Ann, Bob/);
});

test('toTxt clock format without merging', () => {
  const txt = X.toTxt(sample, { mergeSameSpeaker: false, timestampFormat: 'clock' });
  assert.match(txt, /\[14:03:05\] Ann: Hello\.\n\[14:03:08\] Ann: Let us start\./);
});

test('toMarkdown escapes markdown characters', () => {
  const md = X.toMarkdown(sample, {});
  assert.match(md, /^# Weekly sync: site\/plan\?/);
  assert.match(md, /Sure \\\*now\\\*/);
  assert.match(md, /- \*\*Duration:\*\* 30 min/);
});

test('toJson is valid and has offsets', () => {
  const j = JSON.parse(X.toJson(sample));
  assert.equal(j.entries.length, 3);
  assert.equal(j.entries[2].offsetSeconds, 65);
  assert.equal(j.participants.length, 2);
});

test('toVtt produces cues (min 1.5 s each)', () => {
  const vtt = X.toVtt(sample, {});
  assert.match(vtt, /^WEBVTT\n\n1\n00:00:05\.000 --> 00:00:06\.500\n<v Ann>Hello\./);
  assert.equal((vtt.match(/-->/g) || []).length, 3);
});

test('render picks format', () => {
  const r = X.render(sample, 'json', {});
  assert.equal(r.mime, 'application/json');
  assert.ok(r.filename.endsWith('.json'));
});
