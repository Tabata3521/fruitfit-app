import assert from "node:assert/strict";
import fs from "node:fs";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
globalThis.window = {
  localStorage: globalThis.localStorage,
  dispatchEvent: () => {},
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

const profileStore = await import("../src/data/restrictionModel.js");
const programRestrictions = await import("../src/data/programRestrictions.js");

const {
  legacyRestrictionValue,
  normalizeRestrictionKeys,
  restrictionLabels,
  toggleRestrictionKey,
} = profileStore;

const tests = [
  ["legacy canonical string migrates", () => {
    assert.deepEqual(normalizeRestrictionKeys("knees"), ["knees"]);
  }],
  ["legacy Russian string migrates", () => {
    assert.deepEqual(normalizeRestrictionKeys("Боли в спине"), ["back"]);
  }],
  ["array supports all physical restrictions", () => {
    const keys = normalizeRestrictionKeys(["knees", "back", "shoulders", "hips"]);
    assert.deepEqual(keys, ["knees", "back", "shoulders", "hips"]);
    assert.equal(legacyRestrictionValue(keys), "knees");
  }],
  ["duplicates and unknown keys are removed", () => {
    assert.deepEqual(normalizeRestrictionKeys(["back", "unknown", "back", "hips"]), ["back", "hips"]);
  }],
  ["none is mutually exclusive", () => {
    assert.deepEqual(normalizeRestrictionKeys(["none", "knees"]), ["knees"]);
    assert.deepEqual(toggleRestrictionKey(["knees", "back"], "none"), ["none"]);
    assert.deepEqual(toggleRestrictionKey(["none"], "shoulders"), ["shoulders"]);
  }],
  ["removing the last physical restriction falls back to none", () => {
    assert.deepEqual(toggleRestrictionKey(["hips"], "hips"), ["none"]);
  }],
  ["program display keeps every restriction", () => {
    const state = programRestrictions.programRestrictionState({
      profile: { restrictionKeys: ["knees", "back", "shoulders", "hips"] },
    });
    assert.deepEqual(state.labels, ["Колени", "Спина", "Плечи", "Тазобедренные суставы"]);
    assert.equal(state.requiresAdaptation, false);
  }],
  ["unmatched server restrictions block training", () => {
    const state = programRestrictions.programRestrictionState({
      profile: { restrictionKeys: ["knees", "back"] },
      programAssignment: { restrictionKeys: ["knees", "back"], unmatchedRestrictions: ["back"] },
    });
    assert.equal(state.requiresAdaptation, true);
    assert.deepEqual(state.unmatchedLabels, ["Спина"]);
  }],
  ["labels never expose unknown technical values", () => {
    assert.deepEqual(restrictionLabels(["unknown", "none"]), ["Без ограничений"]);
    assert.equal(legacyRestrictionValue(["unknown"]), "none");
  }],
  ["client fallback reads the full array", () => {
    const source = fs.readFileSync(new URL("../src/data/useTrainingData.js", import.meta.url), "utf8");
    assert.match(source, /normalizeRestrictionKeys\(profile\.restrictionKeys, profile\.restrictions\)/);
    assert.match(source, /blockedFor\.some\(\(key\) => restrictionKeys\.includes\(key\)\)/);
  }],
];

let passed = 0;
for (const [name, test] of tests) {
  try {
    await test();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

console.log(`Restriction multiselect tests: ${passed}/${tests.length} passed`);
