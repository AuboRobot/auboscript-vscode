const assert = require('assert').strict;
const { loadCatalog, inferLuaModule, findLuaMembers, parseLuaAccess } = require('../out/catalog');
const { renderLuaStubs } = require('../out/lua-stubs');
const { renderApiContext } = require('../out/api-context');
const { exportPublicCatalog } = require('../tools/export-public-catalog');
const { buildUpdatedCatalog } = require('../tools/update-catalog');
const bundledCatalog = loadCatalog(require('fs').readFileSync(require('path').join(__dirname, '..', 'api', 'catalog.json'), 'utf8'));

const source = {
  schemaVersion: 1, interfaceVersion: 'test',
  macroValidation: { status: 'passed', interfaceVersion: 'test' },
  modules: [{ name: 'AuboSdk', methods: [
    { name: 'getResult', parameters: [{ name: 'points', type: 'number[][]' }], returnType: 'Result' }
  ] }],
  types: [
    { name: 'Result', kind: 'record', fields: [{ name: 'items', type: 'Item[]' }, { name: 'index', type: 'number' }] },
    { name: 'Item', kind: 'record', fields: [{ name: 'position', type: 'number[]' }, { name: 'mode', type: 'Mode' }] },
    { name: 'Mode', kind: 'enum', values: [{ name: 'Ready', value: 0 }, { name: 'Stopped', value: 1 }] },
    { name: 'Results', kind: 'alias', alias: 'Result[]' }
  ]
};
const catalog = loadCatalog(JSON.stringify(source));
assert.deepEqual(catalog.types, source.types, 'loading must retain the complete public type graph');
assert.deepEqual(exportPublicCatalog(source).types, source.types);
assert.deepEqual(buildUpdatedCatalog(source).types, source.types);
const stubs = renderLuaStubs(catalog).map(file => file.content).join('\n');
assert.match(stubs, /---@class Result/);
assert.match(stubs, /---@field items Item\[\]/);
assert.match(stubs, /---@field index number/);
assert.match(stubs, /---@alias Mode 0\|1/);
assert.match(stubs, /---@alias Results Result\[\]/);
assert.match(stubs, /---@param points number\[\]\[\]/);
assert.match(stubs, /Mode\.Ready = 0/);
assert.match(renderApiContext(catalog), /items: Item\[\]/);
assert.equal(inferLuaModule(catalog, 'local result = getResult(points)\n', 'result.items[1]').name, 'Item');
assert.equal(inferLuaModule(catalog, '---@type Result\nlocal result = {}\n', 'result').name, 'Result');
assert.equal(findLuaMembers(catalog, 'Item', 'pos')[0].type, 'number[]');
assert.deepEqual(parseLuaAccess('result.items[1].po'), {
  moduleName: 'result.items[1]', receiver: 'result.items[1]', prefix: 'po'
});
for (const badType of [
  { name: 'Bad', kind: 'record', fields: [{ name: 'x', type: 'Unknown' }] },
  { name: 'Bad', kind: 'alias', alias: 'number\nfunction leak() end' },
  { name: 'Bad', kind: 'enum', values: [{ name: 'Nope', value: {} }] }
]) {
  assert.throws(() => loadCatalog(JSON.stringify({ ...source, types: [...source.types, badType] })), /type|field|alias|enum/i);
}
assert.throws(() => exportPublicCatalog({ ...source, types: [
  { name: 'Bad', kind: 'record', fields: [{ name: 'x', type: '/root/private' }] }
] }), /private|path-like/);
assert.ok(bundledCatalog.types.some((type) => type.name === 'SpiralParameters'));
assert.ok(bundledCatalog.types.some((type) => type.name === 'RuntimeState'));
assert.equal(findLuaMembers(bundledCatalog, 'RuntimeState', 'Run')[0].name, 'Running');
assert.match(renderLuaStubs(bundledCatalog).find((file) => file.filename === 'types/SpiralParameters.lua').content,
  /---@field frame number\[\]/);
assert.match(renderLuaStubs(bundledCatalog).find((file) => file.filename === '_aubo_globals.lua').content,
  /RuntimeState\.Running = nil/);
assert.equal(bundledCatalog.modules.find((module) => module.name === 'IoControl').methods
  .find((method) => method.name === 'getWorldZones').returnType, 'WorldZone[]');
assert.equal(bundledCatalog.modules.find((module) => module.name === 'MotionControl').methods
  .find((method) => method.name === 'moveSpiral').parameters[0].type, 'SpiralParameters');
assert.equal(inferLuaModule(bundledCatalog,
  'local zones = getWorldZones()\n', 'zones[1]').name, 'WorldZone');
assert.equal(inferLuaModule(bundledCatalog,
  'local state = RuntimeState.Running\n', 'state').name, 'RuntimeState');
console.log('public type round-trip, Lua fields, annotations and container checks passed');
