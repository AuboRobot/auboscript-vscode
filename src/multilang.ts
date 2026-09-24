import * as fs from 'fs';
import * as path from 'path';

export interface PythonStubInfo { directory: string; sdkVersion?: string; }
export interface PythonParameterInfo {
  name: string;
  type?: string;
  kind?: 'positional-only' | 'keyword-only' | 'var-positional' | 'var-keyword';
  defaultValue?: string;
}
export interface PythonMethodInfo {
  name: string;
  parameters: PythonParameterInfo[];
  returnType?: string;
  overloads?: PythonMethodInfo[];
  property?: boolean;
}
export interface PythonClassInfo {
  name: string;
  base?: string;
  methods: Record<string, PythonMethodInfo>;
  properties: Record<string, string>;
  constants: Record<string, string>;
}
export interface PythonStubCatalog {
  classes: Record<string, PythonClassInfo>;
  functions: Record<string, PythonMethodInfo>;
  constants: Record<string, string>;
  exports: string[];
  moduleAliases: Record<string, string>;
  classAliases: Record<string, string>;
}

function matchingClose(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === open) depth += 1;
    else if (character === close && --depth === 0) return index;
  }
  return source.length - 1;
}

function splitPythonParameters(source: string): string[] {
  const result: string[] = [];
  let start = 0; let depth = 0; let quote = '';
  let lambdaParameters = false; let lambdaColon = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if ('[({'.includes(character)) depth += 1;
    else if ('])}'.includes(character)) depth = Math.max(0, depth - 1);
    else if (character === '=' && depth === 0 && /^\s*lambda\b/.test(source.slice(index + 1))) {
      lambdaParameters = true;
      lambdaColon = false;
    } else if (character === ':' && depth === 0 && lambdaParameters) {
      lambdaColon = true;
    } else if (character === ',' && depth === 0 && (!lambdaParameters || lambdaColon)) {
      result.push(source.slice(start, index).trim());
      start = index + 1;
      lambdaParameters = false;
      lambdaColon = false;
    }
  }
  const last = source.slice(start).trim();
  if (last) result.push(last);
  return result;
}

function topLevelIndex(source: string, sought: string): number {
  let depth = 0; let quote = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if ('[({'.includes(character)) depth += 1;
    else if ('])}'.includes(character)) depth = Math.max(0, depth - 1);
    else if (character === sought && depth === 0) return index;
  }
  return -1;
}

function stripInlineComment(value: string): string {
  const index = topLevelIndex(value, '#');
  return (index < 0 ? value : value.slice(0, index)).trim();
}

function parsePythonParameters(source: string): PythonParameterInfo[] {
  const parameters: PythonParameterInfo[] = [];
  let positionalOnly = false; let keywordOnly = false;
  for (const raw of splitPythonParameters(source)) {
    const parameter = stripInlineComment(raw).trim();
    if (!parameter || parameter === '/') {
      if (parameter === '/') { for (const item of parameters) if (!item.kind) item.kind = 'positional-only'; positionalOnly = true; }
      continue;
    }
    if (parameter === '*') { keywordOnly = true; continue; }
    const marker = parameter.match(/^(\*{1,2})([A-Za-z_]\w*)/);
    const withoutMarker = marker ? parameter.slice(marker[1].length).trim() : parameter;
    const equals = topLevelIndex(withoutMarker, '=');
    const defaultValue = equals < 0 ? undefined : withoutMarker.slice(equals + 1).trim();
    const declaration = equals < 0 ? withoutMarker : withoutMarker.slice(0, equals).trim();
    const separator = topLevelIndex(declaration, ':');
    const name = (separator < 0 ? declaration : declaration.slice(0, separator)).trim();
    const type = separator < 0 ? undefined : declaration.slice(separator + 1).trim();
    if (!/^[A-Za-z_]\w*$/.test(name) || name === 'self' || name === 'cls') continue;
    const kind = marker?.[1] === '**' ? 'var-keyword' : marker?.[1] === '*' ? 'var-positional' : keywordOnly ? 'keyword-only' : positionalOnly ? 'positional-only' : undefined;
    parameters.push({ name, type, ...(kind ? { kind } : {}), ...(defaultValue !== undefined ? { defaultValue } : {}) });
  }
  return parameters;
}

function functionHeader(lines: string[], first: number): { header: string; next: number } | undefined {
  const initial = lines[first].trim();
  if (!/^(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(/.test(initial)) return undefined;
  let header = initial; let balance = 0; let quote = '';
  for (let line = first; line < lines.length; line += 1) {
    if (line > first) header += ` ${lines[line].trim()}`;
    const text = lines[line];
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quote) { if (character === '\\') index += 1; else if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '(') balance += 1;
      else if (character === ')') balance -= 1;
    }
    if (balance <= 0 && /:\s*(?:\.\.\.|pass)?\s*(?:#.*)?$/.test(header)) return { header, next: line };
  }
  return undefined;
}

function parseFunctionHeader(header: string): PythonMethodInfo | undefined {
  const match = header.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\((.*)\)\s*(?:->\s*(.*?))?:\s*(?:\.\.\.|pass)?\s*(?:#.*)?$/);
  if (!match) return undefined;
  return { name: match[1], parameters: parsePythonParameters(match[2]), returnType: match[3]?.trim() || undefined };
}

function addMethod(target: Record<string, PythonMethodInfo>, method: PythonMethodInfo): void {
  const previous = target[method.name];
  if (!previous) { target[method.name] = method; return; }
  const overloads = previous.overloads ? [...previous.overloads] : [previous];
  overloads.push(method);
  target[method.name] = { ...previous, overloads };
}

function parseExports(source: string): string[] {
  const match = source.match(/__all__\s*:[^=]*=\s*([\s\S]*?)(?:\n\s*\n|$)/);
  return match ? [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]) : [];
}

function annotationType(value: string): string { return stripInlineComment(value).replace(/^['"]|['"]$/g, '').trim(); }

/** Parse declarations from the public pyi artifact; no Python runtime is loaded. */
export function parsePythonStubs(source: string): PythonStubCatalog {
  const classes: Record<string, PythonClassInfo> = {};
  const functions: Record<string, PythonMethodInfo> = {};
  const constants: Record<string, string> = {};
  const moduleAliases: Record<string, string> = {};
  const classAliases: Record<string, string> = {};
  const lines = source.split(/\r?\n/);
  let current: PythonClassInfo | undefined; let pendingProperty = false; let pendingSetter = false; let tripleQuote = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]; const trimmed = line.trim();
    const triples = line.match(/('{3}|"{3})/g) || [];
    if (tripleQuote) { if (triples.some((match) => match === tripleQuote) && triples.length % 2 === 1) tripleQuote = ''; continue; }
    if (triples.length % 2 === 1) { tripleQuote = triples[0] || "'''"; continue; }
    const importMatch = trimmed.match(/^import\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(?:\s+as\s+([A-Za-z_]\w*))?/);
    if (importMatch) { const imported = importMatch[1]; moduleAliases[importMatch[2] || imported.split('.')[0]] = imported; continue; }
    const fromMatch = trimmed.match(/^from\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import\s+(.+)/);
    if (fromMatch) {
      for (const item of fromMatch[2].split(',')) { const match = item.trim().match(/^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?/); if (match && fromMatch[1] === 'pyaubo_sdk') classAliases[match[2] || match[1]] = match[1]; }
      continue;
    }
    const classMatch = line.match(/^(\s*)class\s+([A-Za-z_]\w*)(?:\(([^)]*)\))?:/);
    if (classMatch && classMatch[1].length === 0) {
      const base = classMatch[3]?.split(',')[0].trim(); current = { name: classMatch[2], base, methods: {}, properties: {}, constants: {} }; classes[current.name] = current; pendingProperty = false; pendingSetter = false; continue;
    }
    if (/^\s*@property\s*$/.test(line)) { pendingProperty = true; continue; }
    if (/^\s*@[^\s.]+\.setter\s*$/.test(line)) { pendingSetter = true; continue; }
    if (/^\s*@/.test(line)) continue;
    const header = functionHeader(lines, index);
    if (header) {
      const method = parseFunctionHeader(header.header);
      if (method) {
        if (current && line.startsWith('    ')) {
          if (pendingProperty) { current.properties[method.name] = method.returnType || 'typing.Any'; current.constants[method.name] = current.properties[method.name]; }
          else if (!pendingSetter) addMethod(current.methods, method);
        } else addMethod(functions, method);
      }
      pendingProperty = false; pendingSetter = false; index = header.next; continue;
    }
    const annotation = line.match(/^(\s*)([A-Za-z_]\w*)\s*:\s*(.+)$/);
    if (annotation) {
      const name = annotation[2];
      const declaration = stripInlineComment(annotation[3]);
      const equals = topLevelIndex(declaration, '=');
      const type = annotationType(equals < 0 ? declaration : declaration.slice(0, equals));
      if (annotation[1].length === 4 && current) { current.properties[name] = type; current.constants[name] = type; }
      else if (annotation[1].length === 0 && name !== '__all__') constants[name] = type;
      continue;
    }
    if (trimmed && !/^#/.test(trimmed)) { pendingProperty = false; pendingSetter = false; }
  }
  return { classes, functions, constants, exports: parseExports(source), moduleAliases, classAliases };
}

function inherited(catalog: PythonStubCatalog, className: string, selector: (info: PythonClassInfo) => Record<string, any>, seen = new Set<string>()): Record<string, any> {
  const classInfo = catalog.classes[className]; if (!classInfo || seen.has(className)) return {}; seen.add(className);
  return { ...(classInfo.base ? inherited(catalog, classInfo.base, selector, seen) : {}), ...selector(classInfo) };
}
export function pythonMethods(catalog: PythonStubCatalog, className: string, seen = new Set<string>()): Record<string, PythonMethodInfo> { return inherited(catalog, className, (info) => info.methods, seen) as Record<string, PythonMethodInfo>; }
export function pythonProperties(catalog: PythonStubCatalog, className: string, seen = new Set<string>()): Record<string, string> { return inherited(catalog, className, (info) => info.properties, seen) as Record<string, string>; }

function normalizeType(annotation?: string): string | undefined {
  if (!annotation) return undefined;
  let type = annotation.trim().replace(/^['"]|['"]$/g, '').replace(/^typing\./, '');
  type = type.replace(/\bpyaubo_sdk\./g, '').replace(/\bsdk\./g, '');
  return type || undefined;
}
function outerType(type: string): { name: string; args: string[] } | undefined {
  const match = type.match(/^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s*\[/); if (!match) return undefined;
  const start = match[0].length - 1; const end = matchingClose(type, start, '[', ']'); if (end !== type.length - 1) return undefined;
  return { name: match[1], args: splitPythonParameters(type.slice(start + 1, end)) };
}
function navigableType(catalog: PythonStubCatalog, type?: string): string | undefined {
  const normalized = normalizeType(type); if (!normalized) return undefined;
  if (catalog.classes[normalized]) return normalized;
  const outer = outerType(normalized);
  return outer && ['list', 'dict', 'tuple', 'set', 'Sequence', 'Mapping', 'Iterable', 'Optional', 'Union'].includes(outer.name) ? normalized : undefined;
}
function indexType(type: string, index: string): string | undefined {
  const normalized = normalizeType(type); if (!normalized) return undefined;
  if (index.includes(':')) return normalized;
  const outer = outerType(normalized); if (!outer) return undefined;
  if (outer.name === 'list' || outer.name === 'set' || ['Sequence', 'Iterable'].includes(outer.name)) return outer.args[0];
  if (outer.name === 'dict' || outer.name === 'Mapping') return outer.args[1];
  if (outer.name === 'tuple') { const numeric = Number(index.trim()); return Number.isInteger(numeric) ? outer.args[numeric] : undefined; }
  return undefined;
}
interface PythonValue { kind: 'module' | 'class' | 'callable' | 'type'; type?: string; }
function expressionOperations(expression: string): { root: string; operations: Array<{ kind: 'member' | 'call' | 'index'; value?: string }> } | undefined {
  const source = expression.trim(); const rootMatch = source.match(/^([A-Za-z_]\w*)/); if (!rootMatch) return undefined;
  let index = rootMatch[0].length; const operations: Array<{ kind: 'member' | 'call' | 'index'; value?: string }> = [];
  while (index < source.length) {
    while (/\s/.test(source[index])) index += 1;
    if (source[index] === '.') { index += 1; while (/\s/.test(source[index])) index += 1; const member = source.slice(index).match(/^[A-Za-z_]\w*/); if (!member) return undefined; operations.push({ kind: 'member', value: member[0] }); index += member[0].length; }
    else if (source[index] === '(') { const end = matchingClose(source, index, '(', ')'); operations.push({ kind: 'call', value: source.slice(index + 1, end) }); index = end + 1; }
    else if (source[index] === '[') { const end = matchingClose(source, index, '[', ']'); operations.push({ kind: 'index', value: source.slice(index + 1, end).trim() }); index = end + 1; }
    else return undefined;
  }
  return { root: rootMatch[1], operations };
}
function methodReturn(catalog: PythonStubCatalog, className: string, member: string): string | undefined { return pythonMethods(catalog, className)[member]?.returnType; }
function resolveRoot(catalog: PythonStubCatalog, name: string, variables: Record<string, string>): PythonValue | undefined {
  const importedModule = variables[name]?.match(/^module:(.+)$/);
  if (importedModule) return { kind: 'module', type: importedModule[1] };
  const moduleName = catalog.moduleAliases[name] || (name === 'pyaubo_sdk' ? name : undefined); if (moduleName) return { kind: 'module', type: moduleName };
  const className = catalog.classAliases[name] || (catalog.classes[name] ? name : undefined); if (className) return { kind: 'class', type: className };
  if (catalog.functions[name]) return { kind: 'callable', type: catalog.functions[name].returnType };
  const variable = variables[name];
  if (!variable) return undefined;
  const importedFunction = variable.match(/^function:(.+)$/);
  if (importedFunction && catalog.functions[importedFunction[1]]) {
    return { kind: 'callable', type: catalog.functions[importedFunction[1]].returnType };
  }
  if (catalog.classes[variable]) return { kind: 'class', type: variable };
  return { kind: 'type', type: variable };
}
/** Resolve side-effect-free SDK expressions, including member calls and container indexing. */
export function pythonExpressionType(expression: string, variables: Record<string, string>, catalog: PythonStubCatalog): string | undefined {
  const parsed = expressionOperations(expression); if (!parsed) return undefined; let value = resolveRoot(catalog, parsed.root, variables); if (!value) return undefined;
  for (const operation of parsed.operations) {
    if (operation.kind === 'member') {
      if (value.kind === 'module') {
        if (catalog.classes[operation.value!]) value = { kind: 'class', type: operation.value };
        else if (catalog.functions[operation.value!]) value = { kind: 'callable', type: catalog.functions[operation.value!].returnType };
        else if (catalog.constants[operation.value!]) value = { kind: 'type', type: catalog.constants[operation.value!] };
        else return undefined;
      } else if (value.type && catalog.classes[value.type]) {
        const method = methodReturn(catalog, value.type, operation.value!); const property: string | undefined = pythonProperties(catalog, value.type)[operation.value!];
        if (method !== undefined) value = { kind: 'callable', type: method }; else if (property !== undefined) value = { kind: 'type', type: property }; else return undefined;
      } else return undefined;
    } else if (operation.kind === 'call') {
      if (value.kind === 'class' && value.type) value = { kind: 'type', type: value.type }; else if (value.kind === 'callable') value = { kind: 'type', type: value.type }; else return undefined;
    } else {
      if (!value.type) return undefined; const indexed = indexType(value.type, operation.value || ''); if (!indexed) return undefined; value = { kind: 'type', type: indexed };
    }
  }
  return navigableType(catalog, value.type);
}
function annotationForVariable(annotation: string, catalog: PythonStubCatalog): string | undefined {
  const normalized = normalizeType(annotation); if (!normalized) return undefined; const outer = outerType(normalized); if (outer) return normalized; return catalog.classAliases[normalized] || normalized;
}
function pythonAssignmentExpression(source: string): Array<[string, string]> {
  return [...source.matchAll(/\b([A-Za-z_]\w*)\s*(?::\s*([^=\n;]+))?=\s*([^\n;#]+)/g)].map((match) => [match[1], match[2] ? match[2].trim() : match[3].trim()]);
}
export function inferPythonVariables(source: string, catalog: PythonStubCatalog): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const match of source.matchAll(/^\s*import\s+pyaubo_sdk(?:\s+as\s+([A-Za-z_]\w*))?/gm)) {
    variables[match[1] || 'pyaubo_sdk'] = 'module:pyaubo_sdk';
  }
  for (const match of source.matchAll(/^\s*from\s+pyaubo_sdk\s+import\s+([^\n]+)/gm)) {
    for (const item of match[1].split(',')) {
      const parts = item.trim().match(/^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?/);
      if (!parts) continue;
      const name = parts[1]; const alias = parts[2] || name;
      if (catalog.classes[name]) variables[alias] = name;
      else if (catalog.functions[name]) variables[alias] = `function:${name}`;
      else if (catalog.constants[name]) variables[alias] = catalog.constants[name];
    }
  }
  for (const match of source.matchAll(/(?:^|\n)\s*(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(([\s\S]*?)\)\s*(?:->[^:]+)?\s*:/g)) {
    for (const parameter of parsePythonParameters(match[1])) {
      if (parameter.type) {
        const type = annotationForVariable(parameter.type, catalog);
        if (type) variables[parameter.name] = type;
      }
    }
  }
  for (const match of source.matchAll(/\b([A-Za-z_]\w*)\s*:\s*([^=\n;]+)\s*(?:=|$)/g)) { const type = annotationForVariable(match[2], catalog); if (type) variables[match[1]] = type; }
  for (let pass = 0; pass <= 5; pass += 1) for (const [name, expression] of pythonAssignmentExpression(source)) { const className = pythonExpressionType(expression, variables, catalog); if (className) variables[name] = className; }
  return variables;
}

/** Use SDK-exported Python signatures without translating Lua/C++ type names. */
export function preparePythonStubs(extensionPath: string, workspaceRoot: string, configuredPath = ''): PythonStubInfo {
  const source = configuredPath ? path.resolve(workspaceRoot, configuredPath) : path.join(extensionPath, 'api', 'python'); const stub = path.join('pyaubo_sdk', '__init__.pyi'); const filename = path.join(source, stub);
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) throw new Error(`AUBO Python stubs require ${filename}`);
  const manifestPath = path.join(source, 'manifest.json'); const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {}; const directory = configuredPath ? source : path.join(workspaceRoot, '.aubo', 'python');
  if (!configuredPath) { fs.mkdirSync(path.dirname(path.join(directory, stub)), { recursive: true }); fs.copyFileSync(filename, path.join(directory, stub)); if (fs.existsSync(manifestPath)) fs.copyFileSync(manifestPath, path.join(directory, 'manifest.json')); }
  return { directory, sdkVersion: typeof manifest.sdkVersion === 'string' ? manifest.sdkVersion : undefined };
}
/** Remove only previously added paths, preserving the user's original entries. */
export function mergeManagedPaths(existing: string[], previous: string[], desired: string[]): { paths: string[]; owned: string[] } {
  const paths = existing.filter((value) => !previous.includes(value)); const owned: string[] = []; for (const value of desired) if (!paths.includes(value)) { paths.push(value); owned.push(value); } return { paths, owned };
}
