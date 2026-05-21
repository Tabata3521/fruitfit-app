const cp1251Special = new Map([
  ["Ђ", 0x80], ["Ѓ", 0x81], ["‚", 0x82], ["ѓ", 0x83], ["„", 0x84], ["…", 0x85],
  ["†", 0x86], ["‡", 0x87], ["€", 0x88], ["‰", 0x89], ["Љ", 0x8a], ["‹", 0x8b],
  ["Њ", 0x8c], ["Ќ", 0x8d], ["Ћ", 0x8e], ["Џ", 0x8f], ["ђ", 0x90], ["‘", 0x91],
  ["’", 0x92], ["“", 0x93], ["”", 0x94], ["•", 0x95], ["–", 0x96], ["—", 0x97],
  ["™", 0x99], ["љ", 0x9a], ["›", 0x9b], ["њ", 0x9c], ["ќ", 0x9d], ["ћ", 0x9e],
  ["џ", 0x9f], ["Ё", 0xa8], ["ё", 0xb8], ["№", 0xb9],
]);

function cp1251Byte(char) {
  const code = char.charCodeAt(0);
  if (code <= 0x7f) return code;
  if (code >= 0x410 && code <= 0x42f) return code - 0x410 + 0xc0;
  if (code >= 0x430 && code <= 0x44f) return code - 0x430 + 0xe0;
  if (cp1251Special.has(char)) return cp1251Special.get(char);
  if (code >= 0xa0 && code <= 0xff) return code;
  return 0x3f;
}

export function decodeText(value) {
  if (typeof value !== "string") return value ?? "";
  const looksMojibake = /[РС][\u0400-\u040f\u0450-\u045f\u2018-\u2026]/.test(value);
  if (!looksMojibake) return value;

  try {
    const bytes = Uint8Array.from([...value].map(cp1251Byte));
    return new TextDecoder("utf-8").decode(bytes).replace(/\s+Добавить занятие$/i, "").trim();
  } catch (_) {
    return value;
  }
}

export function cleanTitle(value) {
  return decodeText(value)
    .replace(/\s+/g, " ")
    .replace(/\s+Добавить занятие$/i, "")
    .replace(/\.$/, "")
    .trim();
}
