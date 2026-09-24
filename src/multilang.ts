import * as fs from 'fs';
import * as path from 'path';

export interface PythonStubInfo {
  directory: string;
  sdkVersion?: string;
}

export interface PythonParameterInfo {
  name: string;
  type?: string;
}

export interface PythonMethodInfo {
  name: string;
  parameters: PythonParameterInfo[];
  returnType?: string;
}

export interface PythonClassInfo {
  name: string;
  base?: string;
  methods: Record<string, PythonMethodInfo>;
  properties: Record<string, string>;
}

export interface PythonStubCatalog {
  classes: Record<string, PythonClassInfo>;
}

function splitPythonParameters(source: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if ('[({'.includes(character)) depth += 1;
    else if ('])}'.includes(character)) depth = Math.max(0, depth - 1);
    else if (character === ',' && depth === 0) {
      result.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = source.slice(start).trim();
  if (last) result.push(last);
  return result;
}

function parsePythonParameters(source: string): PythonParameterInfo[] {
  return splitPythonParameters(source)
    .filter((parameter) => parameter && parameter !== '/')
    .map((parameter) => parameter.replace(/^\*+/, '').trim())
    .filter((parameter) => parameter !== 'self')
    .map((parameter, index) => {
      const withoutDefault = parameter.split('=')[0].trim();
      const separator = withoutDefault.indexOf(':');
      const name = separator < 0 ? withoutDefault : withoutDefault.slice(0, separator).trim();
      const type = separator < 0 ? undefined : withoutDefault.slice(separator + 1).trim();
      return { name: /^[A-Za-z_]\w*$/.test(name) ? name : `arg${index + 1}`, type };
    });
}

/** Parse only declarations from the public pyi artifact; no Python runtime is loaded. */
export function parsePythonStubs(source: string): PythonStubCatalog {
  const classes: Record<string, PythonClassInfo> = {};
  const lines = source.split(/\r?\n/);
  let current: PythonClassInfo | undefined;
  let propertyDecorator = false;
  for (const line of lines) {
    const classMatch = line.match(/^class\s+([A-Za-z_]\w*)(?:\(([^)]*)\))?:/);
    if (classMatch) {
      current = {
        name: classMatch[1],
        base: classMatch[2]?.split(',')[0].trim() || undefined,
        methods: {},
        properties: {}
      };
      classes[current.name] = current;
      propertyDecorator = false;
      continue;
    }
    if (!current) continue;
    if (/^\s*@property\s*$/.test(line)) {
      propertyDecorator = true;
      continue;
    }
    const propertyMatch = line.match(/^\s{4}([A-Za-z_]\w*):\s*(.+)$/);
    if (propertyMatch) {
      current.properties[propertyMatch[1]] = propertyMatch[2].trim();
      propertyDecorator = false;
      continue;
    }
    const methodMatch = line.match(/^\s+def\s+([A-Za-z_]\w*)\((.*)\)\s*(?:->\s*([^:]+))?:\s*$/);
    if (methodMatch) {
      const method = {
        name: methodMatch[1],
        parameters: parsePythonParameters(methodMatch[2]),
        returnType: methodMatch[3]?.trim()
      };
      if (propertyDecorator) current.properties[method.name] = method.returnType || 'typing.Any';
      else current.methods[method.name] = method;
      propertyDecorator = false;
      continue;
    }
    if (line.trim() && !/^\s*#/.test(line)) propertyDecorator = false;
  }
  return { classes };
}

export function pythonMethods(catalog: PythonStubCatalog, className: string,
  seen = new Set<string>()): Record<string, PythonMethodInfo> {
  const classInfo = catalog.classes[className];
  if (!classInfo || seen.has(className)) return {};
  seen.add(className);
  return {
    ...(classInfo.base ? pythonMethods(catalog, classInfo.base, seen) : {}),
    ...classInfo.methods
  };
}

export function pythonProperties(catalog: PythonStubCatalog, className: string,
  seen = new Set<string>()): Record<string, string> {
  const classInfo = catalog.classes[className];
  if (!classInfo || seen.has(className)) return {};
  seen.add(className);
  return {
    ...(classInfo.base ? pythonProperties(catalog, classInfo.base, seen) : {}),
    ...classInfo.properties
  };
}

function pythonTypeName(catalog: PythonStubCatalog, annotation?: string): string | undefined {
  if (!annotation) return undefined;
  let type = annotation.trim().replace(/^typing\./, '');
  while (/^(?:Optional|Union)\s*\[/.test(type)) {
    type = type.replace(/^(?:Optional|Union)\s*\[\s*/, '').replace(/\]\s*$/, '').split(',')[0].trim();
  }
  const direct = type.match(/^([A-Za-z_]\w*)$/)?.[1];
  if (direct && catalog.classes[direct]) return direct;
  const nested = type.match(/\[\s*([A-Za-z_]\w*)/);
  return nested && catalog.classes[nested[1]] ? nested[1] : undefined;
}

function pythonExpressionParts(expression: string): string[] | undefined {
  const source = expression.trim();
  if (!source) return undefined;
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if ('([{'.includes(character)) depth += 1;
    else if (')]}'.includes(character)) depth -= 1;
    else if (character === '.' && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts.every((part) => /^[A-Za-z_]\w*(?:\s*\([^()]*\))?$/.test(part)) ? parts : undefined;
}

/** Resolve a small, side-effect-free subset of Python expressions used by SDK access chains. */
export function pythonExpressionType(expression: string, variables: Record<string, string>,
  catalog: PythonStubCatalog): string | undefined {
  const constructor = expression.trim().match(/^pyaubo_sdk\.([A-Za-z_]\w*)\s*\(/);
  if (constructor && catalog.classes[constructor[1]]) return constructor[1];
  const parts = pythonExpressionParts(expression);
  if (!parts || !parts.length) return undefined;
  const first = parts.shift()!;
  let className = variables[first] || (catalog.classes[first] ? first : undefined);
  if (!className) return undefined;
  for (const part of parts) {
    const call = part.match(/^([A-Za-z_]\w*)\s*\(/);
    if (call) {
      className = pythonTypeName(catalog, pythonMethods(catalog, className)[call[1]]?.returnType);
    } else {
      className = pythonTypeName(catalog, pythonProperties(catalog, className)[part]);
    }
    if (!className) return undefined;
  }
  return className;
}

function pythonAssignmentExpression(source: string): Array<[string, string]> {
  return [...source.matchAll(/\b([A-Za-z_]\w*)\s*=\s*([^\n;#]+)/g)]
    .map((match) => [match[1], match[2].trim()]);
}

export function inferPythonVariables(source: string, catalog: PythonStubCatalog): Record<string, string> {
  const variables: Record<string, string> = {};
  for (let pass = 0; pass <= 5; pass += 1) {
    for (const [name, expression] of pythonAssignmentExpression(source)) {
      const className = pythonExpressionType(expression, variables, catalog);
      if (className) variables[name] = className;
    }
  }
  return variables;
}

/** Use SDK-exported Python signatures without translating Lua/C++ type names. */
export function preparePythonStubs(extensionPath: string, workspaceRoot: string,
  configuredPath = ''): PythonStubInfo {
  const source = configuredPath
    ? path.resolve(workspaceRoot, configuredPath)
    : path.join(extensionPath, 'api', 'python');
  const stub = path.join('pyaubo_sdk', '__init__.pyi');
  const filename = path.join(source, stub);
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    throw new Error(`AUBO Python stubs require ${filename}`);
  }
  const manifestPath = path.join(source, 'manifest.json');
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  const directory = configuredPath ? source : path.join(workspaceRoot, '.aubo', 'python');
  if (!configuredPath) {
    fs.mkdirSync(path.dirname(path.join(directory, stub)), { recursive: true });
    fs.copyFileSync(filename, path.join(directory, stub));
    if (fs.existsSync(manifestPath)) fs.copyFileSync(manifestPath, path.join(directory, 'manifest.json'));
  }
  return { directory, sdkVersion: typeof manifest.sdkVersion === 'string' ? manifest.sdkVersion : undefined };
}

/** Remove only previously added paths, preserving the user's original entries. */
export function mergeManagedPaths(existing: string[], previous: string[], desired: string[]):
  { paths: string[]; owned: string[] } {
  const paths = existing.filter((value) => !previous.includes(value));
  const owned: string[] = [];
  for (const value of desired) {
    if (!paths.includes(value)) {
      paths.push(value);
      owned.push(value);
    }
  }
  return { paths, owned };
}
