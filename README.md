# Lab Note

pnpmワークスペースのモノレポです。

| ディレクトリ | 内容 | ポート |
| --- | --- | --- |
| `app` | Tauriデスクトップアプリ（画面は `app/front`）。Kotoba-Whisperサーバーも起動する | 53102 |
| `upload_api` | RustFS署名用Worker | 53103 |
| `ai_api` | AI要約・esa反映用Worker | 53104 |

## ダウンロード（macOS Apple Silicon）

`main` にマージされるたびに GitHub Actions がアプリをビルドし、[Releases](https://github.com/kajiLabTeam/LabNote/releases/latest) に `.dmg` を公開します。
バージョンはマージごとにパッチ番号（`0.1.0` → `0.1.1`）が自動で上がり、CIが `chore: v0.1.1 をリリース` のコミットを `main` にpushします。メジャー・マイナーを上げるときは `app/src-tauri/tauri.conf.json` の `version` を `0.2.0` のように書き換えてマージしてください。
Apple Developerの署名・公証をしていないため、初回は「開発元を検証できません」と表示されます。
「システム設定 → プライバシーとセキュリティ」の下部にある「このまま開く」を押してください。
それでも開けない場合や「壊れている」と表示された場合は、次を実行してください。

```bash
xattr -cr /Applications/lab-note.app
```

## セットアップ

[mise](https://mise.jdx.dev/)・`git`・`curl` を用意し、ルートで実行します。

```bash
mise install    # Node.js・pnpm・Rust・CMake
mise run setup  # submodule取得、モデルのダウンロードとSHA-256確認、pnpm install、.dev.varsの作成
```

作成された `upload_api/.dev.vars` と `ai_api/.dev.vars` に実際の値を設定してください（コミットしないこと）。

## Cloudflare AccessによるAPI保護

デプロイ済みの次の2つのAPIは、Cloudflare AccessのService Tokenで保護します。

- `https://upload-api.labnote.kajilab.dev`
- `https://ai-api.labnote.kajilab.dev`

Cloudflare Zero Trustで両方のホスト名をSelf-hosted Applicationの対象にし、ポリシーを
`Service Auth`、Include条件を対象のService Tokenに設定してください。ブラウザのCORS
プリフライトをWorkerへ通すため、ApplicationのCORS設定ではOPTIONSリクエストをoriginへ
bypassします。Worker側では利用可能なTauri originとAccess用ヘッダーだけを許可しています。

CORS対応を含むWorkerを先にデプロイします。

```bash
pnpm deploy:upload
pnpm deploy:ai
```

その後、Lab Note右上の歯車を開き、Service TokenのClient IDとClient Secretを入力して
「保存」→「接続確認」を実行します。設定済みなら歯車の点が緑、未設定なら赤になります。
Secretはソースコード、`.dev.vars`、IndexedDBには保存せず、macOSのキーチェーンまたは
Windowsの資格情報マネージャーへ保存します。アプリを配布する際もIDとSecretを埋め込まないでください。

Service Tokenはこの2つのApplicationだけに限定し、有効期限を設定して定期的に交換してください。
漏えいまたは端末紛失時はCloudflare側で直ちに失効させ、アプリの設定も削除します。

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

連絡事項には専用プロンプト（`ai_api/src/announcements.ts`）を使います。
学生の進捗報告と自動で分類する仕組みではないため、録音前に対象を選んでください。
要約はesaの既存の「連絡事項」欄に反映し、学生の欄には入れません。
AI生成部分は `<!-- lab-note:announcements:start -->` と
`<!-- lab-note:announcements:end -->` で囲み、再送時はその範囲だけ置き換えます。
esa上で手書きの内容を残したい場合は、この目印の外に記入してください。
目印や連絡事項の見出しが壊れている場合は更新を中止します。

Node.js 24で、外部通信・AI利用・esa投稿を行わずにテストできます。

```bash
pnpm --filter ./ai_api test
```

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
変更後はAI・esa用Workerを再起動し、Web画面を再読み込みします。

既存の報告会にメンバーを追加するだけなら、RustFS署名用Workerの変更や
メンバー用フォルダの作成は不要です。新しい報告会自体を増やす場合は、
画面の選択肢・保存先の対応表・RustFS側の許可設定なども別途変更する必要があります。

## 年度更新・メンバーの入れ替え

このアプリは、個人進捗報告を録音日の年度カテゴリから検索します。年度が変わるときは、
esa側のカテゴリとアプリ内のメンバー情報を両方更新してください。年度は録音日の年から
自動で決まるため、ソースコードに年度を直接書き換える必要はありません。

### 1. esaに新年度のカテゴリを用意する

esaの個人進捗報告に、その年度のカテゴリを作成し、各記事が次の階層になることを確認します。

```text
1.進捗報告(個人)/<年度>年度/<学年カテゴリ>/<話者名>/<月>/<日>
```

`<学年カテゴリ>` はesa上の実際のカテゴリ名を使います。カテゴリ名の先頭に番号が付く場合も、
番号を含めた実際の名称で登録してください。記事本文の末尾にタイトルなどのカテゴリが
追加されていても構いません。検索は学年・話者・月・日が一致する記事を選びます。

### 2. 新年度のメンバー一覧を決める

担当者間で、アプリで使う話者IDと学年を確定します。esaカテゴリ内の話者名も同じ表記にします。
現在の自動参照が認識する学年カテゴリは `B3`、`B4`、`M1`、`M2` です。

### 3. アプリとWorkerの名簿を更新する

同じ話者IDを、所属する会議の一覧とテンプレートに登録します。

| ファイル・定義 | 更新内容 |
| --- | --- |
| `app/front/script.js` の `meetingGroups` | 画面に表示する会議ごとのメンバーを更新 |
| `ai_api/src/index.ts` の `SPEAKERS` | 各会議で受け付ける話者を更新 |
| 同ファイルの `TEMPLATES` | 出席者リストの学年区分と個人進捗欄を更新 |
| 同ファイルの `SPEAKER_GRADES` | 各話者IDを `B3` / `B4` / `M1` / `M2` に対応づける |

卒業・進級した人は旧学年から外し、新しい学年へ移します。複数の報告会に参加する人は、
参加するすべての `meetingGroups` と `SPEAKERS` に登録します。個人進捗欄の見出しは
`## **話者ID**` とし、終端の `<br>` まで含めてください。

`SPEAKER_GRADES` に話者IDがないと、その人の自動参照は「学年区分が登録されていません」
となります。esaカテゴリ内の話者名・学年・録音日が合わない場合は、該当記事が見つからず、
個人発表用esaなしで議事録処理が続きます。名前の大文字小文字やハイフンも含めて揃えてください。

### 4. 動作を確認する

1. 新年度の日付で対象者を選び、esaの個人進捗報告記事がある状態で一件処理します。
2. AI・esa用Workerのログで `esa発表資料の取得結果` を確認します。`grade`、記事名、URL、
   `contentLength` が表示され、`error=なし` になっていることを確認します。
3. 生成された議事録に個人進捗報告の内容が反映されていることを確認します。
4. 記事が見つからない場合は、録音日とesaカテゴリの日付、話者ID、学年カテゴリを照合します。
   必要な場合は画面の「個人発表用esa URL」欄に記事URLを指定して参照できます。

変更後はAI・esa用Workerを起動しているターミナルで `Ctrl+C` を押して停止し、次のように再起動します。

```bash
pnpm dev:ai
```

その後、Web画面を再読み込みしてください。既存のesa議事録の出席者欄や個人欄は自動更新されないため、
必要ならesa上の記事も手動で更新します。
