#!/bin/zsh

set -e

SCRIPT_DIRECTORY="${0:A:h}"
WHISPER_DIRECTORY="${SCRIPT_DIRECTORY}/vendor/whisper.cpp"
SERVER_BINARY="${WHISPER_DIRECTORY}/build/bin/whisper-server"
MODEL_FILE="${WHISPER_DIRECTORY}/models/ggml-kotoba-whisper-v2.0-q5_0.bin"

if [[ ! -x "${SERVER_BINARY}" ]]; then
    echo "whisper-serverが見つかりません。先にwhisper.cppをビルドしてください。"
    exit 1
fi

if [[ ! -f "${MODEL_FILE}" ]]; then
    echo "Kotoba-Whisperモデルが見つかりません。"
    exit 1
fi

cd "${WHISPER_DIRECTORY}"

exec "${SERVER_BINARY}" \
    --host 0.0.0.0 \
    --port 53102 \
    --model "${MODEL_FILE}" \
    --language ja \
    --threads 4 \
    --flash-attn
