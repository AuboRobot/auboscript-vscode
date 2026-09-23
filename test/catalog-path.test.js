const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findCatalogPath } = require('../out/catalog-path.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aubo-catalog-path-'));
const workspace = path.join(root, 'workspace');
const extension = path.join(root, 'extension');
fs.mkdirSync(path.join(workspace, 'api'), { recursive: true });
fs.mkdirSync(path.join(extension, 'api'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'api', 'catalog.local.json'), '{}');
fs.writeFileSync(path.join(extension, 'api', 'catalog.json'), '{}');

assert.equal(
  findCatalogPath('/explicit/catalog.json', [workspace], extension),
  '/explicit/catalog.json'
);
assert.equal(
  findCatalogPath('', [workspace], extension),
  path.join(workspace, 'api', 'catalog.local.json')
);
assert.equal(
  findCatalogPath('', [], extension),
  path.join(extension, 'api', 'catalog.json')
);
const storage = path.join(root, 'storage');
fs.mkdirSync(storage);
fs.writeFileSync(path.join(storage, 'catalog.json'), '{}');
assert.equal(findCatalogPath('', [], extension, storage), path.join(storage, 'catalog.json'));
assert.equal(findCatalogPath('', [workspace], extension, storage),
  path.join(workspace, 'api', 'catalog.local.json'));
assert.equal(findCatalogPath('/explicit/catalog.json', [], extension, storage), '/explicit/catalog.json');
console.log('catalog path checks passed');
