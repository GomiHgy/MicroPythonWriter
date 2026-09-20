# ライセンス・商標表示の保守

## 利用者への表示と境界

全タブ共通のページ下部、既存のバージョン表示の直前に「ライセンス・商標」を表示する。初期状態は閉じたネイティブ `details/summary`。日本語・英語・簡体字中国語に対応し、ライセンス全文・著作権者名・SPDX識別子は翻訳しない。

本番では同梱の `third-party-licenses.txt` を別タブで開く。リンクには `noopener noreferrer` を付け、`import.meta.env.BASE_URL` を利用するため、相対baseおよび `/MicroPythonWriter/` 配下に対応する。開発サーバーでは未生成のファイルへリンクせず、本番ビルド後に確認する旨を示す。表示のための外部API・npmへの問い合わせはない。折りたたみ操作にはアプリの状態変更や通信処理を紐付けない。

MicroPython WriterはEdelWorksが開発する非公式ツールであり、M5Stack、MicroPythonプロジェクト、Bluetooth SIGの公式製品ではない。名称の記載は承認・認証を示さない。商標帰属表示は商標使用許諾やBluetoothの資格・認証取得の代わりにはならない。

**この整備は、すべての法的問題が解決したという判断ではない。** 作業時点でアプリ独自部分を対象としたルートの `LICENSE` や `package.json` の `license` フィールドはなかった。今回も追加していない。独自コード・教材・AIプロンプト・生成テンプレートの利用許諾は、権利者と保守者が別途決定する必要がある。

## 通常ビルドと検証

```sh
npm ci
npm run test
npm run lint
npm run build
npm run check:licenses
npm run preview
```

`npm run build` は型検査、Viteビルド、`check:licenses` の順に実行する。独立した `check:licenses` の再実行も可能。既存の `.github/workflows/deploy-pages.yml` はこのビルドに成功した後だけ `dist` 全体をアップロードするため、同梱ファイルを別途手作業で公開する必要はない。本番公開は通常のリリース承認・手順に従う。

出力:

| ファイル | 内容 |
| --- | --- |
| `dist/third-party-licenses.txt` | 利用者が開く全文。各パッケージの名前・版・識別子・原本のLICENSE/NOTICE、手動素材の表示 |
| `dist/third-party-licenses.json` | Vite標準機能による実バンドルの依存ライセンス情報 |
| `dist/license-inventory.json` | バンドルのモジュールから得た所有パッケージ・版・相対パス。仮想ランタイムの補完根拠も記録 |

生成物は `dist` にのみ作成し、ソースとしてコミットしない。UIに依存名や版の一覧を固定しない。

## 自動収録の仕組み

調査時のロックファイル・インストール済みViteは **8.2.2**。[Vite公式 `build.license`](https://vite.dev/config/build-options#build-license) とインストール済みの型・実装・生成結果を確認した。標準機能のJSON形式を使い、`build/licenses.ts` で次の補完と照合を行う。

1. Viteは最終チャンクの `moduleIds` から依存を抽出する。lockfile全体やdevDependencies全体を配布対象として列挙しない。
2. 同じ実チャンクから所有パッケージを確認し、ViteのJSONとインストール済み `package.json`・LICENSE本文を照合する。推測でMIT等を補わない。
3. 各所有パッケージのLICENSE/LICENCE/COPYING、NOTICE、COPYRIGHT、THIRD-PARTY-LICENSE等のファイルと該当ディレクトリを再帰確認し、原文のまま収録する。別の `node_modules` は別所有者として扱う。ライセンス名だけの一覧にはしない。
4. Vite標準の一覧はNULで始まる仮想モジュールを除外するため、実チャンクに含まれた `vite/modulepreload-polyfill.js`・`vite/preload-helper.js` と `rolldown/runtime.js` を補完する。開発ツール全体をブラウザに配布しているという意味ではない。
5. Viteはインストール済み `LICENSE.md` の **Vite core license** 節をそのまま収録する。他のビルド時依存までアプリ同梱物として表示しない。節の構造が変われば失敗させ、保守者が原本を再確認する。Rolldownは `LICENSE` とそこで参照される `THIRD-PARTY-LICENSE` を省略せず保持する。
6. `licenses/manual-notices.txt` を同じ全文ファイルの末尾へ追加する。手動素材の根拠は [licenses/README.md](../licenses/README.md) を参照。

調査時のネイティブ一覧は19パッケージ: React、React DOM、scheduler、CodeMirror 7パッケージ、Lezer 4パッケージ、`@marijn/find-cluster-break`、`style-mod`、`w3c-keyname`、`@xterm/xterm`、`@xterm/addon-fit`。これに実際の仮想補助コードの所有者であるViteとRolldownを補完する。これは調査時の記録であり、更新後の正本は毎回の生成物。

## 失敗時と依存更新時

- 欠落・空の本文、`UNKNOWN` / `NOASSERTION` や明らかな仮置き文字列、原本との差異、未確認の仮想モジュール、収録漏れはパッケージ名と理由を示してビルドを失敗させる。識別子だけの短い本文やMITの著作権・許諾・免責の欠落も拒否する。
- ビルド後は保存された全文と原本から再生成した全文を一致比較する。NOTICEの削除や全文ファイルの空・改変・欠落も失敗になる。
- 依存更新後はロックされた版をクリーンインストールし、上記コマンドをすべて実行する。生成JSONとTXTの差分を確認し、追加依存・ライセンス変更・NOTICE・コピーライトの差異をレビューする。
- 検証に失敗したときは名前・版・配布元アーカイブと実際のLICENSE/NOTICEを確認する。自動生成物へ仮文を手入力したり、検証を無効化して通したりしない。原本が欠けるパッケージは、許諾が確認できる依存への変更等を別途判断する。
- ツールの内部IDやライセンス形式が変わった場合も、根拠を記録してコードとテストを更新する。例外を作るなら対象版・出典・理由・全文の保存先を必ず記録する。

これは明白な欠落を検出する仕組みであり、未知の文書形式や第三者の権利関係を完全に判定するものではない。将来の画像・フォント・CSSのみの素材・別のビルドプラグインによる生成コードは、配布物の実体と照合する必要がある。

## npm外の素材・コードの確認

2026-09-20時点の限定調査。既存のライセンスコメントは削除しない。

| 対象 | 配布・確認状況と残る判断 |
| --- | --- |
| `public/icons.svg` | UIからの参照はないが、publicからdistへコピーされるため配布対象。公式create-viteテンプレートと一致し、テンプレートに適用されるCC0-1.0を手動記録に同梱。ロゴの商標使用許諾まで取得したという意味ではない |
| `src/assets/react.svg`、`vite.svg`、`hero.png` | 公式テンプレートと一致。現在は参照がなくWebのdistには含まれないが、リポジトリには存在する。手動記録に範囲を分けて記載 |
| `public/favicon.svg`（`src/App.tsx` のLEDアイコンにも使用） | 現在のアプリで使用。出典・第三者からの転載を示す権利資料がなく、Git履歴だけでは独自著作物の権利帰属を確定できない。制作経緯・権利を保守者が確認する |
| `firmware/starter/runtime.py`、`src/services/projects/StarterProgram.ts` | ランタイム原文をブラウザに含め、生成main.pyへ追加する。外部からコピーした特定の第三者コードという根拠は確認できない。独自部分の出所と利用許諾を保守者が確認する。一律のMITヘッダーを追加しない |
| `prompt.md`、`src/services/prompt/WorkshopRules.ts`・`StartPromptBuilder.ts`・`RepairPromptBuilder.ts`、`src/i18n/promptMessages.ts` | 教材・生成プロンプト・埋め込み例の制作経緯と利用許諾は別途確認が必要。公式API・機種資料への参照はあるが、転載コードの許諾を示すものとは区別する。API名やBLE UUIDの一致だけで第三者コードのコピーとは断定しない。利用者が登録する基準コードの権利も個別確認が必要 |

MicroPythonやM5StackのAPIを利用することと、ファームウェア・SDK本体を同梱することは別。今回、公式ファームウェアやSDKを新たに同梱せず、それらを配布コンポーネント一覧へ架空に追加していない。実機の検証状態や利用者の保存済みコードは変更しない。

新しい手動素材を追加する際は、対象パス、どの出力へ入るか、出典URLと固定版/コミット、取得日、照合方法/ハッシュ、元の著作権とライセンス・NOTICE全文、改変内容、未確定事項を `licenses/README.md` に記録する。必要な表示原文を `licenses/manual-notices.txt` に追記し、ビルド成果物から読めることを確認する。第三者コードを生成main.pyへコピーする場合は、その出力にも必要な通知が残るよう生成器とテストを更新する。出所不明のものを既知ライセンス扱いで登録しない。

## 今回の確認記録（2026-09-20）

- `npm run test`: 25ファイル・1,237テスト PASS。原本比較、欠落・UNKNOWN・仮置きの拒否、共通UI・3言語・状態保持、公開用ビルド経路を含む。
- `npm run lint`、`npm run build`、独立した `npm run check:licenses`、`git diff --check`: PASS。ビルドには既存の500 kB超チャンク警告が残る。
- 実際の本番出力: 19依存と2補助コード所有者、元の著作権・許諾・免責、Rolldownの関連通知、手動CC0全文を確認。
- ローカルpreview: `/MicroPythonWriter/` 配下のHTML/TXT/JSONをHTTP 200で取得し、distの原本との一致を確認。
- Chrome: 初期閉状態、Enterで開閉、3言語、別タブに開く全文と元アプリの維持、デスクトップの目視表示を確認。狭い幅ではDOM寸法上の横はみ出しなし。ただし狭幅スクリーンショットは取得がタイムアウトしたため目視確認未完了。スマートフォン実機は未確認。
- USB/BLEの実機通信・機器動作、本番公開・公開後HTTP確認は未実施。通信や生成プログラムの仕様変更、認証取得・商標許諾取得、アプリ独自ライセンスの決定は行っていない。
