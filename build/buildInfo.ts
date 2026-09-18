import { execFileSync } from 'node:child_process'

/** Git情報はビルド時だけ取得し、利用者のブラウザでは外部へ問い合わせない。 */
export function getBuildInfo(cwd: string, readGit = (args: string[]) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
}).trim(), now = new Date()) {
  let revision: string | null = null
  let dirty: boolean | null = null
  try {
    const hash = readGit(['rev-parse', 'HEAD'])
    if (/^[a-f0-9]{40,64}$/i.test(hash)) {
      revision = hash.slice(0, 7)
      dirty = readGit(['status', '--porcelain', '--untracked-files=normal']).length > 0
    }
  } catch { /* ZIP展開などGitがない環境でもビルドを継続する。 */ }
  return { revision, dirty, builtAt: now.toISOString() }
}
