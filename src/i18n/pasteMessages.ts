import type { MessageCatalog } from './types'

export const pasteMessages: MessageCatalog = {
  'コピーしたテキストをペースト': { en: 'Paste copied text', zh: '粘贴复制的文本' },
  'コピーしたテキストを読み取り中…': { en: 'Reading copied text…', zh: '正在读取复制的文本…' },
  '貼り付け前に戻す': { en: 'Undo this paste', zh: '恢复粘贴前的代码' },
  'コードの確認について': { en: 'About code checking', zh: '关于代码检查' },
  '手動で貼り付けるには、下のコード欄で全選択して貼り付けます（PC: Ctrl+A → Ctrl+V、Mac: ⌘A → ⌘V）。': { en: 'To paste manually, select all text in the code editor below and paste (PC: Ctrl+A → Ctrl+V; Mac: ⌘A → ⌘V).', zh: '手动粘贴时，请在下方代码编辑区全选并粘贴（PC：Ctrl+A → Ctrl+V；Mac：⌘A → ⌘V）。' },
  'コピーしたPythonコードで、下の内容をすべて置き換えます。機器への書き込み・実行はしません。': { en: 'Replace all code below with the Python code you copied. This does not write to a device or run the code.', zh: '使用复制的Python代码替换下方全部内容。不会写入设备或运行代码。' },
  'コードの判定は、安全性や実機での動作を保証するものではありません。内容が分からないコードは実行しないでください。': { en: 'Code detection does not guarantee safety or correct operation on your device. Do not run code you do not understand.', zh: '代码识别不保证安全性或实机上的正确运行。请勿运行您不理解的代码。' },
  'このブラウザーではボタンから貼り付けできません。下のコード欄を選んで、通常の貼り付けを使ってください。': { en: 'This browser cannot paste using this button. Select the code editor below and use the usual paste command.', zh: '此浏览器无法通过按钮粘贴。请选择下方代码编辑区，使用常规粘贴操作。' },
  'コピーしたテキストが空です。Pythonコードをコピーしてから、もう一度押してください。': { en: 'The clipboard is empty. Copy your Python code, then press the button again.', zh: '剪贴板为空。请先复制Python代码，再次点击按钮。' },
  'Pythonコードとして確認できませんでした。AIの説明文ではなく、コード全体をコピーしてください。今のコードは変更していません。': { en: 'The text could not be recognized as Python code. Copy the complete code rather than the AI explanation. Your current code has not been changed.', zh: '无法识别为Python代码。请复制完整代码，而非AI的说明文字。当前代码未被修改。' },
  '複数のコードや未完了のコード枠が含まれています。使いたいPythonコードを1つだけコピーしてください。今のコードは変更していません。': { en: 'The text contains multiple code blocks or an unfinished code fence. Copy only one complete Python program. Your current code has not been changed.', zh: '文本含有多个代码块或未闭合的代码标记。请仅复制一个完整的Python程序。当前代码未被修改。' },
  'コピーしたテキストが大きすぎます。100万文字以内のPythonコードをコピーしてください。今のコードは変更していません。': { en: 'The copied text is too large. Copy Python code of no more than 1,000,000 characters. Your current code has not been changed.', zh: '复制的文本过大。请复制不超过100万个字符的Python代码。当前代码未被修改。' },
  '読み取り中に編集内容や画面の状態が変わったため、貼り付けを中止しました。今のコードは変更していません。': { en: 'Pasting was cancelled because the code or screen state changed while reading. Your current code has not been changed.', zh: '读取期间代码或页面状态发生变化，已取消粘贴。当前代码未被修改。' },
  'コピーしたコードは、今のコードと同じです。変更はありません。': { en: 'The copied code is identical to the current code. Nothing has changed.', zh: '复制的代码与当前代码相同，没有修改。' },
  'コピーしたコードをすべて貼り付けました。機器への書き込み・実行はしていません。': { en: 'All copied code has been pasted. Nothing has been written to a device or run.', zh: '已粘贴全部复制的代码。未写入设备或运行代码。' },
  'クリップボードを読み取れませんでした。ブラウザーの許可を確認するか、下のコード欄を選んで通常の貼り付けを使ってください。今のコードは変更していません。': { en: 'Could not read the clipboard. Check browser permissions, or select the editor below and use the usual paste command. Your current code has not been changed.', zh: '无法读取剪贴板。请检查浏览器权限，或选择下方编辑区使用常规粘贴。当前代码未被修改。' },
  '貼り付け前のコードに戻しました。機器への書き込み・実行はしていません。': { en: 'Restored the code from before this paste. Nothing has been written to a device or run.', zh: '已恢复粘贴前的代码。未写入设备或运行代码。' },
  '貼り付け後にコードが変わったため、「貼り付け前に戻す」は使えません。': { en: 'Undo this paste is unavailable because the code has changed since pasting.', zh: '粘贴后代码已发生变化，无法恢复粘贴前的代码。' },
}
