// Заглушка node:zlib для браузерного бандла.
// prismarine-nbt тянет zlib ради gzip/deflate у сжатого NBT. В PoC сжатый NBT не
// разбирается (чанк генерируется в памяти), поэтому вызовы падают явной ошибкой,
// а не молча отдают мусор.
const fail = () => new Error('zlib недоступен в браузерном бандле (world PoC)');

const asyncStub = (...args) => {
  const cb = args[args.length - 1];
  if (typeof cb === 'function') cb(fail());
  else throw fail();
};
const syncStub = () => {
  throw fail();
};

export const gzip = asyncStub;
export const gunzip = asyncStub;
export const deflate = asyncStub;
export const inflate = asyncStub;
export const unzip = asyncStub;
export const gzipSync = syncStub;
export const gunzipSync = syncStub;
export const deflateSync = syncStub;
export const inflateSync = syncStub;
export const unzipSync = syncStub;

export default {
  gzip,
  gunzip,
  deflate,
  inflate,
  unzip,
  gzipSync,
  gunzipSync,
  deflateSync,
  inflateSync,
  unzipSync,
};
