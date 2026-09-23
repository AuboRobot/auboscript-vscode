const assert = require('assert').strict;
const { buildCatalog } = require('../tools/generate-catalog.js');

const catalog = buildCatalog({
  functions: ['moveJoint', 'getRobotState', 'moveJoint'],
  interfaceVersion: '0.27.1',
  luaModule: 'aubo.motion',
  properties: [{ name: 'kind', type: 'AuboSdk' }]
});

assert.equal(catalog.interfaceVersion, '0.27.1');
assert.equal(catalog.sdkVersion, '0.27.1');
assert.equal(catalog.modules[0].luaModule, 'aubo.motion');
assert.deepEqual(catalog.modules[0].properties, [{ name: 'kind', type: 'AuboSdk' }]);
assert.deepEqual(catalog.modules[0].methods.map((method) => method.name), [
  'getRobotState', 'moveJoint'
]);
assert.deepEqual(catalog.modules[0].methods[0].bindings, ['javascript']);
assert.throws(() => buildCatalog({ functions: ['f'], interfaceVersion: 'local-sdk', sdkVersion: 'local-sdk' }), /sdkVersion/);
console.log('catalog generator checks passed');
