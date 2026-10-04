#!/bin/bash
# Speech-to-text for the parent's voice replies: whisper.cpp + models, all local.
# Safe to run again; it only fetches what is missing.
#
#   ./scripts/install-stt.sh
#
# The worker looks for /opt/homebrew/bin/whisper-cli, /opt/homebrew/bin/ffmpeg
# and the two models below (override with WHISPER_BIN, FFMPEG_BIN,
# WHISPER_MODEL, WHISPER_VAD_MODEL in ~/.trackbyphoto/worker.env).
set -euo pipefail

MODELS="$HOME/.trackbyphoto/models"
mkdir -p "$MODELS"

command -v whisper-cli >/dev/null || brew install whisper-cpp
command -v ffmpeg >/dev/null || brew install ffmpeg

fetch() {
  [ -f "$MODELS/$1" ] && return
  echo "Downloading $1..."
  curl -L --fail -o "$MODELS/$1.part" "$2" && mv "$MODELS/$1.part" "$MODELS/$1"
}
# large-v3-turbo: about 1.5 s per reply on the Mac mini, and clearly better
# at Korean than the small model.
fetch ggml-large-v3-turbo.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
fetch ggml-silero-v5.1.2.bin  https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin

echo "Speech-to-text ready: $(command -v whisper-cli), models in $MODELS"
