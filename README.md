# Lab Note

## 構成

pnpmワークスペースのモノレポです。

| ディレクトリ | 内容 | ポート |
| --- | --- | --- |
| `app` | Tauriデスクトップアプリ（画面は `app/front`）。起動時にKotoba-Whisperサーバーも立ち上げる | 53102（Whisper） |
| `upload_api` | RustFS署名用Worker | 53103 |
| `ai_api` | AI要約・esa反映用Worker | 53104 |

## 初回セットアップ

[mise](https://mise.jdx.dev/) を使います。`git` と `curl` を用意したうえで、
プロジェクトのルートで次を実行します。

```bash
mise install
mise run setup
```

`mise install` は `mise.toml` で固定したNode.js・pnpm・Rust・CMakeを入れます
（Node.js `24.19.0`、pnpm `11.20.0`、CMake `4.4.4`）。
`mise run setup` は次のタスクをまとめて実行します。個別に `mise run setup:model` のようにも実行できます。

| タスク | 内容 |
| --- | --- |
| `setup:submodule` | `whisper.cpp` のsubmoduleを取得（`git submodule update --init --recursive`） |
| `setup:model` | Kotoba-Whisperモデルを未取得ならダウンロードし、SHA-256を確認 |
| `setup:deps` | `pnpm install --frozen-lockfile` |
| `setup:dev-vars` | `upload_api` と `ai_api` に `.dev.vars` がなければ `.dev.vars.example` からコピー |

コピーされた `.dev.vars` には実際の値を設定してください。
実際のアクセスキーやトークンをGitHubへコミットしないでください。

`whisper-server` は `pnpm dev:app` の起動時に `app/whisper.cpp/build-tauri` へ
自動でビルドされるため、手動でのビルドは不要です。

### whisper.cppとKotoba-Whisperについて

`whisper.cpp`本体はGit submoduleとして管理し、確認済みコミットに固定しているため、
他のPCでも同じ実装を使用できます。ビルド結果とKotoba-Whisperモデルは
容量が大きいため、GitHubには含まれていません。

#### whisper.cppのバージョンとモデルのハッシュ値

2026年10月6日に開発PCで確認した基準値です。
本体のコミットIDはプログラムの版、モデルのSHA-256はファイル内容を識別します。
この2つを互いに比較せず、相手のPCの同じ項目と比較してください。

| 項目 | 確認した値 |
| --- | --- |
| whisper.cppのソース上のバージョン | `1.9.4-dev`（正式リリースのタグではなく、下記コミットで指定） |
| whisper.cppのコミットID | `1da4dc82fa7996d4edda05890dca65aeceaafd6d` |
| モデル | Kotoba-Whisper v2.0、GGML形式、`q5_0`量子化 |
| モデルファイル名 | `ggml-kotoba-whisper-v2.0-q5_0.bin` |

モデルファイルのSHA-256：

```text
4a3b92192b5d3578ff854a5876213e2e27af0c2d357492c2d14271e82c303658
```

プロジェクトのルートで次を実行します。

```bash
git -C app/whisper.cpp rev-parse HEAD
git -C app/whisper.cpp status --short
shasum -a 256 app/whisper.cpp/models/ggml-kotoba-whisper-v2.0-q5_0.bin
```

`rev-parse HEAD` の結果は上記コミットIDと比較します。
`status --short` が何も表示しなければ、本体のソースにローカル変更はありません。
`shasum` の結果は、ファイル名の前に表示されるハッシュ値を上記SHA-256と比較します。
Linuxでは `shasum -a 256` の代わりに `sha256sum` も使えます。

既に別の版を取得している場合は、本体の変更を確認・退避してから、次の手順で
コミットをそろえて再ビルドしてください。コミットを変えるだけでは、以前に
ビルドした実行ファイルは更新されません。アプリは終了してから作業します。

```bash
git -C app/whisper.cpp fetch origin
git -C app/whisper.cpp checkout --detach 1da4dc82fa7996d4edda05890dca65aeceaafd6d
cmake -S app/whisper.cpp -B app/whisper.cpp/build-tauri -DCMAKE_BUILD_TYPE=Release
cmake --build app/whisper.cpp/build-tauri --config Release --target whisper-server -j
```

モデルのSHA-256が異なる場合は、ダウンロードした版・量子化形式が同じか、
ダウンロードが完了しているかを確認してください。ファイル名が同じでも、
中身が同じとは限りません。ダウンロードURLは `main` を参照するため、
`mise run setup:model` がハッシュ値の不一致を報告した場合は、
モデルファイルを削除してから再実行してください。

アプリで使うモデルは `app/src-tauri/tauri.conf.json` の `bundle.resources` と
`app/src-tauri/src/lib.rs` で指定しています。
本体とモデルが一致しても、マイク・入力設定・周囲の雑音・ビルド環境によって
文字起こしの結果は変わることがあります。

## ローカル起動

プロジェクトのルートで次を実行すると、アプリと2つのWorkerをまとめて起動します。

```bash
pnpm dev
```

個別に起動する場合は次のスクリプトを使います。

| コマンド | 起動するもの |
| --- | --- |
| `pnpm dev:app` | Tauriアプリ（Kotoba-Whisperサーバーを含む） |
| `pnpm dev:api` | RustFS署名用WorkerとAI要約・esa反映用Worker |
| `pnpm dev:upload` | RustFS署名用Workerのみ |
| `pnpm dev:ai` | AI要約・esa反映用Workerのみ |

画面のコード（`app/front`）を変更した場合は、アプリの画面を再読み込みします。

「保存してAI要約」後の進み具合は、報告状況に表示します。
AI処理の受付・生成、esaへの投稿を確認でき、失敗時は「アップロード失敗」
「AI処理失敗」「esa投稿失敗」などに表示が変わり、詳しい理由も表示します。
「esa投稿済み ↗」から記事を新しいタブで開けます。
報告状況上部の「記録をリセット」は、確認後にブラウザ内の全報告会の記録を消去します。
RustFSとesaに保存済みのデータは削除しません。

## AIサーバーが停止した場合

AI・esa用WorkerのWranglerは `4.147.0` に固定しています。
既存の `pnpm-lock.yaml` に合わせて依存関係を更新する場合は、
プロジェクトのルートで `pnpm install --frozen-lockfile` を実行してください。
更新前から起動しているWorkerは `Ctrl+C` で終了し、`pnpm dev:ai` で起動し直します。

接続が切れると、報告状況に「AIサーバーに接続できません」と表示します。
サーバー再起動後は10秒間隔で元の処理IDを確認し、取得できた状態に表示を戻します。
「状況を再確認」ボタンも、AIへの再送ではなく処理状況の取得だけを行います。

サーバーに接続できても処理情報が見つからない場合や、処理状況が10分以上
更新されていない場合は「AI処理状況を要確認」と表示します。
これは失敗確定ではありません。Workerのログとesaの投稿状況を確認してください。
処理の重複を避けるため、状況不明の処理を自動で再送・再開することはありません。
サーバーから「失敗」が確認できた場合は「AI処理を再実行」を利用できます。

## 連絡事項の録音・要約

各報告会のメンバー一覧の最後にある「連絡事項」を選び、録音します。
録音停止後に文字起こしを修正し、「保存してAI要約」で送信できます。
使わない回は選択・録音する必要はありません。

RustFSでは、他の報告者と同じ日付フォルダに
`announcements_audio_01.webm`、`announcements_transcript_01.txt` のように保存します。
音声の拡張子はブラウザにより異なり、ファイル番号は既存ファイルに応じて増えます。

連絡事項には専用プロンプト（`ai_api/src/announcements.ts`）を使います。
学生の進捗報告と自動で分類する仕組みではないため、録音前に対象を選んでください。
要約はesaの既存の「連絡事項」欄に反映し、学生の欄には入れません。
AI生成部分は `<!-- lab-note:announcements:start -->` と
`<!-- lab-note:announcements:end -->` で囲み、再送時はその範囲だけ置き換えます。
esa上で手書きの内容を残したい場合は、この目印の外に記入してください。
目印や連絡事項の見出しが壊れている場合は更新を中止します。

外部通信・AI利用・esa投稿を行わずにテストできます。
プロジェクトのルートで次を実行すると、全パッケージのテストを実行します。

```bash
pnpm test
```

## Kotoba-Whisperの確認

`pnpm dev:app` でアプリを起動すると、`whisper-server` がサイドカーとして
ポート53102で自動的に起動し、アプリの終了とともに停止します。
初回起動ではビルドとMetalの準備に時間がかかることがあります。

アプリを使わずにWhisperサーバーだけを動かす場合は、`app/whisper.cpp/build` へ
ビルドしてから `app/start-local-whisper.sh` を実行します。
アプリと同じポートを使うため、同時には起動しないでください。

```bash
cmake -S app/whisper.cpp -B app/whisper.cpp/build
cmake --build app/whisper.cpp/build --config Release -j
./app/start-local-whisper.sh
```

次の表示が出れば起動完了です。停止は `Ctrl+C` で行います。

```text
whisper server listening at http://0.0.0.0:53102
```

Lab Noteはマイク音声を16kHz PCMへ変換し、約8秒ごとのWAVデータとして
ローカルサーバーへ送信します。録音停止時には残りの音声の処理完了を待ってから、
報告者の文字起こしを保存します。

音声区間の境界で単語が欠けにくいよう、各区間には直前約1秒の音声を重ねます。
重なった部分の文字列は、画面へ追加するときに可能な範囲で除去します。

## 新しいメンバーを追加する場合

現在はメンバー情報が画面とAI・esa用Workerに分かれているため、
所属する報告会ごとに、以下の3か所を変更してください。

| 変更する場所 | 追加する内容 | 役割 |
| --- | --- | --- |
| `app/front/script.js` の `meetingGroups` | 該当する報告会の配列に名前を追加 | 名前ボタンと報告状況に表示する |
| `ai_api/src/index.ts` の `SPEAKERS` | 同じ報告会の配列に同じ名前を追加 | そのメンバーのAI処理を受け付ける |
| 同ファイルの `TEMPLATES` | 該当するテンプレートの出席者一覧と個人の進捗報告欄を追加 | 新規esa記事に本人の欄を用意する |

画面側の報告会名とWorker側のキーは、`3年セミナー` → `seminar3`、
`HCI班` → `hci`、`HAR班` → `har`、`LBS班` → `lbs` に対応します。
名前は3か所で一致させ、RustFSの命名ルールに合わせて小文字の英数字・ハイフンを使ってください。
`announcements` は連絡事項用の予約名なので、メンバー名には使いません。
連絡事項のボタンは自動で末尾に追加されるため、配列への追記は不要です。

例えばHCI班に `new-member` を追加する場合、テンプレートの出席者一覧には
該当する学年の下へ `- [ ] new-member` を追加します。
個人欄は同じ班の既存メンバーを参考にし、次のように追加します。

```markdown
## **new-member**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>
```

AI処理は `## **名前**` から `<br>` までを本人の欄として探すため、
名前の表記と末尾の `<br>` をそろえてください。
画面だけに名前を追加するとAIへの登録で拒否され、個人欄を追加し忘れると
「Markdownブロックが見つかりません」というエラーになります。

**作成済みのesa記事には、テンプレートの変更は自動反映されません。**
既存の記事へ追加メンバーの要約を投稿する場合は、esa上でも出席者一覧と本人の個人欄を追加してください。
変更後はAI・esa用Workerを再起動し、アプリの画面を再読み込みします。

既存の報告会にメンバーを追加するだけなら、RustFS署名用Workerの変更や
メンバー用フォルダの作成は不要です。新しい報告会自体を増やす場合は、
画面の選択肢・保存先の対応表・RustFS側の許可設定なども別途変更する必要があります。
