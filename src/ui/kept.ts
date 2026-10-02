/**
 * The folder of a path in the vault, ending in its slash. Undefined for
 * a file at the top of the vault, which has no folder to name.
 */
export function folderOf(path: string): string | undefined {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? undefined : path.slice(0, cut + 1);
}
