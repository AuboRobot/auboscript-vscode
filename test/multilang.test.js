const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const native = require('../out/multilang.js');
const publicStub = fs.readFileSync(path.join(__dirname, '..', 'api', 'python', 'pyaubo_sdk', '__init__.pyi'), 'utf8');

const parsed = native.parsePythonStubs(publicStub);
assert.ok(parsed.classes.RpcClient);
assert.ok(parsed.classes.AuboApi.methods.getRobotInterface);
assert.equal(parsed.classes.AuboApi.methods.getRobotInterface.returnType, 'RobotInterface');
assert.equal(parsed.classes.RobotInterface.methods.getMotionControl.returnType, 'MotionControl');
assert.equal(parsed.classes.MotionControl.methods.moveJoint.parameters.length, 5);
assert.deepEqual(native.inferPythonVariables(
  'client = pyaubo_sdk.RpcClient()\nrobot = client.getRobotInterface("rob1")\nmotion = robot.getMotionControl()\n', parsed
), { client: 'RpcClient', robot: 'RobotInterface', motion: 'MotionControl' });

assert.match(publicStub, /class RpcClient(?:\([^)]*\))?:/);
assert.match(publicStub, /def getRobotInterface\(self, arg0: str, \/\) -> RobotInterface/);
assert.match(publicStub, /class MotionControl:/);
assert.match(publicStub, /def moveJoint\(self, arg0: list\[float\], arg1: float, arg2: float, arg3: float, arg4: float, \/\) -> int/);
assert.ok(!/(common_interface|aubo_script|\/root\/|\/home\/|arcs::)/i.test(publicStub));

assert.equal(typeof native.preparePythonStubs, 'function', 'use canonical Python stubs, not converted Lua types');
assert.equal(typeof native.mergeManagedPaths, 'function');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aubo native support '));
try {
  const extension = path.join(root, 'extension');
  const workspace = path.join(root, 'workspace');
  const bundled = path.join(extension, 'api', 'python');
  fs.mkdirSync(path.join(bundled, 'pyaubo_sdk'), { recursive: true });
  fs.mkdirSync(workspace);
  const contents = 'class RpcClient:\n    def getRobotNames(self) -> list[str]: ...\n';
  fs.writeFileSync(path.join(bundled, 'pyaubo_sdk', '__init__.pyi'), contents);
  fs.writeFileSync(path.join(bundled, 'manifest.json'), JSON.stringify({ sdkVersion: '1.2.3' }));
  const prepared = native.preparePythonStubs(extension, workspace);
  assert.equal(prepared.directory, path.join(workspace, '.aubo', 'python'));
  assert.equal(prepared.sdkVersion, '1.2.3');
  assert.equal(fs.readFileSync(path.join(prepared.directory, 'pyaubo_sdk', '__init__.pyi'), 'utf8'), contents);
  assert.ok(!fs.existsSync(path.join(workspace, '.aubo', 'cpp')), 'C++ must use native SDK headers');

  const custom = path.join(workspace, 'SDK stubs');
  fs.mkdirSync(path.join(custom, 'pyaubo_sdk'), { recursive: true });
  fs.writeFileSync(path.join(custom, 'pyaubo_sdk', '__init__.pyi'), '# custom SDK metadata\n');
  const override = native.preparePythonStubs(extension, workspace, 'SDK stubs');
  assert.equal(override.directory, custom, 'explicit override wins and relative paths use workspace');
  assert.equal(override.sdkVersion, undefined, 'do not claim bundled SDK version for custom stubs');
  assert.throws(() => native.preparePythonStubs(extension, workspace, 'missing'), /__init__\.pyi/);
  assert.equal(fs.readFileSync(path.join(prepared.directory, 'pyaubo_sdk', '__init__.pyi'), 'utf8'), contents);

  const first = native.mergeManagedPaths(['user/path'], [], ['sdk/old']);
  assert.deepEqual(first, { paths: ['user/path', 'sdk/old'], owned: ['sdk/old'] });
  const next = native.mergeManagedPaths(first.paths, first.owned, ['sdk/new']);
  assert.deepEqual(next, { paths: ['user/path', 'sdk/new'], owned: ['sdk/new'] });
  assert.deepEqual(native.mergeManagedPaths(['sdk/new'], [], ['sdk/new']), { paths: ['sdk/new'], owned: [] },
    'preexisting user paths are never owned by this extension');
  assert.deepEqual(native.mergeManagedPaths(next.paths, next.owned, []), { paths: ['user/path'], owned: [] });
  console.log('native Python artifact and settings merge checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
