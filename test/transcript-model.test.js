'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeText, TranscriptTracker, mergeConsecutive } = require('../src/lib/transcript-model.js');

test('mergeText: growth replaces with longer text', () => {
  assert.equal(mergeText('Hello every', 'Hello everyone, welcome'), 'Hello everyone, welcome');
});

test('mergeText: revision with same beginning takes new text', () => {
  assert.equal(mergeText('So the plan is too go', 'So the plan is to go ahead.'), 'So the plan is to go ahead.');
});

test('mergeText: trimmed start continues via overlap', () => {
  const prev = 'one two three four five six seven';
  const next = 'five six seven eight nine';
  assert.equal(mergeText(prev, next), 'one two three four five six seven eight nine');
});

test('mergeText: visible fragment of existing text keeps prev', () => {
  assert.equal(mergeText('alpha beta gamma delta epsilon', 'gamma delta'), 'alpha beta gamma delta epsilon');
});

test('mergeText: shorter text with same head that is a prefix keeps prev', () => {
  assert.equal(mergeText('We ship on Friday', 'We ship on'), 'We ship on Friday');
});

test('mergeText: whitespace is normalized', () => {
  assert.equal(mergeText('  a   b ', 'a b'), 'a b');
});

test('tracker: live revisions of one block produce one entry', () => {
  const t = new TranscriptTracker();
  t.update([{ key: 1, speaker: 'Ann', text: 'Good' }], 1000);
  t.update([{ key: 1, speaker: 'Ann', text: 'Good morning' }], 1500);
  t.update([{ key: 1, speaker: 'Ann', text: 'Good morning, everyone.' }], 2000);
  assert.equal(t.entries.length, 1);
  assert.equal(t.entries[0].text, 'Good morning, everyone.');
  assert.equal(t.entries[0].ts, 1000);
  assert.equal(t.entries[0].updatedTs, 2000);
});

test('tracker: speaker change creates new entries in order', () => {
  const t = new TranscriptTracker();
  t.update([{ key: 1, speaker: 'Ann', text: 'Hi Bob' }], 1000);
  t.update([{ key: 1, speaker: 'Ann', text: 'Hi Bob' }, { key: 2, speaker: 'Bob', text: 'Hi Ann' }], 2000);
  t.update([{ key: 2, speaker: 'Bob', text: 'Hi Ann, how are you?' }], 3000);
  assert.deepEqual(t.entries.map((e) => [e.speaker, e.text]), [
    ['Ann', 'Hi Bob'],
    ['Bob', 'Hi Ann, how are you?']
  ]);
});

test('tracker: block re-rendered with a new key is not duplicated', () => {
  const t = new TranscriptTracker();
  const text = 'This is a long enough sentence to rebind';
  t.update([{ key: 1, speaker: 'Ann', text }], 1000);
  t.update([], 2000); // panel hidden
  t.update([{ key: 99, speaker: 'Ann', text }], 60000); // panel shown again, new DOM node
  assert.equal(t.entries.length, 1);
});

test('tracker: whole list re-rendered in one update re-binds every entry', () => {
  const t = new TranscriptTracker();
  t.update([
    { key: 1, speaker: 'Alice', text: 'Welcome to the weekly meeting everyone.' },
    { key: 2, speaker: 'Carl', text: 'Sounds good to me.' }
  ], 1000);
  t.update([
    { key: 3, speaker: 'Alice', text: 'Welcome to the weekly meeting everyone.' },
    { key: 4, speaker: 'Carl', text: 'Sounds good to me.' }
  ], 2000);
  assert.equal(t.entries.length, 2);
});

test('tracker: genuine short repeat later is kept as a new entry', () => {
  const t = new TranscriptTracker();
  t.update([{ key: 1, speaker: 'Ann', text: 'Yes.' }], 1000);
  t.update([], 2000);
  t.update([{ key: 2, speaker: 'Ann', text: 'Yes.' }], 120000);
  assert.equal(t.entries.length, 2);
});

test('tracker: two visible blocks with identical short text stay separate', () => {
  const t = new TranscriptTracker();
  t.update([{ key: 1, speaker: 'Ann', text: 'OK' }], 1000);
  t.update([{ key: 1, speaker: 'Ann', text: 'OK' }, { key: 2, speaker: 'Ann', text: 'OK' }], 2000);
  assert.equal(t.entries.length, 2);
});

test('tracker: empty blocks are ignored and missing speaker becomes Unknown', () => {
  const t = new TranscriptTracker();
  t.update([{ key: 1, speaker: '', text: '  ' }, { key: 2, speaker: '', text: 'hello' }], 1000);
  assert.equal(t.entries.length, 1);
  assert.equal(t.entries[0].speaker, 'Unknown');
  t.update([{ key: 2, speaker: 'Carl', text: 'hello there' }], 1200);
  assert.equal(t.entries[0].speaker, 'Carl');
  assert.deepEqual(t.speakers(), ['Carl']);
});

test('tracker: continues from existing entries (rejoin)', () => {
  const t = new TranscriptTracker({ entries: [{ speaker: 'Ann', text: 'Earlier', ts: 1, updatedTs: 1 }] });
  t.update([{ key: 5, speaker: 'Bob', text: 'Back again' }], 5000);
  assert.equal(t.entries.length, 2);
});

test('mergeConsecutive merges same speaker within gap only', () => {
  const merged = mergeConsecutive([
    { speaker: 'Ann', text: 'One.', ts: 0, updatedTs: 1000 },
    { speaker: 'Ann', text: 'Two.', ts: 5000, updatedTs: 6000 },
    { speaker: 'Bob', text: 'Three.', ts: 7000, updatedTs: 8000 },
    { speaker: 'Bob', text: 'Four.', ts: 60000, updatedTs: 61000 }
  ], 20000);
  assert.deepEqual(merged.map((e) => [e.speaker, e.text]), [
    ['Ann', 'One. Two.'],
    ['Bob', 'Three.'],
    ['Bob', 'Four.']
  ]);
});
