// Минимальный node:util для браузерного бандла.
// Нужен xxhash-wasm (берёт оттуда TextEncoder) и части protodef.
export const TextEncoder = globalThis.TextEncoder;
export const TextDecoder = globalThis.TextDecoder;

export function inherits(ctor, superCtor) {
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
  Object.setPrototypeOf(ctor, superCtor);
}

export function inspect(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function format(...args) {
  return args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' ');
}

export function promisify(fn) {
  return (...args) =>
    new Promise((resolve, reject) => {
      fn(...args, (err, res) => (err ? reject(err) : resolve(res)));
    });
}

export const types = {
  isTypedArray: (v) => ArrayBuffer.isView(v) && !(v instanceof DataView),
};

export default { TextEncoder, TextDecoder, inherits, inspect, format, promisify, types };
