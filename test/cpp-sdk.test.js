const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveCppSdk } = require('../out/cpp-sdk.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aubo-cpp-sdk-'));
const headers = ['aubo_sdk/rpc.h', 'aubo/robot/motion_control.h', 'aubo/global_config.h'];

function installHeaders(directory, filenames = headers) {
  for (const filename of filenames) {
    const target = path.join(directory, filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '// Test header\n');
  }
}

try {
  const prefix = path.join(root, 'SDK with spaces');
  const include = path.join(prefix, 'include');
  installHeaders(include);
  const expected = { includePaths: [include], compileFlags: [`-I${include}`] };
  assert.deepEqual(resolveCppSdk(prefix), expected);
  assert.deepEqual(resolveCppSdk(include), expected);
  assert.deepEqual(resolveCppSdk(`${prefix}${path.sep}`), expected);
  installHeaders(path.join(prefix, 'aubo_sdk-backup', 'include'));
  assert.deepEqual(resolveCppSdk(prefix), expected);

  const unpacked = path.join(root, 'unpacked');
  const nestedInclude = path.join(unpacked, 'aubo_sdk-1.2.3-Windows_AMD64', 'include');
  installHeaders(nestedInclude);
  assert.deepEqual(resolveCppSdk(unpacked), {
    includePaths: [nestedInclude], compileFlags: [`-I${nestedInclude}`]
  });

  assert.throws(() => resolveCppSdk(''), /SDK directory is not configured/);
  assert.throws(() => resolveCppSdk(undefined), /SDK directory is not configured/);
  assert.throws(() => resolveCppSdk(path.join(root, 'absent')), /does not exist/);
  assert.throws(() => resolveCppSdk(path.join(include, 'aubo_sdk', 'rpc.h')), /not a directory/);

  const incomplete = path.join(root, 'incomplete');
  installHeaders(path.join(incomplete, 'include'), ['aubo_sdk/rpc.h']);
  assert.throws(() => resolveCppSdk(incomplete), /aubo\/robot\/motion_control\.h/);
  installHeaders(path.join(incomplete, 'include'), ['aubo/robot/motion_control.h']);
  assert.throws(() => resolveCppSdk(incomplete), /aubo\/global_config\.h/);

  const fakeHeader = path.join(root, 'fake-header');
  installHeaders(fakeHeader, headers.slice(1));
  fs.mkdirSync(path.join(fakeHeader, 'aubo_sdk', 'rpc.h'), { recursive: true });
  assert.throws(() => resolveCppSdk(fakeHeader), /aubo_sdk\/rpc\.h/);

  const secondInclude = path.join(unpacked, 'aubo_sdk-2.0.0-Linux_x86_64', 'include');
  installHeaders(secondInclude);
  assert.throws(() => resolveCppSdk(unpacked), /Multiple AUBO SDK installations/);
  assert.deepEqual(resolveCppSdk(path.dirname(secondInclude)), {
    includePaths: [secondInclude], compileFlags: [`-I${secondInclude}`]
  });

  console.log('C++ SDK discovery checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
