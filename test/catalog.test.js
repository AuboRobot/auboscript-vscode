const assert = require('assert').strict;
const { findLuaMembers, findLuaModules, findMethod, findMethods, inferLuaModule, loadCatalog, parseLuaAccess } = require('../out/catalog.js');

const catalog = loadCatalog(JSON.stringify({
  schemaVersion: 1,
  interfaceVersion: 'private-build',
  sdkVersion: '8.0.0',
  sdkCommit: 'redacted',
  macroValidation: { status: 'passed', interfaceVersion: 'private-build' },
  modules: [{
    name: 'MotionControl',
    luaModule: 'aubo.motion',
    properties: [{ name: 'kind', type: 'MotionControl', description: 'Motion kind.' }],
    methods: [{
      name: 'moveJoint',
      parameters: [{ name: 'target', type: 'JointTargets' }],
      returnType: 'int',
      description: 'Move to a joint target.',
      bindings: ['lua']
    }]
  }]
}));

assert.equal(catalog.modules[0].methods[0].name, 'moveJoint');
assert.equal(catalog.modules[0].methods[0].bindings[0], 'lua');
assert.equal(catalog.macroValidation.status, 'passed');
assert.equal(catalog.sdkVersion, '8.0.0');
assert.equal(catalog.modules[0].luaModule, 'aubo.motion');
assert.equal(catalog.modules[0].properties[0].type, 'MotionControl');
assert.equal(catalog.modules[0].methods[0].name, 'moveJoint');
assert.equal(findMethods(catalog, '', 'javascript').length, 0);
assert.equal(findMethods(catalog, '', 'lua', 'MotionControl').length, 1);
assert.equal(findMethods(catalog, '', 'lua', 'MissingModule').length, 0);
assert.equal(findMethod(catalog, 'moveJoint', 'lua', 'MotionControl').name, 'moveJoint');
assert.equal(findMethod(catalog, 'moveJoint', 'lua', 'MissingModule'), undefined);
assert.equal(findLuaModules(catalog, 'aubo.motion').length, 1);
assert.equal(findLuaMembers(catalog, 'aubo.motion', 'kind')[0].name, 'kind');
assert.deepEqual(parseLuaAccess('aubo.motion:moveJ'), {
  moduleName: 'aubo.motion', receiver: 'aubo.motion', prefix: 'moveJ'
});
assert.deepEqual(parseLuaAccess('aubo.motion.'), {
  moduleName: 'aubo.motion', receiver: 'aubo.motion', prefix: ''
});
assert.deepEqual(parseLuaAccess('robot:getMotionControl():'), {
  moduleName: 'robot:getMotionControl()', receiver: 'robot:getMotionControl()', prefix: ''
});
const typedCatalog = loadCatalog(JSON.stringify({
  schemaVersion: 1, interfaceVersion: 'x', modules: [
    { name: 'AuboApi', methods: [{ name: 'getRobotInterface', returnType: 'RobotInterface' }] },
    { name: 'RobotInterface', methods: [{ name: 'getMotionControl', returnType: 'MotionControl' }] },
    { name: 'MotionControl', methods: [{ name: 'moveJoint' }] }
  ]
}));
assert.equal(inferLuaModule(typedCatalog,
  'local api = ...\nlocal robot = api:getRobotInterface(name)\nlocal motion = robot:getMotionControl()\n',
  'motion').name, 'MotionControl');
assert.equal(inferLuaModule(typedCatalog, 'local motion = robot:getMotionControl()\n', 'motion').name,
  'MotionControl');
assert.throws(() => loadCatalog('{"schemaVersion":1}'), /modules/);
assert.throws(() => loadCatalog(JSON.stringify({
  schemaVersion: 1,
  interfaceVersion: 'x',
  modules: [{ name: 'M', methods: [{ name: 'f', parameters: 'bad' }] }]
})), /parameters/);
assert.throws(() => loadCatalog(JSON.stringify({
  schemaVersion: 1,
  interfaceVersion: 'x',
  modules: [{ name: 'M', methods: [{ name: 'f', bindings: 'lua' }] }]
})), /bindings/);
assert.throws(() => loadCatalog(JSON.stringify({
  schemaVersion: 1,
  interfaceVersion: 'x',
  modules: [{ name: 'M', methods: [{ name: 'f', parameters: [{ name: 'p', type: 1 }] }] }]
})), /parameter/);
assert.throws(() => loadCatalog(JSON.stringify({
  schemaVersion: 1,
  interfaceVersion: 'x',
  macroValidation: { status: 'failed' },
  modules: []
})), /macro validation/);
assert.throws(() => loadCatalog(JSON.stringify({
  schemaVersion: 1,
  interfaceVersion: 'x',
  macroValidation: { status: 'passed', interfaceVersion: 'y' },
  modules: []
})), /interfaceVersion/);
assert.throws(() => loadCatalog(JSON.stringify({
  schemaVersion: 1,
  interfaceVersion: 'x',
  modules: [{ name: 'M', methods: [{ name: 'f' }, { name: 'f' }] }]
})), /duplicate/);
assert.throws(() => loadCatalog(JSON.stringify({
  schemaVersion: 1,
  interfaceVersion: 'x',
  sdkVersion: 1,
  modules: []
})), /sdkVersion/);
assert.throws(() => loadCatalog(JSON.stringify({
  schemaVersion: 1,
  interfaceVersion: 'x',
  modules: [{ name: 'M', methods: [], properties: [{ name: 'p', type: 'Missing' }] }]
})), /property.*module|target/i);
console.log('catalog checks passed');
