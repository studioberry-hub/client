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
// Версия должна совпадать с той, что вшита в mesherWasm.js (minecraft-renderer):
// у воркера нет 1.21.11 — максимум pc/1.21.6 (+ latest). Иначе state ID колонок
// и реестр мешера расходятся, чанки уходят в mesherWork и не появляются на экране.
const mcDataToNode = require('minecraft-data/lib/loader.js');
const supportFeature = require('minecraft-data/lib/supportsFeature.js');
const indexer = require('minecraft-data/lib/indexer.js');

const protocolVersionsPc = require('minecraft-data/minecraft-data/data/pc/common/protocolVersions.json');
const versionsPc = require('minecraft-data/minecraft-data/data/pc/common/versions.json');
const legacyPc = require('minecraft-data/minecraft-data/data/pc/common/legacy.json');

const BUNDLED_VERSION = '1.21.6';

// ===== Данные единственной поддерживаемой версии =====
// Пути как в dataPaths.json для '1.21.6'.
const rawData = {
  blocks: require('minecraft-data/minecraft-data/data/pc/1.21.6/blocks.json'),
  blockCollisionShapes: require('minecraft-data/minecraft-data/data/pc/1.21.6/blockCollisionShapes.json'),
  biomes: require('minecraft-data/minecraft-data/data/pc/1.21.6/biomes.json'),
  items: require('minecraft-data/minecraft-data/data/pc/1.21.6/items.json'),
  materials: require('minecraft-data/minecraft-data/data/pc/1.21.6/materials.json'),
  effects: require('minecraft-data/minecraft-data/data/pc/1.21.6/effects.json'),
  enchantments: require('minecraft-data/minecraft-data/data/pc/1.21.6/enchantments.json'),
  entities: require('minecraft-data/minecraft-data/data/pc/1.21.6/entities.json'),
  foods: require('minecraft-data/minecraft-data/data/pc/1.21.6/foods.json'),
  instruments: require('minecraft-data/minecraft-data/data/pc/1.20.5/instruments.json'),
  particles: require('minecraft-data/minecraft-data/data/pc/1.21.6/particles.json'),
  attributes: require('minecraft-data/minecraft-data/data/pc/1.21.6/attributes.json'),
  tints: require('minecraft-data/minecraft-data/data/pc/1.21.6/tints.json'),
  version: require('minecraft-data/minecraft-data/data/pc/1.21.6/version.json'),
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
loadVersion.default = loadVersion;

module.exports = loadVersion;
