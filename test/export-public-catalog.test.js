const assert = require('assert').strict;
const { exportPublicCatalog } = require('../tools/export-public-catalog.js');

const output = exportPublicCatalog({
  schemaVersion: 1,
  interfaceVersion: 'test-sdk',
  sdkVersion: 'test-sdk',
  sdkCommit: 'private-commit',
  macroValidation: { status: 'passed', interfaceVersion: 'test-sdk', provider: 'private' },
  modules: [{
    name: 'MotionControl',
    luaGlobals: true,
    methods: [{ name: 'moveJoint', parameters: [{ name: 'q', type: 'JointTargets' }], bindings: ['lua', 'cpp'] }]
  }]
});

assert.deepEqual(Object.keys(output).sort(), ['interfaceVersion', 'macroValidation', 'modules', 'schemaVersion', 'sdkVersion']);
assert.equal(Object.prototype.hasOwnProperty.call(output.modules[0], 'luaGlobals'), false);
assert.deepEqual(output.modules[0].methods[0].bindings, ['lua']);
assert.equal(Object.prototype.hasOwnProperty.call(output.modules[0].methods[0], 'sdkCommit'), false);
assert.throws(() => exportPublicCatalog({
  schemaVersion: 1, interfaceVersion: 'x', modules: [{ name: 'M', methods: [{ name: '/root/private' }] }]
}), /private or path-like/);
console.log('public catalog export checks passed');
