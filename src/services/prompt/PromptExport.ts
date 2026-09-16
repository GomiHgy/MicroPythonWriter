import { hasSensitiveAssignments } from './RepairPromptBuilder'

export const PREPARATION_COPIED_MESSAGE = '準備文をコピーしたよ。好きなAIの新しい会話に貼り付けて送ってね'
export const PREPARATION_COPY_FAILED_MESSAGE = 'コピーできませんでした。「準備文の内容を見る」のテキスト欄を選択して、手動でコピーしてください。'
export const PREPARATION_COPY_TIMEOUT_MESSAGE = 'コピーの完了を確認できませんでした。「準備文の内容を見る」のテキスト欄を選択して、手動でコピーしてください。'
export const PREPARATION_COPY_TIMEOUT_MS = 10_000
type ExportResult = { ok: boolean; cancelled: boolean; message: string }
export type SensitiveConfirmation = (message: string) => boolean

export function allowPromptExport(text: string, confirmSensitive: SensitiveConfirmation = message => confirm(message)) {
  if (!text) return false
  if (!hasSensitiveAssignments(text)) return true
  return confirmSensitive('準備文にパスワードやAPIキーなどの秘密情報が含まれる可能性があります。「準備文の内容を見る」で内容を確認できます。外へ持ち出してよい内容ですか？\n検出は補助で、すべての秘密情報を見つけられるわけではありません。')
}

export async function copyPreparationPrompt(text: string, confirmSensitive?: SensitiveConfirmation, getClipboard: () => Pick<Clipboard, 'writeText'> | undefined = () => navigator.clipboard): Promise<ExportResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  try {
    if (!allowPromptExport(text, confirmSensitive)) return { ok: false, cancelled: true, message: 'コピーをキャンセルしました。準備文の内容を確認してください。' }
    const clipboard = getClipboard()
    if (!clipboard?.writeText) throw new Error('unsupported')
    const write = clipboard.writeText(text)
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { timedOut = true; reject(new Error('Clipboard completion timeout')) }, PREPARATION_COPY_TIMEOUT_MS)
    })
    await Promise.race([write, timeout])
    return { ok: true, cancelled: false, message: PREPARATION_COPIED_MESSAGE }
  } catch { return { ok: false, cancelled: false, message: timedOut ? PREPARATION_COPY_TIMEOUT_MESSAGE : PREPARATION_COPY_FAILED_MESSAGE } }
  finally { if (timer !== undefined) clearTimeout(timer) }
}

export function preparationFileName(kitId: string, revision: string) {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'unknown'
  return `NanoLED-${safe(kitId)}-${safe(revision)}-AI-preparation.txt`
}

export function downloadPreparationPrompt(text: string, kitId: string, revision: string, confirmSensitive?: SensitiveConfirmation): ExportResult {
  let url: string | undefined
  let anchor: HTMLAnchorElement | undefined
  try {
    if (!allowPromptExport(text, confirmSensitive)) return { ok: false, cancelled: true, message: 'ファイル保存をキャンセルしました。準備文の内容を確認してください。' }
    url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    anchor = document.createElement('a')
    anchor.href = url
    anchor.download = preparationFileName(kitId, revision)
    document.body.appendChild(anchor)
    anchor.click()
    return { ok: true, cancelled: false, message: '準備文のファイル保存を開始しました。ブラウザのダウンロードを確認してください。' }
  } catch { return { ok: false, cancelled: false, message: 'ファイルを保存できませんでした。準備文のテキスト欄から手動でコピーしてください。' } }
  finally {
    anchor?.remove()
    const createdUrl = url
    if (createdUrl) setTimeout(() => URL.revokeObjectURL(createdUrl), 0)
  }
}
