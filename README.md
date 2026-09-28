# Lab Note

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

## ローカルKotoba-Whisperの起動

プロジェクトのルートで次を実行します。

```bash
./start-local-whisper.sh
```

初回起動ではMetalの準備に時間がかかることがあります。次の表示が出てから
Lab Noteを開いてください。

```text
whisper server listening at http://0.0.0.0:53102
```

Lab Noteはマイク音声を16kHz PCMへ変換し、約6秒ごとのWAVデータとして
ローカルサーバーへ送信します。録音停止時には残りの音声の処理完了を待ってから、
報告者の文字起こしを保存します。

音声区間の境界で単語が欠けにくいよう、各区間には直前約1秒の音声を重ねます。
重なった部分の文字列は、画面へ追加するときに可能な範囲で除去します。

サーバーを停止する場合は、起動したターミナルで `Ctrl+C` を押します。
