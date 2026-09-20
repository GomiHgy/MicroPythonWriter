# 手動素材の出所と権利表示

本記録は npm のバンドル依存検出だけでは扱えない素材の限定的な確認記録。アプリ本体、AI用プロンプト、生成する `main.py` 全体へ新しいライセンスを付与するものではない。自動収録・ビルド検証・更新手順は [保守手順](../docs/licenses.md) を参照する。

## Web配信対象

`public/icons.svg` は画面から参照されていないが、Vite により `dist/icons.svg` へコピーされ、Web配信物に含まれる。`licenses/manual-notices.txt` に適用宣言と CC0-1.0 全文を収録し、ビルド時の第三者ライセンス一覧へ同梱する。

- 上流: [Vite / create-vite の React + TypeScript テンプレート](https://github.com/vitejs/vite/blob/520d13bfb14c4cf4fd8d3620e1fc5e6e815c9606/packages/create-vite/template-react-ts/public/icons.svg)
- 固定コミット: `520d13bfb14c4cf4fd8d3620e1fc5e6e815c9606`
- ローカルと上流の SHA-256: `b45fa506195cfcdef406ba9f0c77b36ddc1a7c224040926ec70abc2fdea7b93a`（バイト単位で一致）
- ライセンス根拠: [同コミットの create-vite/LICENSE](https://github.com/vitejs/vite/blob/520d13bfb14c4cf4fd8d3620e1fc5e6e815c9606/packages/create-vite/LICENSE) の `License of the files in the directories starting with "template-" in create-vite` 節。テンプレートとその生成物は CC0-1.0。**create-vite ツール本体の MIT と混同しない。**
- ローカル導入履歴: 初回コミット `f4457223bb058dc2e69f08a1f884156ffc8e5bbc`。履歴だけで出所を推定せず、上流ファイルとの一致を確認した。
- この素材に固有の著作権者名・年の表示は確認されていないため、推測で追加していない。上流のテンプレート適用宣言とライセンス原文をそのまま保持する。

CC0 の第4節は商標権・特許権を対象から除外し、他者の権利確認も保証しない。ファイル中の Bluesky、Discord、GitHub、X 等の名称・図形について、本記録や CC0 の収録を商標使用許諾・公式な関係の証明と解釈しない。

### ライセンス原文の照合

`manual-notices.txt` の「原文開始」と「原文終了」の間は、上記 LICENSE のテンプレート節全文。改行を LF にそろえ、末尾を改行1個にした UTF-8 テキストの SHA-256 は `bddc9f7c49ee36b85680b31d01da646295fda4b00f1e5a412a39f8128e1976ef`。

create-vite 自体やその依存ツールの説明・ライセンス節は、今回の素材に適用されるテンプレート節とは別であり、この手動素材分には収録していない。

## リポジトリにはあるが現行Web配信に含まれない素材

以下は現在 `src` から参照されておらず、確認時の `dist` にも含まれていない。Web配信対象の依存一覧とは分けて記録する。今後 import、CSS 参照、`public` への移動などで配信対象にするときは、出力と権利表示を再確認する。ソースリポジトリには存在するため、ソース配布時には出所記録も保持する。

| パス | 一致を確認した上流コミット | ローカルと上流の SHA-256 |
| --- | --- | --- |
| `src/assets/react.svg` | `520d13bfb14c4cf4fd8d3620e1fc5e6e815c9606` | `35ef61ed53b323ae94a16a8ec659b3d0af3880698791133f23b084085ab1c2e5` |
| `src/assets/vite.svg` | `520d13bfb14c4cf4fd8d3620e1fc5e6e815c9606` | `5be21acd42eb7b896e517f4e0f0f11eb5c5d9e54fbbcebe9453f033008fcca6f` |
| `src/assets/hero.png` | `a07a4bd052ac75f916391c999c408ad5f2867e61` | `881ffbcaafc212e49addad08846a5b82761355fa20624253af3477ba33262c5c` |

上流はいずれも `vitejs/vite` の `packages/create-vite/template-react-ts/` 以下の同名相対パス。各ファイルは記載コミットの上流ファイルとバイト単位で一致する。React／Vite のロゴの商標条件について、テンプレートのライセンスだけで許諾済みとは判断しない。

## 素材を追加・変更するとき

1. ローカルパス、実配信の有無、上流URL、版または固定コミット、変更内容、ファイルハッシュを記録する。
2. 実物に付属する LICENSE／NOTICE／著作権コメントを確認し、必要な全文を省略・翻訳せず `manual-notices.txt` へ追加する。
3. コピー元が不明な場合、見た目・API名・UUIDの一致だけで出所を決めず、保守者が確認する。架空の著作権表示やライセンスを付けない。
4. 生成コードへ第三者コードをコピーする場合は、その生成物にも必要な表示が残ることを確認する。

この確認記録は限定したファイルと根拠を対象とする。すべての素材・生成コードの適法性、Bluetooth の資格認証、商標使用許諾を保証しない。
