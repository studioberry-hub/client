// Мини-замена пакета `minecraft-data` для мирового бандла.
//
// Зачем: настоящий `minecraft-data` через свой data.js статически ссылается на JSON
// всех версий игры (~500 МБ после бандлинга). Рендереру и prismarine-* нужен ровно
// один набор данных, поэтому здесь собирается IndexedData только для одной версии.
//
// Формат модуля намеренно CommonJS с `module.exports = функция`: потребители
// вперемешку делают и `import MinecraftData from 'minecraft-data'` (ESM, нужен
// вызываемый default), и `require('minecraft-data').legacy.pc` (CJS, нужны свойства
// на самой функции). ESM-обёртка такую двойственность не воспроизводит.
//
// Переиспользуются штатные loader/indexer/supportsFeature самого minecraft-data,
// чтобы форма объекта совпадала с оригиналом один в один.
const mcDataToNode = require('minecraft-data/lib/loader.js');
const supportFeature = require('minecraft-data/lib/supportsFeature.js');
const indexer = require('minecraft-data/lib/indexer.js');

const protocolVersionsPc = require('minecraft-data/minecraft-data/data/pc/common/protocolVersions.json');
const versionsPc = require('minecraft-data/minecraft-data/data/pc/common/versions.json');
const legacyPc = require('minecraft-data/minecraft-data/data/pc/common/legacy.json');

const BUNDLED_VERSION = '1.21.4';

// ===== Данные единственной поддерживаемой версии =====
// Пути повторяют data.js оригинала для '1.21.4' (часть файлов там шарится
// с более ранними версиями — это учтено).
const rawData = {
  blocks: require('minecraft-data/minecraft-data/data/pc/1.21.4/blocks.json'),
  blockCollisionShapes: require('minecraft-data/minecraft-data/data/pc/1.21.4/blockCollisionShapes.json'),
  biomes: require('minecraft-data/minecraft-data/data/pc/1.21.4/biomes.json'),
  items: require('minecraft-data/minecraft-data/data/pc/1.21.4/items.json'),
  materials: require('minecraft-data/minecraft-data/data/pc/1.21.4/materials.json'),
  effects: require('minecraft-data/minecraft-data/data/pc/1.21.4/effects.json'),
  enchantments: require('minecraft-data/minecraft-data/data/pc/1.21.1/enchantments.json'),
  entities: require('minecraft-data/minecraft-data/data/pc/1.21.4/entities.json'),
  foods: require('minecraft-data/minecraft-data/data/pc/1.21.1/foods.json'),
  instruments: require('minecraft-data/minecraft-data/data/pc/1.20.5/instruments.json'),
  particles: require('minecraft-data/minecraft-data/data/pc/1.21.4/particles.json'),
  attributes: require('minecraft-data/minecraft-data/data/pc/1.21.3/attributes.json'),
  tints: require('minecraft-data/minecraft-data/data/pc/1.21.4/tints.json'),
  version: require('minecraft-data/minecraft-data/data/pc/1.21.4/version.json'),
};

const protocolVersions = { pc: protocolVersionsPc, bedrock: [] };

for (let i = 0; i < protocolVersions.pc.length; i++) {
  if (!protocolVersions.pc[i].dataVersion) protocolVersions.pc[i].dataVersion = -i;
}

const versionsByMinecraftVersion = {
  pc: indexer.buildIndexFromArray(protocolVersions.pc, 'minecraftVersion'),
  bedrock: {},
};
const versionsByMajorVersion = {
  pc: indexer.buildIndexFromArray(protocolVersions.pc.slice().reverse(), 'majorVersion'),
  bedrock: {},
};

// Повторяет конструктор Version из index.js minecraft-data: объект версии с
// операторами сравнения, на них опираются supportFeature и prismarine-*.
function Version(type, version, majorVersion) {
  const versions = versionsByMinecraftVersion[type];
  for (const key in versions) {
    const versionObj = versions[key];
    if (versionObj.minecraftVersion.endsWith('.0')) versions[versionObj.majorVersion] = versionObj;
  }
  this.dataVersion = versions[version] ? versions[version].dataVersion : undefined;
  const v1 = this.dataVersion == null ? 0 : this.dataVersion;
  const raise = (other) => {
    throw new RangeError(`Version '${other}' not found for ${type}`);
  };
  this['>='] = (other) => (versions[other] ? v1 >= versions[other].dataVersion : raise(other));
  this['>'] = (other) => (versions[other] ? v1 > versions[other].dataVersion : raise(other));
  this['<'] = (other) => (versions[other] ? v1 < versions[other].dataVersion : raise(other));
  this['<='] = (other) => (versions[other] ? v1 <= versions[other].dataVersion : raise(other));
  this['=='] = (other) => (versions[other] ? v1 === versions[other].dataVersion : raise(other));
  this.type = type;
  this.majorVersion = majorVersion;
  return this;
}

let cached = null;

function loadVersion(mcVersion) {
  // Любой запрос отдаёт единственную вшитую версию: PoC работает только с ней,
  // но рендерер и prismarine-* спрашивают данные по разным строкам версии.
  if (mcVersion !== undefined && String(mcVersion) !== BUNDLED_VERSION) {
    console.warn(`[mcdata-mini] запрошена версия ${mcVersion}, отдаём вшитую ${BUNDLED_VERSION}`);
  }
  if (cached) return cached;

  const nmcData = mcDataToNode(rawData);
  nmcData.type = 'pc';
  const majorVersion = new Version('pc', BUNDLED_VERSION, '1.21');
  nmcData.version = Object.assign(majorVersion, nmcData.version);
  nmcData.isNewerOrEqualTo = (v) => nmcData.version['>='](v);
  nmcData.isOlderThan = (v) => nmcData.version['<'](v);
  nmcData.supportFeature = supportFeature(nmcData.version, protocolVersions.pc);
  cached = nmcData;
  return nmcData;
}

loadVersion.BUNDLED_VERSION = BUNDLED_VERSION;
loadVersion.Version = Version;
loadVersion.versions = protocolVersions;
loadVersion.supportedVersions = { pc: versionsPc, bedrock: [] };
loadVersion.versionsByMinecraftVersion = versionsByMinecraftVersion;
loadVersion.versionsByMajorVersion = versionsByMajorVersion;
loadVersion.preNettyVersionsByProtocolVersion = { pc: {}, bedrock: {} };
loadVersion.postNettyVersionsByProtocolVersion = { pc: {}, bedrock: {} };
loadVersion.legacy = { pc: legacyPc, bedrock: { blocks: {}, items: {} } };
loadVersion.schemas = {};
// Совместимость с `import { default as X }` и `import * as X` в бандле esbuild.
loadVersion.default = loadVersion;

module.exports = loadVersion;
