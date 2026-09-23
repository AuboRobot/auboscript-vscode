import * as fs from 'fs';
import * as path from 'path';

export function findCatalogPath(
  configured: string | undefined,
  workspaceRoots: string[],
  extensionPath: string,
  storagePath?: string
): string {
  const explicit = configured?.trim();
  if (explicit) return explicit;

  const localCandidates = workspaceRoots.flatMap((root) => [
    path.join(root, 'api', 'catalog.local.json'),
    path.join(root, 'catalog.local.json')
  ]);
  const local = localCandidates.find((filename) => fs.existsSync(filename));
  if (local) return local;

  const storedCandidates = storagePath
    ? [path.join(storagePath, 'catalog.json'), path.join(storagePath, 'catalog.local.json')]
    : [];
  return storedCandidates.find((filename) => fs.existsSync(filename))
    || path.join(extensionPath, 'api', 'catalog.json');
}
