const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const native = require('../out/multilang.js');
const publicStub = fs.readFileSync(path.join(__dirname, '..', 'api', 'python', 'pyaubo_sdk', '__init__.pyi'), 'utf8');

const parsed = native.parsePythonStubs(publicStub);
assert.equal(Object.keys(parsed.classes).length, 59);
assert.equal(Object.keys(parsed.functions || {}).length, 2, 'module functions must not become methods of the last class');
assert.equal(Object.keys(parsed.constants || {}).length, 177);
assert.ok(parsed.exports.includes('RpcClient'));
assert.ok(parsed.exports.includes('errorCode2Str'));
assert.ok(parsed.exports.includes('AUBO_OK'));
assert.equal(parsed.classes.WorldZoneState.methods.errorCode2Str, undefined);
assert.equal(parsed.classes.WorldZoneState.properties.AUBO_OK, undefined);
assert.equal(parsed.classes.AuboErrorCodes.properties.AUBO_OK, 'typing.ClassVar[AuboErrorCodes]');
assert.equal(parsed.classes.OutputBuilder.methods.push.overloads.length, 5);
assert.equal(parsed.classes.ScriptWriter.methods.append.overloads.length, 2);
const allClasses = Object.values(parsed.classes);
assert.equal(allClasses.reduce((count, cls) => count + Object.keys(cls.properties).length, 0), 369,
  'all 323 declared fields/enum constants and 46 properties must survive parsing');
assert.equal(allClasses.reduce((count, cls) => count + Object.values(cls.methods)
  .reduce((sum, method) => sum + (method.overloads || [method]).length, 0), 0), 1066,
  'all method signatures, including overloads, must survive parsing');
assert.ok(parsed.classes.RpcClient);
assert.ok(parsed.classes.AuboApi.methods.getRobotInterface);
assert.equal(parsed.classes.AuboApi.methods.getRobotInterface.returnType, 'RobotInterface');
assert.equal(parsed.classes.RobotInterface.methods.getMotionControl.returnType, 'MotionControl');
assert.equal(parsed.classes.MotionControl.methods.moveJoint.parameters.length, 5);
assert.equal(parsed.classes.SafetyParams.properties.tcp_force, 'float');
assert.equal(parsed.classes.RobotSafetyParameterRange.properties.params, 'list[list[SafetyParams]]');
assert.equal(parsed.classes.ConveyorCalibResult.properties.error_code, 'int');
assert.deepEqual(native.pythonProperties(parsed, 'RobotSafetyParameterRange').params, 'list[list[SafetyParams]]');
assert.equal(native.pythonExpressionType(
  'robot.getRobotConfig()', { robot: 'RobotInterface' }, parsed), 'RobotConfig');
assert.equal(native.pythonExpressionType(
  'robot.getRobotConfig().getSafetyParametersCheckSum()', { robot: 'RobotInterface' }, parsed), undefined);
assert.deepEqual(native.inferPythonVariables(
  'client = pyaubo_sdk.RpcClient()\nrobot = client.getRobotInterface("rob1")\nmotion = robot.getMotionControl()\n', parsed
), { client: 'RpcClient', robot: 'RobotInterface', motion: 'MotionControl' });
assert.equal(native.pythonExpressionType('pyaubo_sdk.RpcClient().getRobotInterface("rob1").getMotionControl()', {}, parsed),
  'MotionControl', 'constructor chains must resolve the final receiver, not the constructor');
assert.equal(native.pythonExpressionType('range.params', { range: 'RobotSafetyParameterRange' }, parsed), 'list[list[SafetyParams]]');
assert.equal(native.pythonExpressionType('range.params[0]', { range: 'RobotSafetyParameterRange' }, parsed), 'list[SafetyParams]');
assert.equal(native.pythonExpressionType('range.params[0][0]', { range: 'RobotSafetyParameterRange' }, parsed), 'SafetyParams');
assert.equal(native.pythonExpressionType('range.params[0:1]', { range: 'RobotSafetyParameterRange' }, parsed), 'list[list[SafetyParams]]');
assert.deepEqual(native.pythonProperties(parsed, native.pythonExpressionType('range.params', { range: 'RobotSafetyParameterRange' }, parsed)), {},
  'a list must not expose the fields of its elements');
const imports = native.inferPythonVariables(`import pyaubo_sdk as sdk
from pyaubo_sdk import RpcClient as Client, SafetyParams
client = Client()
robot = sdk.RpcClient().getRobotInterface("rob1")
parameters: list[SafetyParams] = []
def edit(range: "sdk.RobotSafetyParameterRange", robot: sdk.RobotInterface):
    motion = robot.getMotionControl()
`, parsed);
assert.equal(native.pythonExpressionType('sdk.RpcClient().getRobotInterface("rob1")', imports, parsed), 'RobotInterface');
assert.equal(imports.client, 'RpcClient');
assert.equal(imports.motion, 'MotionControl');
assert.equal(imports.parameters, 'list[SafetyParams]');
assert.equal(native.pythonExpressionType('parameters[0]', imports, parsed), 'SafetyParams');
assert.equal(native.pythonExpressionType('range.params[0][0]', imports, parsed), 'SafetyParams');
const fixture = native.parsePythonStubs(`import typing
class Item:
    """A docstring containing text that resembles declarations:
    def not_a_method(self):
    """
    value: float = 0.0  # default
    @property
    def child(self) -> "Item": ...
    @child.setter
    def child(self, value: "Item") -> None: ...
    @typing.overload
    def choose(self, item: "Item", /) -> "Item": ...
    @typing.overload
    def choose(self, index: int, /, *, label: str = "a,b") -> list[Item]: ...
    def multiline(
        self,
        mapping: dict[str, tuple[int, Item]],
        callback: typing.Callable[[int, str], Item] = lambda x, y: None,
    ) -> list[Item]: ...
class Derived(Item):
    enabled: bool
def make_item() -> Item: ...
DEFAULT: Item  # public constant
`);
assert.equal(fixture.classes.Item.methods.not_a_method, undefined);
assert.equal(fixture.classes.Item.properties.child, '"Item"', 'setter must not replace getter return type');
assert.equal(fixture.classes.Item.methods.child, undefined);
assert.equal(fixture.classes.Item.properties.value, 'float');
assert.equal(fixture.classes.Item.methods.choose.overloads.length, 2);
assert.equal(fixture.classes.Item.methods.choose.overloads[0].parameters[0].kind, 'positional-only');
assert.equal(fixture.classes.Item.methods.choose.overloads[1].parameters[1].kind, 'keyword-only');
assert.equal(fixture.classes.Item.methods.choose.overloads[1].parameters[1].defaultValue, '"a,b"');
assert.equal(fixture.classes.Item.methods.multiline.parameters.length, 2);
assert.equal(fixture.constants.DEFAULT, 'Item');
assert.equal(fixture.classes.Derived.properties.DEFAULT, undefined);
assert.ok(fixture.functions.make_item);
assert.equal(native.pythonProperties(fixture, 'Derived').value, 'float');
assert.equal(native.pythonExpressionType('make_item().child', {}, fixture), 'Item');
assert.equal(native.pythonExpressionType('items["selected"]', { items: 'dict[str, Item]' }, fixture), 'Item');
assert.equal(native.pythonExpressionType('pair[1]', { pair: 'tuple[int, Item]' }, fixture), 'Item');

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
