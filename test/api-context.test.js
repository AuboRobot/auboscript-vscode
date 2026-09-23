const assert = require('assert').strict;
const { renderApiContext } = require('../out/api-context.js');

const output = renderApiContext({
  schemaVersion: 1,
  interfaceVersion: 'test-interface',
  sdkVersion: 'test-sdk',
  modules: [{
    name: 'MotionControl',
    luaModule: 'aubo.motion',
    properties: [{ name: 'kind', type: 'string' }],
    methods: [{ name: 'moveJoint', parameters: [{ name: 'target', type: 'JointTargets' }] }]
  }]
});
assert.match(output, /require\('aubo'\)/);
assert.match(output, /aubo\.motion/);
assert.match(output, /moveJoint\(target: JointTargets\)/);
assert.match(output, /test-sdk/);
console.log('AI API context checks passed');
