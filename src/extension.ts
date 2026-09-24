import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  ApiCatalog, ApiMethod, findLuaMembers, findLuaModules, findLuaModule, findMethod, findMethods, inferLuaModule, loadCatalog,
  parseLuaAccess
} from './catalog';
import { findCatalogPath } from './catalog-path';
import { renderApiContext } from './api-context';
import { findLuaSyntaxIssues } from './lua-syntax';
import { renderLuaStubs } from './lua-stubs';
import { inferPythonVariables, parsePythonStubs, preparePythonStubs, pythonMethods, PythonStubCatalog } from './multilang';
import { resolveCppSdk } from './cpp-sdk';

function escapeSnippetText(value: string): string {
  return value.replace(/[\\$}]/g, '\\$&');
}

export function methodSnippet(method: Pick<ApiMethod, 'name' | 'parameters'>): string {
  const parameters = method.parameters || [];
  if (!parameters.length) return `${method.name}()$0`;
  const placeholders = parameters.map((parameter, index) =>
    `\${${index + 1}:${escapeSnippetText(parameter.name)}}`);
  return `${method.name}(${placeholders.join(', ')})$0`;
}

function catalogPath(context: vscode.ExtensionContext): string {
  const configured = vscode.workspace.getConfiguration('aubo').get<string>('apiCatalogPath');
  const workspaceRoots = (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath);
  return findCatalogPath(
    configured,
    workspaceRoots,
    context.extensionPath,
    context.globalStorageUri.fsPath
  );
}

function readCatalog(context: vscode.ExtensionContext): ApiCatalog {
  const filename = catalogPath(context);
  try {
    return loadCatalog(fs.readFileSync(filename, 'utf8'));
  } catch (error) {
    vscode.window.showWarningMessage(`AUBO API catalog unavailable: ${String(error)}`);
    return loadCatalog('{"schemaVersion":1,"interfaceVersion":"empty","modules":[]}');
  }
}

function writeApiContext(catalog: ApiCatalog): void {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) return;
  try {
    const directory = path.join(folder, '.aubo');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'aubo-api-context.md'), renderApiContext(catalog), 'utf8');
  } catch {
    // Workspace may be read-only; completion remains available.
  }
}

function writeLuaStubs(catalog: ApiCatalog): void {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) return;
  try {
    const directory = path.join(folder, '.aubo', 'lua');
    for (const stub of renderLuaStubs(catalog)) {
      const filename = path.join(directory, stub.filename);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, stub.content, 'utf8');
    }
    const luaConfig = vscode.workspace.getConfiguration('Lua.workspace');
    const libraries = luaConfig.get<string[]>('library', []);
    if (luaConfig.update && !libraries.includes(directory)) {
      const update = luaConfig.update('library', [...libraries, directory], vscode.ConfigurationTarget.Workspace);
      void update.then(undefined, () => undefined);
    }
  } catch {
    // Workspace may be read-only; the bundled provider remains available.
  }
}

function configuredList(configuration: vscode.WorkspaceConfiguration, key: string): string[] {
  const value = configuration.get<string[]>(key, []);
  return Array.isArray(value) ? value : [];
}

function configureNativeBindings(context: vscode.ExtensionContext): PythonStubCatalog | undefined {
  const folders = vscode.workspace.workspaceFolders || [];
  const targets = folders.length
    ? folders.map((folder) => ({ root: folder.uri.fsPath, uri: folder.uri,
      target: vscode.ConfigurationTarget.WorkspaceFolder }))
    : [{ root: context.globalStorageUri.fsPath, uri: undefined,
      target: vscode.ConfigurationTarget.Global }];
  let pythonCatalog: PythonStubCatalog | undefined;
  for (const target of targets) {
    const auboConfig = vscode.workspace.getConfiguration('aubo', target.uri);
    const configuredStubPath = auboConfig.get<string>('pythonStubPath', '') || '';
    try {
      const stubs = preparePythonStubs(context.extensionPath, target.root, configuredStubPath);
      if (!pythonCatalog) {
        const stubFile = path.join(stubs.directory, 'pyaubo_sdk', '__init__.pyi');
        pythonCatalog = parsePythonStubs(fs.readFileSync(stubFile, 'utf8'));
      }
      const python = vscode.workspace.getConfiguration('python.analysis', target.uri);
      const paths = configuredList(python, 'extraPaths');
      if (python.update && !paths.includes(stubs.directory)) {
        void python.update('extraPaths', [...paths, stubs.directory], target.target)
          .then(undefined, () => undefined);
      }
    } catch (error) {
      vscode.window.showWarningMessage(`AUBO Python API metadata unavailable: ${String(error)}`);
    }
    const configuredSdkPath = auboConfig.get<string>('cppSdkPath', '') || '';
    if (!configuredSdkPath) continue;
    try {
      const sdk = resolveCppSdk(configuredSdkPath);
      const cpp = vscode.workspace.getConfiguration('C_Cpp.default', target.uri);
      const paths = configuredList(cpp, 'includePath');
      const merged = [...paths, ...sdk.includePaths.filter((item) => !paths.includes(item))];
      if (cpp.update && merged.length !== paths.length) {
        void cpp.update('includePath', merged, target.target)
          .then(undefined, () => undefined);
      }
    } catch (error) {
      vscode.window.showWarningMessage(`AUBO C++ SDK unavailable: ${String(error)}`);
    }
  }
  return pythonCatalog;
}

class PythonCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly catalog: PythonStubCatalog) {}

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
    const text = document.lineAt(position.line).text.slice(0, position.character);
    const access = text.match(/(?:^|[^A-Za-z0-9_])((?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*)\.([A-Za-z_]\w*)?$/);
    if (!access) return [];
    const receiver = access[1];
    const prefix = access[2] || '';
    if (receiver === 'pyaubo_sdk') {
      return Object.keys(this.catalog.classes)
        .filter((name) => name.toLowerCase().includes(prefix.toLowerCase()))
        .map((name) => new vscode.CompletionItem(name, vscode.CompletionItemKind.Class));
    }
    const variables = inferPythonVariables(document.getText(), this.catalog);
    const className = variables[receiver];
    if (!className) return [];
    return Object.values(pythonMethods(this.catalog, className))
      .filter((method) => method.name.toLowerCase().includes(prefix.toLowerCase()))
      .map((method) => {
        const item = new vscode.CompletionItem(method.name, vscode.CompletionItemKind.Method);
        item.detail = method.returnType ? `returns ${method.returnType}` : 'AUBO Python SDK method';
        item.insertText = new vscode.SnippetString(methodSnippet(method));
        return item;
      });
  }
}

class ApiCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly catalog: ApiCatalog) {}

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
    const text = document.lineAt(position.line).text.slice(0, position.character);
    const requireMatch = text.match(/require\s*\(\s*['"]([A-Za-z0-9_.]*)$/);
    if (requireMatch) {
      return findLuaModules(this.catalog, requireMatch[1]).map((module) => {
        const name = module.luaModule || module.name;
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
        item.detail = 'AUBO Lua module';
        return item;
      });
    }

    const access = parseLuaAccess(text);
    const moduleName = access.moduleName &&
      (findLuaModule(this.catalog, access.moduleName) ||
       inferLuaModule(this.catalog, document.getText(), access.receiver || access.moduleName))
      ?.name || access.moduleName;
    if (moduleName) {
      return findLuaMembers(this.catalog, moduleName, access.prefix).map((member) => {
        const item = new vscode.CompletionItem(
          member.name,
          member.method ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Field
        );
        item.detail = member.type ? `returns ${member.type}` : 'AUBO Lua member';
        item.documentation = member.description || '';
        item.insertText = member.method
          ? new vscode.SnippetString(methodSnippet(member.method)) : member.name;
        return item;
      });
    }

    return findMethods(this.catalog, access.prefix, 'lua').map((method) => {
      const item = new vscode.CompletionItem(method.name, vscode.CompletionItemKind.Method);
      item.detail = method.returnType ? `returns ${method.returnType}` : 'AUBO SDK method';
      item.documentation = method.description || '';
      item.insertText = new vscode.SnippetString(methodSnippet(method));
      return item;
    });
  }
}

function luaAccessAt(document: vscode.TextDocument, position: vscode.Position) {
  const word = document.getWordRangeAtPosition(position);
  const end = word ? word.end.character : position.character;
  return parseLuaAccess(document.lineAt(position.line).text.slice(0, end));
}

function resolveAccessModule(catalog: ApiCatalog, document: vscode.TextDocument,
  access: ReturnType<typeof parseLuaAccess>): string | undefined {
  if (!access.moduleName) return undefined;
  return (findLuaModule(catalog, access.moduleName) ||
    inferLuaModule(catalog, document.getText(), access.receiver || access.moduleName))?.name ||
    access.moduleName;
}

class ApiHoverProvider implements vscode.HoverProvider {
  constructor(private readonly catalog: ApiCatalog) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position) {
    const access = luaAccessAt(document, position);
    const method = findMethod(this.catalog, access.prefix, 'lua',
      resolveAccessModule(this.catalog, document, access));
    if (!method) return undefined;
    const parameters = (method.parameters || []).map((parameter) =>
      `${parameter.name}: ${parameter.type || 'any'}`).join(', ');
    const signature = `(${parameters})${method.returnType ? `: ${method.returnType}` : ''}`;
    return new vscode.Hover(new vscode.MarkdownString(`**${method.name}**${signature}\n\n${method.description || ''}`));
  }
}

class ApiSignatureProvider implements vscode.SignatureHelpProvider {
  constructor(private readonly catalog: ApiCatalog) {}

  provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position) {
    const text = document.lineAt(position.line).text.slice(0, position.character)
      .replace(/\([^()]*$/, '');
    const access = parseLuaAccess(text);
    const method = findMethod(this.catalog, access.prefix, 'lua',
      resolveAccessModule(this.catalog, document, access));
    if (!method) return undefined;
    const signature = new vscode.SignatureInformation(`${method.name}(${(method.parameters || [])
      .map((parameter) => `${parameter.name}: ${parameter.type || 'any'}`).join(', ')})`);
    signature.documentation = method.description || '';
    signature.parameters = (method.parameters || []).map((parameter) =>
      new vscode.ParameterInformation(parameter.name, parameter.description));
    const help = new vscode.SignatureHelp();
    help.signatures = [signature];
    help.activeSignature = 0;
    return help;
  }
}

function registerApiProviders(catalog: ApiCatalog, pythonCatalog?: PythonStubCatalog): vscode.Disposable[] {
  const selector: vscode.DocumentSelector = [
    { language: 'aubo-script', scheme: 'file' },
    { language: 'lua', scheme: 'file' }
  ];
  const registrations: vscode.Disposable[] = [
    vscode.languages.registerCompletionItemProvider(selector, new ApiCompletionProvider(catalog), '.', ':', '('),
    vscode.languages.registerHoverProvider(selector, new ApiHoverProvider(catalog)),
    vscode.languages.registerSignatureHelpProvider(selector, new ApiSignatureProvider(catalog), '(', ',')
  ];
  if (pythonCatalog) {
    registrations.push(vscode.languages.registerCompletionItemProvider(
      [{ language: 'python', scheme: 'file' }], new PythonCompletionProvider(pythonCatalog), '.'));
  }
  return registrations;
}

function catalogMethodCount(catalog: ApiCatalog): number {
  return catalog.modules.reduce((count, module) => count + module.methods.length, 0);
}

function updateSdkStatusBar(item: vscode.StatusBarItem, catalog: ApiCatalog): void {
  const version = catalog.sdkVersion || catalog.interfaceVersion;
  item.text = `AUBO SDK ${version}`;
  item.tooltip = `AUBO SDK version: ${version}\nInterface version: ${catalog.interfaceVersion}`;
}

function registerSyntaxDiagnostics(context: vscode.ExtensionContext): vscode.Disposable[] {
  if (!vscode.languages.createDiagnosticCollection || !vscode.workspace.onDidOpenTextDocument ||
      !vscode.workspace.onDidChangeTextDocument || !vscode.workspace.onDidCloseTextDocument) {
    return [];
  }
  const nativeLuaDiagnostics = Boolean(vscode.extensions?.getExtension('sumneko.lua'));
  const diagnostics = vscode.languages.createDiagnosticCollection('aubo-lua');
  const update = (document: vscode.TextDocument) => {
    if (document.languageId === 'lua' && nativeLuaDiagnostics) return;
    if (document.languageId !== 'lua' && document.languageId !== 'aubo-script') return;
    const source = document.getText();
    const entries = findLuaSyntaxIssues(source).map((issue) => {
      const before = source.slice(0, issue.offset);
      const line = before.split('\n').length - 1;
      const character = before.length - (before.lastIndexOf('\n') + 1);
      const start = new vscode.Position(line, character);
      return new vscode.Diagnostic(
        new vscode.Range(start, start.translate(0, Math.max(1, issue.length))),
        issue.message,
        vscode.DiagnosticSeverity.Error
      );
    });
    diagnostics.set(document.uri, entries);
  };
  vscode.workspace.textDocuments.forEach(update);
  const subscriptions = [
    diagnostics,
    vscode.workspace.onDidOpenTextDocument(update),
    vscode.workspace.onDidChangeTextDocument((event) => update(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri))
  ];
  context.subscriptions.push(...subscriptions);
  return subscriptions;
}

export function activate(context: vscode.ExtensionContext) {
  let catalog = readCatalog(context);
  writeApiContext(catalog);
  writeLuaStubs(catalog);
  let pythonCatalog = configureNativeBindings(context);
  let providerSubscriptions = registerApiProviders(catalog, pythonCatalog);
  const sdkStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  sdkStatusBar.name = 'AUBO SDK version';
  updateSdkStatusBar(sdkStatusBar, catalog);
  sdkStatusBar.show();
  context.subscriptions.push(
    ...registerSyntaxDiagnostics(context),
    sdkStatusBar,
    ...providerSubscriptions,
    ...(vscode.workspace.onDidChangeConfiguration ? [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('aubo') || event.affectsConfiguration('python.analysis') ||
            event.affectsConfiguration('C_Cpp.default')) configureNativeBindings(context);
      })
    ] : []),
    ...(vscode.workspace.onDidChangeWorkspaceFolders ? [
      vscode.workspace.onDidChangeWorkspaceFolders(() => configureNativeBindings(context))
    ] : []),
    vscode.commands.registerCommand('aubo.reloadApiCatalog', () => {
      const nextCatalog = readCatalog(context);
      providerSubscriptions.forEach((subscription) => subscription.dispose());
      catalog = nextCatalog;
      pythonCatalog = configureNativeBindings(context);
      providerSubscriptions = registerApiProviders(catalog, pythonCatalog);
      writeApiContext(catalog);
      writeLuaStubs(catalog);
      updateSdkStatusBar(sdkStatusBar, catalog);
      context.subscriptions.push(...providerSubscriptions);
      const validation = catalog.macroValidation ? 'macro validation passed' : 'macro validation unavailable';
      vscode.window.showInformationMessage(
        `AUBO API catalog reloaded: ${catalogMethodCount(catalog)} methods, ${validation}.`
      );
    }),
    vscode.commands.registerCommand('aubo.openApiCatalog', () => {
      vscode.commands.executeCommand('vscode.open', vscode.Uri.file(catalogPath(context)));
    }),
    vscode.commands.registerCommand('aubo.refreshAiContext', () => {
      writeApiContext(catalog);
      vscode.window.showInformationMessage('AUBO AI API context refreshed.');
    })
  );
}

export function deactivate() {}
