import * as fs from 'fs';
import * as path from 'path';

/**
 * Include information for the native AUBO SDK.
 *
 * The extension only records include directories and compiler flags. It never
 * copies headers, libraries, or other SDK files into the extension package.
 */
export interface CppSdkInfo {
  includePaths: string[];
  compileFlags: string[];
}

const requiredHeaders = [
  'aubo_sdk/rpc.h',
  'aubo/robot/motion_control.h',
  'aubo/global_config.h'
];

function isDirectory(filename: string): boolean {
  try {
    return fs.statSync(filename).isDirectory();
  } catch {
    return false;
  }
}

function hasRequiredHeaders(includePath: string): boolean {
  return requiredHeaders.every((header) => {
    try {
      return fs.statSync(path.join(includePath, ...header.split('/'))).isFile();
    } catch {
      return false;
    }
  });
}

function missingHeaders(includePath: string): string[] {
  return requiredHeaders.filter((header) => {
    try {
      return !fs.statSync(path.join(includePath, ...header.split('/'))).isFile();
    } catch {
      return true;
    }
  });
}

function childDirectories(directory: string): string[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

function canonical(filename: string): string {
  // Keep the spelling supplied by the user. On Windows, realpathSync.native
  // can expand an 8.3 path (for example RUNNER~1) while path.resolve keeps
  // the workspace's configured spelling. Both paths refer to the same SDK,
  // but returning the configured form avoids unstable settings and tests.
  return path.resolve(filename);
}

/**
 * Resolve a locally installed AUBO SDK include directory.
 *
 * `sdkRoot` may be an SDK prefix, its `include` directory, or an unpacked
 * archive directory containing one SDK directory with an `include` child.
 * Discovery is intentionally shallow so an unrelated directory tree cannot
 * accidentally be selected as an SDK. A source checkout is accepted only if
 * it has the complete installed header set, including generated common
 * interface headers.
 */
export function resolveCppSdk(sdkRoot: string | undefined): CppSdkInfo {
  const configured = sdkRoot?.trim() || '';
  if (!configured) {
    throw new Error('AUBO C++ SDK directory is not configured');
  }

  const root = path.resolve(configured);
  let rootStat: fs.Stats;
  try {
    rootStat = fs.statSync(root);
  } catch {
    throw new Error(`AUBO C++ SDK directory does not exist: ${configured}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`AUBO C++ SDK path is not a directory: ${configured}`);
  }

  const candidates = new Set<string>();
  const addCandidate = (candidate: string): void => {
    if (isDirectory(candidate) && hasRequiredHeaders(candidate)) {
      candidates.add(canonical(candidate));
    }
  };

  // The configured path may itself be include/ or an SDK prefix.
  addCandidate(root);
  addCandidate(path.join(root, 'include'));

  // CPack archives and vendor installers commonly unpack to
  // <directory>/aubo_sdk-<version>-<platform>/include.
  if (candidates.size === 0) {
    for (const child of childDirectories(root)) {
      addCandidate(child);
      addCandidate(path.join(child, 'include'));
    }
  }

  if (candidates.size === 0) {
    const likelyInclude = isDirectory(path.join(root, 'include'))
      ? path.join(root, 'include')
      : root;
    const missing = missingHeaders(likelyInclude);
    throw new Error(
      `AUBO C++ SDK headers were not found under ${configured}; missing ${missing.join(', ')}`
    );
  }
  if (candidates.size > 1) {
    throw new Error(
      `Multiple AUBO SDK installations were found under ${configured}; configure one SDK directory`
    );
  }

  const includePath = [...candidates][0];
  return {
    includePaths: [includePath],
    compileFlags: [`-I${includePath}`]
  };
}
