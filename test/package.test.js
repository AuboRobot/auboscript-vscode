const assert = require('assert').strict;
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
const files = execFileSync(process.execPath, [
  require.resolve('@vscode/vsce/vsce'), 'ls', '--no-dependencies'
], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' })
  .split(/\r?\n/).filter((file) => file && !/[ >]/.test(file)).sort();

for (const filename of files.filter((file) => /^out\/.*\.js$/.test(file))) {
  const absolute = path.resolve(__dirname, '..', filename);
  const source = fs.readFileSync(absolute, 'utf8');
  for (const [, , dependency] of source.matchAll(/\brequire\s*\(\s*(['"])(\.[^'"]*)\1\s*\)/g)) {
    const resolved = createRequire(absolute).resolve(dependency);
    const relative = path.relative(path.resolve(__dirname, '..'), resolved).split(path.sep).join('/');
    assert.ok(files.includes(relative), `${filename} requires ${relative}, which is missing from the VSIX`);
  }
}

const language = manifest.contributes.languages.find((entry) => entry.id === 'aubo-script');
assert.ok(language, 'AUBO Script language contribution is present');
assert.deepEqual(language.extensions || [], ['.lua'], 'AUBO Script supports standalone .lua files');
assert.ok(manifest.activationEvents.includes('onLanguage:lua'), 'extension activates for native Lua files');
assert.equal(manifest.contributes.configurationDefaults['Lua.completion.callSnippet'], 'Replace',
  'LuaLS call completion must insert parameter snippets');
const snippetLanguages = manifest.contributes.snippets.map((entry) => entry.language).sort();
assert.deepEqual(snippetLanguages, ['aubo-script', 'lua'], 'generic snippets are available for both languages');
const snippets = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'snippets/aubo-script.json'), 'utf8'));
assert.ok(snippets.function, 'generic function snippet is present');
assert.equal(snippets.moveJoint, undefined, 'snippets must not hard-code SDK methods');
const bundledCatalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'api/catalog.json'), 'utf8'));
assert.ok(bundledCatalog.modules.length > 0, 'bundled catalog must contain sanitized API metadata');
assert.equal(Object.prototype.hasOwnProperty.call(bundledCatalog, 'sdkCommit'), false,
  'bundled catalog must not contain source commit metadata');

assert.deepEqual(files, [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'api/catalog.json',
  'api/catalog.schema.json',
  'images/aubo_logo_2.png',
  'language-configuration.json',
  'out/catalog.js',
  'out/catalog-path.js',
  'out/api-context.js',
  'out/lua-syntax.js',
  'out/lua-stubs.js',
  'out/extension.js',
  'package.json',
  'snippets/aubo-script.json',
  'syntaxes/aubo-script.tmLanguage.json'
].sort(), 'VSIX must contain only public runtime files; exclude local catalogs and source maps');
console.log('package contents check passed');
