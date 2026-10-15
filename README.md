# Lab Note

pnpmワークスペースのモノレポです。

| ディレクトリ | 内容 | ポート |
| --- | --- | --- |
| `app` | Tauriデスクトップアプリ（画面は `app/front`）。Kotoba-Whisperサーバーも起動する | 53102 |
| `upload_api` | RustFS署名用Worker | 53103 |
| `ai_api` | AI要約・esa反映用Worker | 53104 |

## セットアップ

[mise](https://mise.jdx.dev/)・`git`・`curl` を用意し、ルートで実行します。

```bash
mise install    # Node.js・pnpm・Rust・CMake
mise run setup  # submodule取得、モデルのダウンロードとSHA-256確認、pnpm install、.dev.varsの作成
```

作成された `upload_api/.dev.vars` と `ai_api/.dev.vars` に実際の値を設定してください（コミットしないこと）。

## 起動とテスト

| コマンド | 内容 |
| --- | --- |
| `pnpm dev` | アプリと2つのWorkerをまとめて起動 |
| `pnpm dev:app` | Tauriアプリのみ（初回は `whisper-server` を自動ビルド） |
| `pnpm dev:api` / `dev:upload` / `dev:ai` | Workerのみ |
| `pnpm test` | 全パッケージのテスト（外部通信なし） |

Whisperサーバーだけを動かす場合（アプリとは同時に起動しない）：

```bash
cmake -S app/whisper.cpp -B app/whisper.cpp/build
cmake --build app/whisper.cpp/build --config Release -j
./app/start-local-whisper.sh
```

## whisper.cppとモデルの基準値

| 項目 | 値 |
| --- | --- |
| whisper.cppのコミット | `1da4dc82fa7996d4edda05890dca65aeceaafd6d`（`1.9.4-dev`） |
| モデル | `ggml-kotoba-whisper-v2.0-q5_0.bin` |
| モデルのSHA-256 | `4a3b92192b5d3578ff854a5876213e2e27af0c2d357492c2d14271e82c303658` |

モデルのハッシュが合わない場合は、ファイルを削除して `mise run setup:model` を再実行します。
whisper.cppのコミットを変えた場合は `app/whisper.cpp/build-tauri` を再ビルドしてください。

## 連絡事項の録音・要約

各報告会のメンバー一覧の最後にある「連絡事項」を選び、録音します。
録音停止後に文字起こしを修正し、「保存してAI要約」で送信できます。
使わない回は選択・録音する必要はありません。

RustFSでは、他の報告者と同じ日付フォルダに
`announcements_audio_01.webm`、`announcements_transcript_01.txt` のように保存します。
音声の拡張子はブラウザにより異なり、ファイル番号は既存ファイルに応じて増えます。

連絡事項には専用プロンプト（`workers-ai-test/src/announcements.ts`）を使います。
学生の進捗報告と自動で分類する仕組みではないため、録音前に対象を選んでください。
要約はesaの既存の「連絡事項」欄に反映し、学生の欄には入れません。
AI生成部分は `<!-- lab-note:announcements:start -->` と
`<!-- lab-note:announcements:end -->` で囲み、再送時はその範囲だけ置き換えます。
esa上で手書きの内容を残したい場合は、この目印の外に記入してください。
目印や連絡事項の見出しが壊れている場合は更新を中止します。

Node.js 24で、外部通信・AI利用・esa投稿を行わずにテストできます。

```bash
npm --prefix workers-ai-test test
```

## 新しいメンバーを追加する場合

現在はメンバー情報が画面とAI・esa用Workerに分かれているため、
所属する報告会ごとに、以下の3か所を変更してください。

| 変更する場所 | 追加する内容 | 役割 |
| --- | --- | --- |
| `script.js` の `meetingGroups` | 該当する報告会の配列に名前を追加 | 名前ボタンと報告状況に表示する |
| `workers-ai-test/src/index.ts` の `SPEAKERS` | 同じ報告会の配列に同じ名前を追加 | そのメンバーのAI処理を受け付ける |
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
変更後はAI・esa用Workerを再起動し、Web画面を再読み込みします。

既存の報告会にメンバーを追加するだけなら、RustFS署名用Workerの変更や
メンバー用フォルダの作成は不要です。新しい報告会自体を増やす場合は、
画面の選択肢・保存先の対応表・RustFS側の許可設定なども別途変更する必要があります。
