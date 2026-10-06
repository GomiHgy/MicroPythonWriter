import type { MessageCatalog } from './types'

export const exportMessages: MessageCatalog = {
  '修正依頼をファイルで保存': { en: 'Download repair request', zh: '下载修复请求文件' },
  'Androidなどで全文を貼り付けられないときは、ファイルで保存して、AIの会話にその.txtファイルを添付して送信してください。添付できない場合は、ファイルを開いて全文をコピーしてください。': { en: 'If Android or another device cannot paste the full text, download it and attach the .txt file to your AI chat. If attachments are unavailable, open the file and copy all its text.', zh: '如果在 Android 等设备上无法粘贴全文，请保存为文件，并在 AI 对话中附上该 .txt 文件后发送。如果无法添加附件，请打开文件并复制全文。' },
  '修正依頼のコード・設定・ログにpassword、token、SSIDなどの情報らしき文字があります。内容を確認してファイルへ保存しますか？検出は補助で、すべての秘密情報を見つけられるわけではありません。': { en: 'The repair request may contain passwords, tokens, SSIDs or other private information in its code, settings or logs. Have you checked the contents and want to download it? Detection is only an aid and may miss private information.', zh: '修复请求的代码、设置或日志中可能包含 password、token、SSID 等隐私信息。请检查内容，是否保存为文件？检测仅为辅助，无法发现所有秘密信息。' },
  '修正依頼のファイル保存を開始しました。ブラウザのダウンロードを確認してください。': { en: 'Repair request download started. Check your browser’s downloads.', zh: '修复请求文件已开始下载。请查看浏览器的下载记录。' },
  'ファイルを保存できませんでした。修正依頼のテキスト欄から手動でコピーしてください。': { en: 'The file could not be downloaded. Copy the repair request manually from its text field.', zh: '无法保存文件。请从修复请求文本框中手动复制。' },
  'ファイル保存をキャンセルしました。修正依頼の内容を確認してください。': { en: 'Download cancelled. Please check the repair request contents.', zh: '已取消文件保存。请检查修复请求的内容。' },
}
