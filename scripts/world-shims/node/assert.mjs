// Минимальный node:assert для браузерного бандла (нужен protodef-validator).
function assert(value, message) {
  if (!value) throw new Error(message ?? 'Assertion failed');
}

assert.ok = assert;
assert.strictEqual = (a, b, message) => {
  if (a !== b) throw new Error(message ?? `Assertion failed: ${String(a)} !== ${String(b)}`);
};
assert.notStrictEqual = (a, b, message) => {
  if (a === b) throw new Error(message ?? `Assertion failed: ${String(a)} === ${String(b)}`);
};
assert.equal = (a, b, message) => {
  // eslint-disable-next-line eqeqeq
  if (a != b) throw new Error(message ?? `Assertion failed: ${String(a)} != ${String(b)}`);
};
assert.deepStrictEqual = (a, b, message) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(message ?? 'Assertion failed: deep equal');
};
assert.fail = (message) => {
  throw new Error(message ?? 'Assertion failed');
};

export default assert;
export const ok = assert.ok;
export const strictEqual = assert.strictEqual;
export const notStrictEqual = assert.notStrictEqual;
export const equal = assert.equal;
export const deepStrictEqual = assert.deepStrictEqual;
export const fail = assert.fail;
