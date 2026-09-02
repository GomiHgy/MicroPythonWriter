# M5NanoC6 MicroPython Web Programmer

M5Stack NanoC6 / ESP32-C6 の MicroPython を、PC版 Chrome または Edge からUSB CDCシリアルで操作する完全静的なWebアプリ。WebUSBではなく **Web Serial API** を使用し、コードとシリアルログを外部サーバーへ送信しない。

## 対応範囲

- 主対象: M5Stack NanoC6、ESP32-C6、M5Stack UIFlow MicroPython（例: MicroPython v1.27.0-dirty）。
- ブラウザ: PC版 Google Chrome / Microsoft Edge。Web Serial APIが未対応なら接続操作は無効になる。
- HTTPSまたは `localhost` が必要。GitHub PagesはHTTPSなので公開後そのまま使える。
- USB VID/PIDは固定していない。USB接続ボタンのクリックから、ブラウザ標準のポート選択を表示する。

## 安全設計

UIはシリアルポートへ直接触らず、`WebSerialTransport → RawReplClient → MicroPythonDevice / FileTransferService / BootModeService → hook → UI` の順で責務を分離している。Raw REPLの制御バイトはプロトコル解析が終わるまで `Uint8Array` として保持する。

`main.py` の書込みは、`main.py.tmp` へBase64チャンク（既定384 bytes）で送信し、サイズ確認と `compile()` を通してから、既存ファイルを `main.py.bak` に退避してrenameする。USB抜去・構文エラーでは既存 `main.py` の変更前に止まる。`/flash` は固定していない。

一時開発モードは推奨の通常フローで、Ctrl-C、Raw REPL、soft resetを用いるだけでNVSを変更しない。書込み後の実行はハードリセットではなくRaw REPLから `main.py` を実行する。

## 起動モード

- **動作OKとして自動起動**: `boot_option.set_boot_option(0)` を優先し、対応しない場合だけ検出済みの `esp32.NVS('uiflow').set_u8(...); commit()` を使う。実行後は確認のうえリセットする。
- **永続プログラムモード**: 同じ安全条件で `boot_option=1` を設定する。このモードでは次回起動時に `main.py` を自動実行しない。UIFlowのネットワーク待機処理が動くことがあるため、再接続後に一時開発モードへ入る。
- `set_u8` がない環境で `set_i32` 等へ勝手に代替しない。安全に設定できない場合は書込み・実行だけを継続する。

「書込みして実行」の5秒観察は、未処理例外を見つける補助でしかない。5秒間例外がなくても実機の動作成功とは断定しない。自動起動はユーザーが明示的に有効化する。

## 使い方

1. NanoC6をUSB接続し、このアプリをPC版Chrome/Edgeで開く。
2. `USB接続` を押し、ポート選択ダイアログで対象を選ぶ（初期115200 bps）。
3. 一時開発モードに入り、検出された機器情報・カレントディレクトリ・ファイル一覧・boot_optionを確認する。
4. コードを編集し、`main.pyへ書込み` または `書込みして実行` を使う。Ctrl+S / Ctrl+Enterも使える。
5. ターミナルの出力とTracebackを確認する。エラーでは該当行とAI修正依頼プロンプトを表示する。
6. 実際のハードウェア動作を確認してから、必要なら自動起動を有効にする。

AI修正依頼プロンプトはブラウザ内で生成され、API呼出しは一切しない。`password`、`passwd`、`pswd`、`api_key`、`token`、`secret`、`ssid` の代入らしき文字列を検出した場合は、コピー前に確認する。

## ローカル開発と公開

```powershell
npm install
npm run dev
npm run lint
npm run test
npm run build
```

Viteの `base` は `./` なのでGitHub Pagesのプロジェクトページでもアセットを相対参照する。`main` へのpushで `.github/workflows/deploy-pages.yml` が `dist` をGitHub Pagesへ公開する。リポジトリ設定の **Pages / Build and deployment / Source** で **GitHub Actions** を選ぶ。

## テスト

Vitestではバイトキューの分割受信、状態遷移、Raw-paste対応／非対応、main.py.tmpのチャンク書込み、サイズ確認、Traceback、意図的停止、boot_option / NVS安全フォールバック、AI修正依頼と秘密情報検出をモックで検証する。

## 実機確認チェックリスト

- Chrome/EdgeでUSBポートを選び、切断・再接続できる。
- Raw REPLバナー、Raw-paste対応／フォールバック、長時間コードのCtrl-C停止を確認する。
- UIFlow版で `boot_option` の取得と 0/1 の切替後、再起動時の挙動を確認する。
- `main.py` 保存、例外表示、`main.py.bak` の復旧を確認する。
- 自動起動後、USB CDCの再列挙、起動バナー、Traceback、リセットループを確認する。

## 復旧と既知の制約

USBシリアルへ接続できない場合、NanoC6の **GPIO9ボタンを押したままUSBケーブルを接続** するとESP32-C6のFirmware書込み用Download Modeへ入れる。この操作は通常の `main.py` 書込みとは別。必要に応じてM5Burner等でMicroPythonファームウェアを書き直す。本アプリはMVPとしてファームウェア書込み機能を含まない。

- Python例外が出ない論理的な不具合は自動判定できない。
- Web Serial API非対応ブラウザでは利用できない。
- firmwareによって `boot_option` モジュールが存在しない可能性がある。
- ユーザーコードがUSB CDCまたはREPLを無効化すると接続できなくなる。
- ハードウェア依存処理、USB再列挙、UIFlow固有APIは実機確認が必要。
- 実機がない状態のテストはFake Serial / Fake MicroPythonによるもの。
