import * as fs from 'fs';
import * as path from 'path';

export interface PythonStubInfo {
  directory: string;
  sdkVersion?: string;
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
