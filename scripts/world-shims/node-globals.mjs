// Полифилы node-глобалов для мирового бандла (esbuild --inject).
// prismarine-chunk / prismarine-nbt работают с Buffer, а часть кода рендерера
// читает process.env — в браузерном окружении их нет.
import { Buffer as BufferPolyfill } from 'buffer';
import processPolyfill from 'process';

export { BufferPolyfill as Buffer };
export { processPolyfill as process };

// Некоторые CommonJS-модули из prismarine-стека ожидают `global`.
if (typeof globalThis.global === 'undefined') {
  globalThis.global = globalThis;
}
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = BufferPolyfill;
}
