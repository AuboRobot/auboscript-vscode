const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aubo-extension-'));
const catalogFile = path.join(root, 'api', 'catalog.json');
fs.mkdirSync(path.dirname(catalogFile));
function writeCatalog(version) {
  fs.writeFileSync(catalogFile, JSON.stringify({
    schemaVersion: 1, interfaceVersion: version, modules: []
  }));
}
writeCatalog('test-sdk-1');

const commands = new Map();
const providers = [];
const statusItems = [];
function disposable() {
  return { disposed: false, dispose() { this.disposed = true; } };
}
function registerProvider(selector, provider, ...triggers) {
  const registration = { ...disposable(), selector, provider, triggers };
  providers.push(registration);
  return registration;
}
const vscode = {
  StatusBarAlignment: { Right: 2 },
  workspace: { workspaceFolders: [], getConfiguration: () => ({ get: () => '' }) },
  window: {
    createStatusBarItem(alignment, priority) {
      const item = { ...disposable(), alignment, priority, visible: false,
        show() { this.visible = true; } };
      statusItems.push(item);
      return item;
    },
    showWarningMessage(message) { assert.fail(message); },
    showInformationMessage() {}
  },
  languages: {
    registerCompletionItemProvider: registerProvider,
    registerHoverProvider: registerProvider,
    registerSignatureHelpProvider: registerProvider
  },
  commands: {
    registerCommand(name, callback) { commands.set(name, callback); return disposable(); }
  }
};
const context = {
  extensionPath: root, globalStorageUri: { fsPath: path.join(root, 'storage') }, subscriptions: []
};
const originalLoad = Module._load;
try {
  Module._load = function(request, parent, isMain) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
  };
  const extension = require('../out/extension.js');
  assert.equal(extension.methodSnippet({ name: 'moveJoint', parameters: [
    { name: 'q' }, { name: 'a' }, { name: 'v' }
  ] }), 'moveJoint(${1:q}, ${2:a}, ${3:v})$0');
  assert.equal(extension.methodSnippet({ name: 'stop' }), 'stop()$0');
  extension.activate(context);
  assert.equal(statusItems.length, 1);
  const item = statusItems[0];
  assert.equal(item.alignment, vscode.StatusBarAlignment.Right);
  assert.equal(item.text, 'AUBO SDK test-sdk-1');
  assert.match(item.tooltip, /test-sdk-1/);
  assert.equal(item.visible, true);
  assert.ok(context.subscriptions.includes(item), 'status bar must be disposed with the extension');
  assert.equal(providers.length, 3);
  for (const registration of providers) {
    assert.ok(registration.selector.some((selector) => selector.language === 'lua'));
    assert.ok(registration.selector.some((selector) => selector.language === 'aubo-script'));
  }

  writeCatalog('test-sdk-2');
  commands.get('aubo.reloadApiCatalog')();
  assert.equal(statusItems.length, 1, 'reload must reuse the status bar');
  assert.equal(item.text, 'AUBO SDK test-sdk-2');
  assert.match(item.tooltip, /test-sdk-2/);
  assert.ok(providers.slice(0, 3).every((provider) => provider.disposed));
  assert.equal(providers.length, 6);
  context.subscriptions.forEach((subscription) => subscription.dispose());
  assert.equal(item.disposed, true);
  assert.ok(providers.every((provider) => provider.disposed));
  console.log('extension status bar and Lua registration checks passed');
} finally {
  Module._load = originalLoad;
  fs.rmdirSync(root, { recursive: true });
}
