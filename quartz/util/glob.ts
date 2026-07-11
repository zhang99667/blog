import path from "path"
import { FilePath } from "./path"
import { globby } from "globby"

export function toPosixPath(fp: string): string {
  return fp.split(path.sep).join("/")
}

export async function glob(
  pattern: string,
  cwd: string,
  ignorePatterns: string[],
  includeGitIgnored = process.env.QUARTZ_INCLUDE_GITIGNORED === "1",
): Promise<FilePath[]> {
  const fps = (
    await globby(pattern, {
      cwd,
      ignore: ignorePatterns,
      gitignore: !includeGitIgnored,
    })
  ).map(toPosixPath)
  return fps as FilePath[]
}
