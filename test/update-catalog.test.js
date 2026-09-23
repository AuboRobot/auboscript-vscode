const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { updateCatalog } = require('../tools/update-catalog.js');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aubo-update-catalog-'));
}

function writeJson(filename, value) {
  fs.writeFileSync(filename, `${JSON.stringify(value)}\n`);
}

const dir = tempDir();
const input = path.join(dir, 'input.json');
const output = path.join(dir, 'catalog.json');

writeJson(input, {
  schemaVersion: 1,
  interfaceVersion: '2.1.0',
  sdkCommit: 'private-hash',
  validation: { status: 'passed', interfaceVersion: '2.1.0', provider: 'private-build' },
  modules: [{ name: 'AuboSdk', methods: [{ name: 'moveJoint', bindings: ['lua'] }] }]
});

const result = updateCatalog(input, output, { expectedInterfaceVersion: '2.1.0' });
assert.equal(result.interfaceVersion, '2.1.0');
assert.deepEqual(result.macroValidation, { status: 'passed', interfaceVersion: '2.1.0' });
assert.equal(Object.prototype.hasOwnProperty.call(result, 'validation'), false);
assert.equal(Object.prototype.hasOwnProperty.call(result, 'sdkCommit'), false);
assert.equal(Object.prototype.hasOwnProperty.call(result.macroValidation, 'provider'), false);
assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), result);

writeJson(input, {
  functions: ['moveJoint'],
  interfaceVersion: '2.1.0',
  macroValidation: { status: 'passed', interfaceVersion: '2.1.0' }
});
const functionCatalog = updateCatalog(input, output, {
  expectedInterfaceVersion: '2.1.0',
  binding: 'lua'
});
assert.deepEqual(functionCatalog.modules[0].methods[0], { name: 'moveJoint', bindings: ['lua'] });

const previous = fs.readFileSync(output, 'utf8');
writeJson(input, {
  schemaVersion: 1,
  interfaceVersion: '2.1.0',
  macroValidation: { status: 'failed' },
  modules: []
});
assert.throws(() => updateCatalog(input, output), /macroValidation.*passed/);
assert.equal(fs.readFileSync(output, 'utf8'), previous);

writeJson(input, {
  schemaVersion: 1,
  interfaceVersion: '2.0.0',
  macroValidation: { status: 'passed', interfaceVersion: '2.0.0' },
  modules: []
});
assert.throws(() => updateCatalog(input, output, { expectedInterfaceVersion: '2.1.0' }), /interfaceVersion/);
assert.equal(fs.readFileSync(output, 'utf8'), previous);

console.log('catalog updater checks passed');
