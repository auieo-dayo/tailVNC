# Third-Party Notices

この文書はTailVNCの主要な実行時依存とライセンス上の注意点をまとめたものです。ビルド時に検出したGoモジュールとライセンス原文は `dist/licenses/` に出力されます。個別の原文・著作権表示を含め、配布物に同梱してください。

## 主な依存

| Component | Version / Source | License | 注意点 |
| --- | --- | --- | --- |
| Tailscale browser WASM bridge | `tailscale.com` v1.102.3を基にした`cmd/tailvnc-wasm/main_js.go` | BSD-3-Clause | 元ファイルの著作権・SPDX表示を保持しています。Tailscaleまたは貢献者の名称を製品推奨に使わないでください。Goの推移依存ライセンスもビルド時に同梱します。 |
| Go browser runtime | Go 1.27.1 `wasm_exec.js` | BSD-style | Go配布物のLICENSEをビルド時に同梱します。 |
| noVNC | 1.7.0 | MPL-2.0 | core JavaScriptを含むため、実行形式の配布時も対応するソース形式へのアクセス先を維持してください。ソースは[noVNC v1.7.0](https://github.com/novnc/noVNC/tree/v1.7.0)で公開されています。現状noVNC本体は未改変です。MPL対象ファイルを改変した場合は、その変更部分のソース提供条件が適用されます。作者一覧と正式なMPL本文を同梱します。 |
| IBM Plex Sans / Mono | Fontsource 5.3.0 | OFL-1.1 | フォントの著作権表示と各パッケージのOFL本文を保持してください。フォントを改変して再配布する場合、Reserved Font Nameの条件を確認してください。 |
| Lucide Preact | 0.468.0 | ISC | ライセンス本文を配布物に同梱します。 |
| Preact | 10.29.8 | MIT | ライセンス本文を配布物に同梱します。 |
| pako (vendored by noVNC) | noVNC 1.7.0内 | MIT | pako自身の著作権・MITライセンス原文を別途同梱します。 |
| noVNC DES implementation | `core/crypto/des.js` | BSD-style notices | AT&T Laboratories Cambridge、Widget Workshop、Jef Poskanzerの個別著作権・条件・免責を含むソースヘッダーをNOTICEに収録します。 |

## 公開前の確認

- ルートのMITライセンスはTailVNC独自コードに適用し、個別表示のあるTailscale由来コードや第三者依存のライセンス条件は置き換えません。寄与を受け入れる場合は、寄与者がそのMIT適用範囲に対する権利を持つことを確認してください。
- `private: true` はnpmへの誤公開防止であり、GitHub上のソース利用条件ではありません。
- `dist/licenses/` はビルド成果物です。Web配布やアーカイブ公開でビルド成果物を再配布する際は、ライセンス表示を含むこのディレクトリを一緒に配布してください。
- noVNCを改変したり、別のフォント・アイコン・依存を追加した場合は、この一覧と生成されるライセンス原文を再確認してください。
- この一覧はライセンス判断の補助資料であり、法的助言ではありません。公開形態・変更内容が決まった段階で最終確認してください。