const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');
const { loadCatalog } = require('../out/catalog.js');
const { renderLuaStubs } = require('../out/lua-stubs.js');
const { renderApiContext } = require('../out/api-context.js');
const Module = require('module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  return request === 'vscode' ? {} : originalLoad.call(this, request, parent, isMain);
};
const { methodSnippet } = require('../out/extension.js');
Module._load = originalLoad;

const root = path.resolve(__dirname, '..');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const localCatalog = path.join(root, 'api/catalog.local.json');
const catalog = loadCatalog(fs.existsSync(localCatalog)
  ? fs.readFileSync(localCatalog, 'utf8')
  : JSON.stringify({
    schemaVersion: 1,
    interfaceVersion: 'fixture',
    modules: [
      { name: 'AuboSdk', methods: [{ name: 'moveJoint', parameters: [{ name: 'q' }] }] },
      { name: 'Scheduler', luaModule: 'aubo.scheduler', methods: [{ name: 'select_robot', parameters: [{ name: 'index' }] }] }
    ]
  }));
const methods = catalog.modules.flatMap((module) => module.methods);
assert.ok(catalog.modules.length > 0, 'catalog must contain modules');
assert.ok(methods.length > 0, 'catalog must contain methods');

for (const method of methods) {
  const snippet = methodSnippet(method);
  assert.match(snippet, new RegExp(`^${escapeRegExp(method.name)}\\(`));
  const parameters = method.parameters || [];
  assert.equal((snippet.match(/\$\{\d+:/g) || []).length, parameters.length,
    `snippet parameter count mismatch for ${method.name}`);
  assert.ok(snippet.endsWith('$0'), `snippet must leave a final tab stop for ${method.name}`);
}

const stubs = new Map(renderLuaStubs(catalog).map((file) => [file.filename, file.content]));
for (const module of catalog.modules) {
  const filename = module.luaModule
    ? `${module.luaModule.split('.').join('/')}.lua`
    : `types/${module.name.replace(/[^A-Za-z0-9_]/g, '_')}.lua`;
  const content = stubs.get(filename);
  assert.ok(content, `missing LuaLS stub for ${module.name}`);
  for (const method of module.methods) {
    assert.match(content, new RegExp(`\\b${escapeRegExp(method.name)}\\(`),
      `missing stub method ${module.name}.${method.name}`);
  }
}

const context = renderApiContext(catalog);
for (const method of methods) {
  assert.match(context, new RegExp('`' + escapeRegExp(method.name) + '\\('),
    `missing AI context method ${method.name}`);
}

const files = execFileSync(process.execPath, [
  require.resolve('@vscode/vsce/vsce'), 'ls', '--no-dependencies'
], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/);
const packageFiles = files.filter((file) => file && !/[ >]/.test(file));
for (const filename of packageFiles) {
  assert.ok(!/(?:^|\/)(?:catalog\.local(?:\.[^/]*)?|common_interface|aubo_sdk|aubo_script|\.aubo)(?:\/|$)|\.map$/i.test(filename),
    `private/local artifact leaked into package: ${filename}`);
}
for (const filename of packageFiles.filter((file) => /^out\/.*\.js$/.test(file))) {
  const absolute = path.resolve(root, filename);
  for (const [, , dependency] of fs.readFileSync(absolute, 'utf8')
    .matchAll(/\brequire\s*\(\s*(['"])(\.[^'"]*)\1\s*\)/g)) {
    assert.ok(packageFiles.includes(path.relative(root, createRequire(absolute).resolve(dependency)).split(path.sep).join('/')),
      `${filename} has a missing packaged runtime dependency`);
  }
}

console.log(`full-flow checks passed (${catalog.modules.length} modules, ${methods.length} methods)`);
