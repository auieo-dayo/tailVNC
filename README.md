# TailVNC

ブラウザ内のTailscale WASMクライアントからtailnet peerへTCP接続し、noVNCでVNCを表示するWebクライアントです。VNC/WebSocket中継サーバーは使いません。

## 開発

必要なものはNode.js 22.12+または24+、Go 1.27.1です。

```sh
npm install
npm run dev
```

初回ログイン後、Tailscale管理者が必要な場合はブラウザに表示される承認フローを完了してください。tailnet内でVNCが有効な端末を選び、必要ならポートとVNCパスワードを入力して接続します。既定ポートは5900です。

開発サーバーは既定で `http://localhost:5173` です。別の端末から使う本番配布ではHTTPSが必要です。VNC/Tailscaleのセキュリティ状態やtailnet ACLは利用者側の環境に依存します。

## ビルドとテスト

```sh
npm test
npm run typecheck
npm run build
```

ビルド時にTailscale WASMとGoのブラウザランタイム、第三者ライセンスを `public/` へ生成します。`public/` の生成ファイルはリポジトリへ含めません。

## ライセンス

ルートの [LICENSE](LICENSE) に記載したMITライセンスは、Copyright表示の権利者が許諾するTailVNC独自コードに適用します。個別の著作権表示やライセンスがある第三者コード・依存物には、それぞれのライセンス条件が引き続き適用されます。特に`cmd/tailvnc-wasm/main_js.go`のTailscale由来部分はBSD-3-Clause、noVNCはMPL-2.0です。`package.json` の `private: true` はnpm公開を止める設定で、ライセンスの適用範囲を変更しません。

第三者コードとフォントの主なライセンス、再配布時の注意は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にまとめています。ビルドはWASMに含まれるGoモジュールと実行時npm依存のライセンス原文を `dist/licenses/` に生成します。配布時はこのディレクトリを削除・除外しないでください。

## 接続構成

`cmd/tailvnc-wasm/main_js.go` はTailscale v1.102.3のブラウザWASMクライアントを基にし、認証済みtailnet peerに限定した `openTCP(host, port)` を公開します。noVNCのraw channel形式へ変換してRFBプロトコルを運びます。独自チャネル接続はnoVNCの公式型保証外のため、noVNCバージョンを固定しています。

## 注意
本ソフトウェアは現状有姿で提供され、明示または黙示の保証はありません。開発者、著作権者および貢献者は、適用法令で認められる最大限の範囲において、本ソフトウェアの利用または利用不能、接続先の設定・稼働状況、データの損失・破損その他の損害について責任を負いません。この記載は、法令上免除できない責任を制限するものではありません。

このプロジェクトはバイブコーディングを活用して作成されました。
