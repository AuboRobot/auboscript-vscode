const assert = require('assert').strict;
const { renderLuaStubs } = require('../out/lua-stubs.js');

const files = renderLuaStubs({
  schemaVersion: 1,
  interfaceVersion: 'x',
  modules: [
    { name: 'AuboSdk', methods: [{ name: 'moveJoint', parameters: [{ name: 'q', type: 'JointTargets' }] }] },
    { name: 'MotionControl', methods: [{ name: 'moveJoint', returnType: 'int' }] },
    { name: 'Aubo', luaModule: 'aubo', properties: [{ name: 'sched', type: 'Scheduler' }], methods: [] },
    { name: 'Scheduler', luaModule: 'aubo.scheduler', methods: [{ name: 'sync' }] }
  ]
});
assert.ok(files.some((file) => file.filename === 'aubo.lua' && /sched Scheduler/.test(file.content)));
assert.ok(files.some((file) => file.filename === 'aubo/scheduler.lua' && /function M\.sync/.test(file.content)));
assert.ok(files.some((file) => file.filename === 'types/MotionControl.lua' && /function MotionControl:moveJoint/.test(file.content)));
assert.ok(files.some((file) => file.filename === '_aubo_globals.lua' && /function moveJoint/.test(file.content)));
console.log('Lua stub checks passed');
