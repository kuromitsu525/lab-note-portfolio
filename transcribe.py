import whisper

print("Whisperを読み込み中...")
model = whisper.load_model("base")

print("文字起こし開始...")
result = model.transcribe(
    "sample.mp4",
    language="ja"
)

print("\n===== 文字起こし結果 =====\n")
print(result["text"])