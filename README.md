# Lab Note

研究室の進捗報告を録音・文字起こしし、AI要約をesaの議事録へ反映するTauriデスクトップアプリです。
録音から文字起こし、RustFSへの保存、AI要約、esa投稿までを一つの画面で行えます。

## 主な機能

- 3年セミナー・HCI班・HAR班・LBS班から報告会を選択
- 報告者ごとの録音と準リアルタイム文字起こし
- Kotoba-Whisperによる端末内の日本語音声認識
- 文字起こし結果の確認・手動修正
- 音声と文字起こしのRustFS保存
- 個人進捗報告esaを参照したWorkers AIによる要約
- Cloudflare Queueによる非同期処理とKVによる状態表示
- esa議事録の作成・更新と、投稿済み記事へのリンク表示
- 教授からの連絡事項の録音・専用要約
- Cloudflare Access Service TokenによるAPI保護

## システム構成

pnpmワークスペースのモノレポです。

| ディレクトリ | 役割 | 本番環境 | ローカル開発ポート |
| --- | --- | --- | --- |
| `app` | Tauriアプリ、画面、録音、ローカル文字起こし | 各PCにインストール | Whisperのみ`53102` |
| `upload_api` | RustFSの署名付きURLを発行するWorker | `upload-api.labnote.kajilab.dev` | `53103` |
| `ai_api` | AI要約、Queue、KV、esa投稿を担当するWorker | `ai-api.labnote.kajilab.dev` | `53104` |

配布版ではTauriアプリが`whisper-server`とKotoba-Whisperモデルを同梱し、起動時に自動で
`53102`番ポートへ起動します。通常利用時にターミナル操作は必要ありません。
2つのWorkerはCloudflareへデプロイするため、配布版では`53103`・`53104`番ポートを使用しません。

## 処理の流れ

1. 報告会・報告者・録音日を選択する。
2. 録音を開始すると、音声を保存しながら約8秒ごとにローカルWhisperで文字起こしする。
3. 録音停止後、必要に応じて文字起こしを修正する。
4. 「保存してAI要約」を押す。
5. `upload_api`がRustFSへの署名付きURLを発行する。
6. アプリからRustFSへ音声と文字起こしを直接アップロードする。
7. RustFS上の文字起こしURL、報告会、報告者、録音日を`ai_api`へ送る。
8. Queue Consumerが文字起こしと個人進捗報告esaを取得し、Workers AIで要約する。
9. AI要約をesaの議事録へ反映し、完了した記事のURLをアプリへ表示する。

AI処理中も次の報告者を録音できます。処理状況はKVへ保存し、アプリが定期的に確認します。
失敗したQueue処理は最大3回試行し、失敗箇所は報告状況に表示します。KVの処理情報は7日後に削除されます。

## データの保存先

RustFSの`lab-note`バケットには次の形式で保存します。

```text
<報告会>/<年>/<月>/<日>/
├── <報告者>_audio_01.webm
├── <報告者>_audio_02.webm
└── <報告者>_transcript_01.txt
```

例：

```text
hci/2026/10/30/kuro_audio_01.webm
hci/2026/10/30/kuro_transcript_01.txt
```

同じ報告者が複数回録音した場合は連番を増やします。音声の拡張子は実行環境により
`webm`、`mp4`、`ogg`のいずれかになります。

録音停止後からRustFSへ保存するまでの音声・文字起こし・処理状態は、Tauri WebViewの
IndexedDBにも一時保存します。「記録をリセット」を押すと端末内の一時データだけを削除し、
RustFSやesaへ保存済みのデータは削除しません。

## インストール（macOS Apple Silicon）

`main`へマージされるとGitHub ActionsがDeveloper IDで署名・Appleへ公証したアプリをビルドし、
[Releases](https://github.com/kajiLabTeam/LabNote/releases/latest)へ`.dmg`を公開します。

1. 最新Releaseの`.dmg`をダウンロードする。
2. `.dmg`を開き、`lab-note.app`を「アプリケーション」へドラッグする。
3. `lab-note.app`を起動し、初回のマイク利用を許可する。

リリース時は`tauri.conf.json`のメジャー・マイナーバージョンを基準にパッチ番号を自動更新し、
バージョン更新コミットとタグを`main`へ作成します。

## 初回のCloudflare Access設定

デプロイ済みAPIはCloudflare AccessのService Tokenで保護します。アプリ右上の歯車を開き、
対象トークンのClient IDとClient Secretを入力して「保存」→「接続確認」を実行してください。

- 緑の点：設定済み
- 赤の点：未設定

認証情報はソースコード、`.dev.vars`、IndexedDBには保存しません。macOSではキーチェーン、
Windowsでは資格情報マネージャーなど、OSの資格情報ストアへ端末ごとに保存します。
歯車内の「設定を削除」で端末から削除できます。

Service Tokenをチャット、Issue、コミットへ貼り付けないでください。漏えいまたは端末紛失時は
Cloudflare側でトークンを失効させ、新しいトークンへ交換します。

## 開発環境のセットアップ

必要なもの：

- macOS
- `git`
- `curl`
- [mise](https://mise.jdx.dev/)

リポジトリのルートで実行します。

```bash
mise install
mise run setup
```

`mise run setup`は次をまとめて実行します。

- whisper.cppのsubmodule取得
- Kotoba-WhisperモデルのダウンロードとSHA-256確認
- pnpm依存関係のインストール
- `.dev.vars.example`からローカル用`.dev.vars`を作成

作成された`upload_api/.dev.vars`と`ai_api/.dev.vars`へ開発用の値を設定してください。
実際の`.dev.vars`はGit管理対象外です。

## 開発時の起動

| コマンド | 内容 |
| --- | --- |
| `pnpm dev:app` | TauriアプリとローカルWhisperを起動 |
| `pnpm dev:upload` | RustFS署名Workerを`53103`で起動 |
| `pnpm dev:ai` | AI・esa Workerを`53104`で起動 |
| `pnpm dev:api` | 2つのWorkerを同時起動 |
| `pnpm dev` | アプリと2つのWorkerをすべて起動 |

現在のTauriアプリは、[app/front/script.js](app/front/script.js)に設定したデプロイ済みAPIへ接続します。
そのため通常のアプリ開発では`pnpm dev:app`だけで動作します。ローカルWorkerをアプリから試す場合は、
`workerBaseURL`と`aiWorkerBaseURL`を一時的にローカルURLへ変更してください。変更をコミットしないよう注意します。

Whisperサーバーだけを起動する場合は、次を実行します。Tauriアプリとの同時起動はできません。

```bash
cmake -S app/whisper.cpp -B app/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release
cmake --build app/whisper.cpp/build --config Release --target whisper-server -j
./app/start-local-whisper.sh
```

## テスト

```bash
pnpm test
```

個別に実行する場合：

```bash
pnpm --filter ./ai_api test
pnpm --filter ./upload_api test
cargo check --manifest-path app/src-tauri/Cargo.toml
node --check app/front/script.js
```

AI APIのテストでは、実際のWorkers AI利用・esa投稿・RustFS通信は行いません。

## Workerの環境変数とデプロイ

### `upload_api`

| 変数 | 内容 |
| --- | --- |
| `RUSTFS_ACCESS_KEY` | RustFSアクセスキー |
| `RUSTFS_SECRET_KEY` | RustFSシークレットキー |
| `RUSTFS_ENDPOINT` | S3互換APIのURL |
| `RUSTFS_REGION` | S3署名用リージョン |
| `RUSTFS_BUCKET` | バケット名（現在は`lab-note`） |

### `ai_api`

| 変数・Binding | 内容 |
| --- | --- |
| `ESA_ACCESS_TOKEN` | esa APIトークン |
| `AI` | Workers AI Binding |
| `MINUTES_QUEUE` | AI処理用Cloudflare Queue |
| `AI_JOB_STATUS` | 処理状況保存用KV Namespace |

本番のSecretはCloudflareへ登録し、`.dev.vars`の値をデプロイしないでください。

```bash
pnpm --filter ./upload_api exec wrangler secret put RUSTFS_ACCESS_KEY
pnpm --filter ./upload_api exec wrangler secret put RUSTFS_SECRET_KEY
pnpm --filter ./upload_api exec wrangler secret put RUSTFS_ENDPOINT
pnpm --filter ./upload_api exec wrangler secret put RUSTFS_REGION
pnpm --filter ./upload_api exec wrangler secret put RUSTFS_BUCKET
pnpm --filter ./ai_api exec wrangler secret put ESA_ACCESS_TOKEN
```

デプロイ：

```bash
pnpm deploy:upload
pnpm deploy:ai
```

## Cloudflare Accessの設定

次の2ホストをCloudflare Zero TrustのSelf-hosted Applicationとして保護します。

- `upload-api.labnote.kajilab.dev`
- `ai-api.labnote.kajilab.dev`

Access PolicyはActionを`Service Auth`、IncludeをLab Note用Service Tokenにします。
また、ブラウザのCORS事前確認をWorkerへ到達させるため、両Applicationで
`Bypass OPTIONS requests to origin`を有効にしてください。OPTIONSをバイパスしても、
実際のGET・POSTはService Tokenで保護されます。

Worker側ではTauriのoriginと次のヘッダーだけを許可しています。

```text
CF-Access-Client-Id
CF-Access-Client-Secret
```

## ローカルでアプリをビルドする

```bash
pnpm --filter ./app tauri build
```

ビルド時にwhisper-serverとKotoba-Whisperモデルをアプリへ同梱します。署名付きの正式リリースは
GitHub Actionsから作成してください。

## whisper.cppとモデルの基準値

| 項目 | 値 |
| --- | --- |
| whisper.cppのコミット | `1da4dc82fa7996d4edda05890dca65aeceaafd6d`（`1.9.4-dev`） |
| モデル | `ggml-kotoba-whisper-v2.0-q5_0.bin` |
| モデルのSHA-256 | `4a3b92192b5d3578ff854a5876213e2e27af0c2d357492c2d14271e82c303658` |

モデルのハッシュが一致しない場合は、モデルファイルを削除して再取得します。

```bash
mise run setup:model
```

whisper.cppのコミットを変更した場合は`app/whisper.cpp/build-tauri`を再ビルドしてください。

## 個人進捗報告esaの参照

通常は録音日、話者名、`SPEAKER_GRADES`の学年を使い、次のesaカテゴリから記事を自動検索します。

```text
1.進捗報告(個人)/<年度>年度/<学年カテゴリ>/<話者名>/<月>/<日>
```

記事を確実に指定したい場合は、画面の「個人発表用esa URL（任意）」へURLを入力します。
入力したURLはAI処理の登録成功後に空欄へ戻ります。

記事が見つからない、または取得できない場合も処理は中止せず、文字起こしを主資料として要約します。
その場合は報告状況に警告を表示します。記事を取得できた場合はesa本文を要約の主資料とし、
文字起こしを会議中の補足・更新・議論として使用します。

## 連絡事項の録音・要約

各報告会のメンバー一覧の最後にある「連絡事項」を選択して録音します。使わない回は録音不要です。

- 保存用話者IDは`announcements`
- RustFSでは他の報告者と同じ日付フォルダへ保存
- [ai_api/src/announcements.ts](ai_api/src/announcements.ts)の専用プロンプトを使用
- esaの学生欄ではなく「連絡事項」欄を更新

AI生成部分は次の目印で囲み、再送時はこの範囲だけを置き換えます。

```text
<!-- lab-note:announcements:start -->
<!-- lab-note:announcements:end -->
```

esa上で手書きの内容を残す場合は、目印の外へ記入してください。目印または連絡事項見出しが
壊れている場合は、誤った箇所を上書きしないよう処理を失敗させます。

## メンバーの追加・年度更新

新しいメンバーを追加するときは、同じ話者IDを次の4か所へ登録します。

| ファイル・定義 | 更新内容 |
| --- | --- |
| `app/front/script.js`の`meetingGroups` | 画面に表示する報告会ごとのメンバー |
| `ai_api/src/index.ts`の`SPEAKERS` | AI処理を受け付ける報告会ごとの話者 |
| 同ファイルの`SPEAKER_GRADES` | 話者と`B3`・`B4`・`M1`・`M2`の対応 |
| 同ファイルの`TEMPLATES` | 出席者一覧と個人進捗報告欄 |

画面側とWorker側の報告会キーは次のように対応します。

| 画面表示 | 内部キー・RustFSフォルダ |
| --- | --- |
| 3年セミナー | `seminar3` |
| HCI班 | `hci` |
| HAR班 | `har` |
| LBS班 | `lbs` |

話者IDには小文字の英数字とハイフンを使用します。`announcements`は連絡事項用の予約名です。
個人欄は次の構造を保ち、最後に`<br>`を置きます。

```markdown
## **new-member**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>
```

年度が変わった場合、録音日の年から年度カテゴリを自動的に選ぶため、コード内の年度変更は不要です。
ただし、esa側に新年度のカテゴリと各メンバーの記事を用意し、進級後の学年を`SPEAKER_GRADES`と
`TEMPLATES`へ反映してください。作成済みのesa議事録にはテンプレート変更が自動反映されないため、
必要に応じて出席者一覧と個人欄を手動で追加します。

変更後はテストを実行し、`ai_api`を再デプロイしてください。画面のメンバーを変更した場合は
新しいTauriアプリもビルド・配布します。

## トラブルシューティング

### `Preflight response is not successful. Status code: 403`

Cloudflare AccessがCORSのOPTIONS要求を拒否しています。両Applicationで
`Bypass OPTIONS requests to origin`を有効にし、CORS対応後のWorkerを再デプロイしてください。

### Cloudflare Accessの接続確認に失敗する

- Service TokenのClient ID・Client Secretを確認する
- Access Policyが`Service Auth`になっているか確認する
- PolicyのIncludeに対象Service Tokenが設定されているか確認する
- 歯車から古い設定を削除し、保存し直す

保護中のAPI URLを通常のブラウザで直接開くと、Service Tokenヘッダーが付かないため403になるのは正常です。

### ローカル文字起こしを利用できない

- 配布版ではアプリを再起動する
- 開発版では`53102`番ポートを別プロセスが使用していないか確認する
- モデルのSHA-256を確認する
- whisper-serverを再ビルドする

### 個人進捗報告esaが見つからない

録音日、年度、話者ID、学年カテゴリ、esaカテゴリの日付を確認してください。必要な場合は画面から
個人発表用esa URLを直接指定できます。
