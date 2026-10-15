# Lab Note

## 初回セットアップ

### 1. whisper.cppとKotoba-Whisper

`whisper.cpp`本体、ビルド結果、Kotoba-Whisperモデルは容量が大きいため、
GitHubには含まれていません。初めて使用するPCでは、プロジェクトのルートで
次の準備が必要です。

必要なコマンドは`git`、`cmake`、`curl`です。

#### whisper.cppの取得

```bash
git clone https://github.com/ggml-org/whisper.cpp.git vendor/whisper.cpp
git -C vendor/whisper.cpp checkout --detach 1da4dc82fa7996d4edda05890dca65aeceaafd6d
```

他のPCでも同じ実装を使うため、取得後に下記の確認済みコミットへそろえます。

#### whisper-serverのビルド

```bash
cmake -S vendor/whisper.cpp -B vendor/whisper.cpp/build
cmake --build vendor/whisper.cpp/build --config Release -j
```

#### Kotoba-Whisperモデルのダウンロード

```bash
curl -L https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0-ggml/resolve/main/ggml-kotoba-whisper-v2.0-q5_0.bin -o vendor/whisper.cpp/models/ggml-kotoba-whisper-v2.0-q5_0.bin
```

次の2ファイルが作成されていれば準備完了です。

```text
vendor/whisper.cpp/build/bin/whisper-server
vendor/whisper.cpp/models/ggml-kotoba-whisper-v2.0-q5_0.bin
```

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
git -C vendor/whisper.cpp rev-parse HEAD
git -C vendor/whisper.cpp status --short
shasum -a 256 vendor/whisper.cpp/models/ggml-kotoba-whisper-v2.0-q5_0.bin
```

`rev-parse HEAD` の結果は上記コミットIDと比較します。
`status --short` が何も表示しなければ、本体のソースにローカル変更はありません。
`shasum` の結果は、ファイル名の前に表示されるハッシュ値を上記SHA-256と比較します。
Linuxでは `shasum -a 256` の代わりに `sha256sum` も使えます。

既に別の版を取得している場合は、本体の変更を確認・退避してから、次の手順で
コミットをそろえて再ビルドしてください。コミットを変えるだけでは、以前に
ビルドした実行ファイルは更新されません。Whisperサーバーは停止してから作業します。

```bash
git -C vendor/whisper.cpp fetch origin
git -C vendor/whisper.cpp checkout --detach 1da4dc82fa7996d4edda05890dca65aeceaafd6d
cmake -S vendor/whisper.cpp -B vendor/whisper.cpp/build
cmake --build vendor/whisper.cpp/build --config Release -j
```

モデルのSHA-256が異なる場合は、ダウンロードした版・量子化形式が同じか、
ダウンロードが完了しているかを確認してください。ファイル名が同じでも、
中身が同じとは限りません。上のダウンロードURLは `main` を参照するため、
取得後に必ずハッシュ値も確認してください。

Webアプリで使うモデルは `start-local-whisper.sh` の `MODEL_FILE` で指定しています。
`transcribe.py` のPython版Whisper（`base`）とは別の処理です。
本体とモデルが一致しても、マイク・入力設定・周囲の雑音・ビルド環境によって
文字起こしの結果は変わることがあります。

### 2. Workerの依存関係

```bash
npm --prefix worker/lab-note-worker install
```

```bash
npx --yes pnpm@11.20.0 --dir workers-ai-test install --frozen-lockfile
```

AI・esa用Workerは `pnpm-lock.yaml` の版を再現するため、上記のpnpmで導入します。
起動は以下の `npm run dev` で構いません。

各Workerの`.dev.vars.example`を参考に、ローカル専用の`.dev.vars`を用意します。
実際のアクセスキーやトークンをGitHubへコミットしないでください。

## ローカル起動

開発時は3つのターミナルで、それぞれ次を起動します。

### ローカルKotoba-Whisper（ポート53102）

```bash
./start-local-whisper.sh
```

### RustFS署名用Worker（ポート53103）

```bash
cd worker/lab-note-worker
npm run dev
```

### AI要約・esa反映用Worker（ポート53104）

```bash
cd workers-ai-test
npm run dev
```

Web画面はLive Serverの `http://127.0.0.1:53101` で開きます。

「保存してAI要約」後の進み具合は、報告状況に表示します。
AI処理の受付・生成、esaへの投稿を確認でき、失敗時は「アップロード失敗」
「AI処理失敗」「esa投稿失敗」などに表示が変わり、詳しい理由も表示します。
「esa投稿済み ↗」から記事を新しいタブで開けます。
報告状況上部の「記録をリセット」は、確認後にブラウザ内の全報告会の記録を消去します。
RustFSとesaに保存済みのデータは削除しません。

## AIサーバーが停止した場合

AI・esa用WorkerのWranglerは `4.147.0` に固定しています。
既存の `pnpm-lock.yaml` に合わせて依存関係を更新する場合は、
`workers-ai-test` 内で `npx --yes pnpm@11.20.0 install --frozen-lockfile` を実行してください。
更新前から起動しているWorkerは `Ctrl+C` で終了し、`npm run dev` で起動し直します。

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

## Kotoba-Whisperの確認

プロジェクトのルートで次を実行します。

```bash
./start-local-whisper.sh
```

初回起動ではMetalの準備に時間がかかることがあります。次の表示が出てから
Lab Noteを開いてください。

```text
whisper server listening at http://0.0.0.0:53102
```

Lab Noteはマイク音声を16kHz PCMへ変換し、約8秒ごとのWAVデータとして
ローカルサーバーへ送信します。録音停止時には残りの音声の処理完了を待ってから、
報告者の文字起こしを保存します。

音声区間の境界で単語が欠けにくいよう、各区間には直前約1秒の音声を重ねます。
重なった部分の文字列は、画面へ追加するときに可能な範囲で除去します。

サーバーを停止する場合は、起動したターミナルで `Ctrl+C` を押します。

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
| `script.js` の `meetingGroups` | 画面に表示する会議ごとのメンバーを更新 |
| `workers-ai-test/src/index.ts` の `SPEAKERS` | 各会議で受け付ける話者を更新 |
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
cd workers-ai-test
npm run dev
```

その後、Web画面を再読み込みしてください。既存のesa議事録の出席者欄や個人欄は自動更新されないため、
必要ならesa上の記事も手動で更新します。
