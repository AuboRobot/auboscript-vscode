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
  for (const line of lines) {
    const classMatch = line.match(/^class\s+([A-Za-z_]\w*)(?:\(([^)]*)\))?:/);
    if (classMatch) {
      current = {
        name: classMatch[1],
        base: classMatch[2]?.split(',')[0].trim() || undefined,
        methods: {}
      };
      classes[current.name] = current;
      continue;
    }
    if (!current) continue;
    const methodMatch = line.match(/^\s+def\s+([A-Za-z_]\w*)\((.*)\)\s*(?:->\s*([^:]+))?:\s*$/);
    if (!methodMatch) continue;
    current.methods[methodMatch[1]] = {
      name: methodMatch[1],
      parameters: parsePythonParameters(methodMatch[2]),
      returnType: methodMatch[3]?.trim()
    };
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

function pythonReturnType(catalog: PythonStubCatalog, className: string, methodName: string): string | undefined {
  return pythonMethods(catalog, className)[methodName]?.returnType
    ?.replace(/^typing\.(?:Optional|Union)\[(.*)\]$/, '$1')
    .split(',')[0].trim();
}

export function inferPythonVariables(source: string, catalog: PythonStubCatalog): Record<string, string> {
  const variables: Record<string, string> = {};
  for (let pass = 0; pass <= 3; pass += 1) {
    for (const match of source.matchAll(/\b([A-Za-z_]\w*)\s*=\s*(?:pyaubo_sdk\.)?([A-Za-z_]\w*)\s*\(/g)) {
      if (catalog.classes[match[2]]) variables[match[1]] = match[2];
    }
    for (const match of source.matchAll(/\b([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/g)) {
      const receiverType = variables[match[2]];
      const returnType = receiverType && pythonReturnType(catalog, receiverType, match[3]);
      if (returnType && catalog.classes[returnType]) variables[match[1]] = returnType;
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
