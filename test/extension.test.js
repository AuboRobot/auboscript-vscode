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
const bundledPython = path.join(root, 'api', 'python', 'pyaubo_sdk');
fs.mkdirSync(bundledPython, { recursive: true });
fs.copyFileSync(path.resolve(__dirname, '..', 'api/python/pyaubo_sdk/__init__.pyi'),
  path.join(bundledPython, '__init__.pyi'));

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
  ConfigurationTarget: { Global: 1, WorkspaceFolder: 3 },
  CompletionItemKind: { Class: 7, Method: 2 },
  CompletionItem: class {
    constructor(label, kind) { this.label = label; this.kind = kind; }
  },
  SnippetString: class {
    constructor(value) { this.value = value; }
  },
  workspace: { workspaceFolders: [], getConfiguration: () => ({ get: () => '' }) },
  window: {
    createStatusBarItem(alignment, priority) {
      const item = { ...disposable(), alignment, priority, visible: false,
        show() { this.visible = true; } };
      statusItems.push(item);
      return item;
    },
    showWarningMessage() {},
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
  assert.equal(providers.length, 4);
  for (const registration of providers.slice(0, 3)) {
    assert.ok(registration.selector.some((selector) => selector.language === 'lua'));
    assert.ok(registration.selector.some((selector) => selector.language === 'aubo-script'));
    assert.ok(!registration.selector.some((selector) => selector.language === 'cpp'));
  }
  const pythonProvider = providers.find((registration) =>
    registration.selector.some((selector) => selector.language === 'python'));
  const pythonDocument = {
    languageId: 'python',
    lineAt() { return { text: 'client.' }; },
    getText() {
      return 'client = pyaubo_sdk.RpcClient()\nclient.';
    }
  };
  const pythonItems = pythonProvider.provider.provideCompletionItems(pythonDocument,
    { line: 1, character: 7 });
  assert.ok(pythonItems.some((item) => item.label === 'getRobotInterface'),
    'Python provider must expose inherited SDK methods');

  writeCatalog('test-sdk-2');
  commands.get('aubo.reloadApiCatalog')();
  assert.equal(statusItems.length, 1, 'reload must reuse the status bar');
  assert.equal(item.text, 'AUBO SDK test-sdk-2');
  assert.match(item.tooltip, /test-sdk-2/);
  assert.ok(providers.slice(0, 4).every((provider) => provider.disposed));
  assert.equal(providers.length, 8);
  context.subscriptions.forEach((subscription) => subscription.dispose());
  assert.equal(item.disposed, true);
  assert.ok(providers.every((provider) => provider.disposed));
  console.log('extension status bar and Lua registration checks passed');
} finally {
  Module._load = originalLoad;
  fs.rmdirSync(root, { recursive: true });
}
