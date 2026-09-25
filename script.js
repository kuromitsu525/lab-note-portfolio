// ============================================================
// HTML要素
// ============================================================

const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const timer = document.getElementById("timer");
const audioArea = document.getElementById("audioArea");
const transcriptionResult = document.getElementById("transcriptionResult");
const transcript = document.getElementById("transcript");
const generateButton = document.getElementById("generateButton");
const meetingGroup = document.getElementById("meetingGroup");
const memberButtons = document.getElementById("memberButtons");
const selectedSpeaker = document.getElementById("selectedSpeaker");
const reportList = document.getElementById("reportList");
const clearDraftButton = document.getElementById("clearDraftButton");


// ============================================================
// 報告会・報告者データ
// ============================================================

const meetingGroups = {
    "3年セミナー": [
        "machida", "rinya", "onogi", "yuga", "kuro", "yoshitomo",
        "nao", "yu-dai", "sana", "sawaki", "honoka", "kazuma"
    ],
    "HCI班": ["fuseya", "seiken", "niwa", "taku", "machida"],
    "HAR班": ["gomamono", "tada", "nakamura", "enami", "tatsunari"],
    "LBS班": ["hayashi", "natsuki", "ryuki", "hiroto", "hanada", "kakeru"]
};

const rustFsGroupNames = {
    "3年セミナー": "seminar3",
    "HCI班": "hci",
    "HAR班": "har",
    "LBS班": "lbs"
};

const workerBaseURL = `http://${location.hostname || "127.0.0.1"}:8787`;

// 録音停止後、議事録生成まで一時的に保持するデータ
const reportRecords = new Map();

let activeSpeaker = "";
let currentReportSegment = null;
let savedMeetingData = null;

const reportDatabaseName = "lab-note-draft";
const reportStoreName = "meeting-state";


// ============================================================
// リロード対策（音声Blobを含む一時データをIndexedDBへ保存）
// ============================================================

function openReportDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(reportDatabaseName, 1);

        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(reportStoreName)) {
                request.result.createObjectStore(reportStoreName);
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveDraftToBrowser() {
    try {
        const database = await openReportDatabase();
        const transaction = database.transaction(reportStoreName, "readwrite");
        const store = transaction.objectStore(reportStoreName);

        store.put({
            selectedGroup: meetingGroup.value,
            records: Array.from(reportRecords.entries())
        }, "current-draft");

        await new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });

        database.close();
    } catch (error) {
        console.error("一時データの保存に失敗しました:", error);
    }
}

async function restoreDraftFromBrowser() {
    try {
        const database = await openReportDatabase();
        const transaction = database.transaction(reportStoreName, "readonly");
        const request = transaction.objectStore(reportStoreName).get("current-draft");

        const draft = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        database.close();

        if (!draft) {
            return;
        }

        reportRecords.clear();
        draft.records.forEach(([key, segments]) => {
            reportRecords.set(key, segments);
        });

        if (meetingGroups[draft.selectedGroup]) {
            meetingGroup.value = draft.selectedGroup;
        }

        renderMemberButtons();
        console.log("一時保存された報告データを復元しました");
    } catch (error) {
        console.error("一時データの復元に失敗しました:", error);
    }
}

async function clearDraftFromBrowser() {
    try {
        const database = await openReportDatabase();
        const transaction = database.transaction(reportStoreName, "readwrite");
        transaction.objectStore(reportStoreName).delete("current-draft");

        await new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });

        database.close();
    } catch (error) {
        console.error("一時データの削除に失敗しました:", error);
        throw error;
    }
}


// ============================================================
// 録音関連
// ============================================================

let mediaRecorder = null;
let audioChunks = [];
let mediaRecorderProcessingPromise = Promise.resolve();


// ============================================================
// リアルタイム文字起こし関連
// ============================================================

let isCompletingTranscription = false;

const localWhisperBaseURL = `http://${location.hostname}:8080`;
const localWhisperChunkMilliseconds = 8000;
const localWhisperOverlapSamples = 16000;
// ほぼ無音の区間をWhisperへ送らず、無音時の定型文の誤生成を抑える
const localWhisperSilenceRmsThreshold = 0.002;
const localWhisperSilencePeakThreshold = 0.015;

let localPcmChunks = [];
let localPcmOverlap = new Int16Array(0);
let localInferenceTimer = null;
let localInferenceQueue = Promise.resolve();
let localTranscriptionError = null;

let audioContext = null;
let mediaStreamSource = null;
let scriptProcessor = null;
let microphoneStream = null;


// ============================================================
// 文字起こし状態
// ============================================================

// 現在の録音区間の文字起こし
let finalTranscript = "";


// ============================================================
// 状態
// ============================================================

let isRecording = false;

let timerInterval = null;
let elapsedSeconds = 0;


// ============================================================
// 初期状態
// ============================================================

transcript.value = "";

generateButton.disabled = true;

stopButton.disabled = true;

startButton.disabled = true;


// ============================================================
// 報告者選択・報告データ表示
// ============================================================

function getReportKey(group, speaker) {
    return `${group}::${speaker}`;
}

function getSpeakerSegments(group, speaker) {
    return reportRecords.get(getReportKey(group, speaker)) || [];
}

function getSavedTranscript(group, speaker) {
    return getSpeakerSegments(group, speaker)
        .map(segment => segment.text)
        .filter(Boolean)
        .join("\n\n");
}

function hasReportData(group) {
    return Boolean(group) && meetingGroups[group].some(
        speaker => getSpeakerSegments(group, speaker).length > 0
    );
}

function getJapanDateString(value = new Date()) {
    return new Date(value).toLocaleDateString("sv-SE", {
        timeZone: "Asia/Tokyo"
    });
}

async function requestRustFsSignedUrl(payload) {
    const response = await fetch(`${workerBaseURL}/api/rustfs/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.url) {
        throw new Error(result.error || `署名URLの取得に失敗しました（HTTP ${response.status}）`);
    }

    return result;
}

async function getNextRustFsFileNumber({ group, date, speaker, kind }) {
    const listTarget = await requestRustFsSignedUrl({
        operation: "list",
        group,
        date,
        speaker,
        kind
    });
    const response = await fetch(listTarget.url);

    if (!response.ok) {
        throw new Error(`既存ファイルの確認に失敗しました（HTTP ${response.status}）`);
    }

    const document = new DOMParser().parseFromString(await response.text(), "application/xml");
    if (document.querySelector("parsererror")) {
        throw new Error("RustFSのファイル一覧を読み取れませんでした。");
    }

    const prefix = `${group}/${date}/${speaker}_${kind}_`;
    const numbers = Array.from(document.getElementsByTagName("Key"))
        .map(element => element.textContent || "")
        .filter(key => key.startsWith(prefix))
        .map(key => key.slice(prefix.length).match(/^(\d+)\./)?.[1])
        .filter(Boolean)
        .map(Number);

    return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

async function uploadFileToRustFs({
    meetingGroupName,
    date,
    speaker,
    kind,
    extension,
    blob
}) {
    const group = rustFsGroupNames[meetingGroupName];
    if (!group) {
        throw new Error("RustFSの保存先に対応していない報告会です。");
    }

    const number = await getNextRustFsFileNumber({ group, date, speaker, kind });
    const uploadTarget = await requestRustFsSignedUrl({
        operation: "put",
        group,
        date,
        speaker,
        kind,
        extension,
        number
    });
    const response = await fetch(uploadTarget.url, {
        method: "PUT",
        headers: { "Content-Type": blob.type || "application/octet-stream" },
        body: blob
    });

    if (!response.ok) {
        throw new Error(`RustFSへのアップロードに失敗しました（HTTP ${response.status}）`);
    }

    return uploadTarget.key;
}

function renderReportList() {
    const group = meetingGroup.value;

    if (!group) {
        reportList.classList.add("report-list-empty");
        reportList.textContent = "報告会を選択してください";
        return;
    }

    reportList.classList.remove("report-list-empty");
    reportList.innerHTML = "";

    meetingGroups[group].forEach(speaker => {
        const segments = getSpeakerSegments(group, speaker);
        const item = document.createElement("div");
        const name = document.createElement("strong");
        const text = document.createElement("p");
        const detailsButton = document.createElement("button");

        item.className = "report-item";
        name.textContent = `${speaker}：${segments.length > 0 ? "録音済み" : "未録音"}`;
        text.className = "report-details";
        text.textContent = getSavedTranscript(group, speaker) || "文字起こしはまだありません";
        text.hidden = true;

        detailsButton.type = "button";
        detailsButton.className = "details-button";
        detailsButton.textContent = "詳細を見る";
        detailsButton.addEventListener("click", () => {
            text.hidden = !text.hidden;
            detailsButton.textContent = text.hidden ? "詳細を見る" : "詳細を閉じる";
        });

        item.appendChild(name);

        if (segments.length > 0) {
            item.appendChild(detailsButton);
            item.appendChild(text);
        }

        reportList.appendChild(item);
    });
}

function selectSpeaker(speaker) {
    if (isRecording) {
        return;
    }

    activeSpeaker = speaker;
    selectedSpeaker.textContent = `選択中の報告者：${speaker}`;
    transcript.value = getSavedTranscript(meetingGroup.value, speaker);
    startButton.disabled = false;

    memberButtons.querySelectorAll("button").forEach(button => {
        button.classList.toggle("active", button.dataset.speaker === speaker);
    });
}

function renderMemberButtons() {
    const group = meetingGroup.value;

    memberButtons.innerHTML = "";
    activeSpeaker = "";
    selectedSpeaker.textContent = "報告者を選択してください";
    transcript.value = "";
    startButton.disabled = true;

    if (group) {
        meetingGroups[group].forEach(speaker => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = speaker;
            button.dataset.speaker = speaker;
            button.addEventListener("click", () => selectSpeaker(speaker));
            memberButtons.appendChild(button);
        });
    }

    renderReportList();
    generateButton.disabled = !hasReportData(group);
}

meetingGroup.addEventListener("change", () => {
    renderMemberButtons();
    saveDraftToBrowser();
});
restoreDraftFromBrowser();

clearDraftButton.addEventListener("click", async () => {
    const shouldClear = confirm(
        "現在の録音と文字起こしデータをすべて削除して、新しい報告会を開始しますか？"
    );

    if (!shouldClear) {
        return;
    }

    clearDraftButton.disabled = true;

    try {
        await clearDraftFromBrowser();

        reportRecords.clear();
        savedMeetingData = null;
        activeSpeaker = "";
        currentReportSegment = null;
        finalTranscript = "";

        meetingGroup.value = "";
        transcript.value = "";
        timer.textContent = "00:00";
        elapsedSeconds = 0;
        audioArea.innerHTML = "";

        renderMemberButtons();
        generateButton.disabled = true;
        alert("保存していたデータを削除しました。");
    } catch (error) {
        alert("データを削除できませんでした。もう一度お試しください。");
    } finally {
        clearDraftButton.disabled = false;
    }
});


// ============================================================
// 保存用録音形式
// ============================================================

function getSupportedMimeType() {

    const mimeTypes = [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus"
    ];

    for (const mimeType of mimeTypes) {

        if (MediaRecorder.isTypeSupported(mimeType)) {
            return mimeType;
        }

    }

    return "";
}


// ============================================================
// Float32 → PCM 16bit
// ============================================================

function convertFloat32ToInt16(float32Array) {

    const buffer = new ArrayBuffer(
        float32Array.length * 2
    );

    const output = new DataView(buffer);

    for (let i = 0; i < float32Array.length; i++) {

        let sample = float32Array[i];

        sample = Math.max(
            -1,
            Math.min(1, sample)
        );

        const int16 =
            sample < 0
                ? sample * 0x8000
                : sample * 0x7FFF;

        output.setInt16(
            i * 2,
            int16,
            true
        );
    }

    return buffer;
}


// ============================================================
// リサンプリング
//
// マイク入力を16kHzへ変換
// ============================================================

function resampleAudio(
    input,
    inputSampleRate,
    outputSampleRate
) {

    if (inputSampleRate === outputSampleRate) {
        return input;
    }

    const ratio =
        inputSampleRate / outputSampleRate;

    const outputLength =
        Math.round(input.length / ratio);

    const output =
        new Float32Array(outputLength);

    let outputIndex = 0;
    let inputIndex = 0;

    while (outputIndex < output.length) {

        const nextInputIndex =
            Math.round(
                (outputIndex + 1) * ratio
            );

        let accumulator = 0;
        let count = 0;

        for (
            let i = inputIndex;
            i < nextInputIndex &&
            i < input.length;
            i++
        ) {

            accumulator += input[i];

            count++;
        }

        output[outputIndex] =
            count > 0
                ? accumulator / count
                : 0;

        outputIndex++;

        inputIndex = nextInputIndex;
    }

    return output;
}


// ============================================================
// 画面の文字起こし表示を更新
// ============================================================

function updateTranscriptDisplay() {

    const previousText = activeSpeaker
        ? getSavedTranscript(meetingGroup.value, activeSpeaker)
        : "";

    const currentText = finalTranscript.trim();


    transcript.value = [previousText, currentText]
        .filter(Boolean)
        .join("\n\n");

    // 最新の文字起こしが見えるように欄内を一番下へ移動
    transcript.scrollTop = transcript.scrollHeight;


    // 確定文字が存在したら
    // 議事録生成ボタンを有効化

    generateButton.disabled =
        isRecording || currentReportSegment !== null || (
            !hasReportData(meetingGroup.value) &&
            finalTranscript.trim().length === 0
        );
}



// ============================================================
// ローカル whisper.cpp + Kotoba-Whisper
// ============================================================

async function connectToLocalWhisper() {
    const response = await fetch(`${localWhisperBaseURL}/health`, {
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error(`ローカルWhisperが利用できません（HTTP ${response.status}）`);
    }

    console.log("ローカルKotoba-Whisper接続成功");
}

function createPcmWavBlob(chunks, sampleRate = 16000) {
    const sampleLength = chunks.reduce(
        (total, chunk) => total + chunk.length,
        0
    );
    const buffer = new ArrayBuffer(44 + sampleLength * 2);
    const view = new DataView(buffer);

    const writeText = (offset, value) => {
        for (let index = 0; index < value.length; index++) {
            view.setUint8(offset + index, value.charCodeAt(index));
        }
    };

    writeText(0, "RIFF");
    view.setUint32(4, 36 + sampleLength * 2, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, sampleLength * 2, true);

    let outputIndex = 44;
    chunks.forEach(chunk => {
        for (let index = 0; index < chunk.length; index++) {
            view.setInt16(outputIndex, chunk[index], true);
            outputIndex += 2;
        }
    });

    return new Blob([buffer], { type: "audio/wav" });
}

function getTrailingPcmSamples(chunks, sampleCount) {
    const totalLength = chunks.reduce(
        (total, chunk) => total + chunk.length,
        0
    );
    const outputLength = Math.min(totalLength, sampleCount);
    const output = new Int16Array(outputLength);
    let writeIndex = outputLength;

    for (let index = chunks.length - 1; index >= 0 && writeIndex > 0; index--) {
        const chunk = chunks[index];
        const copyLength = Math.min(chunk.length, writeIndex);
        const sourceStart = chunk.length - copyLength;
        writeIndex -= copyLength;
        output.set(chunk.subarray(sourceStart), writeIndex);
    }

    return output;
}

function containsAudibleAudio(chunks) {
    let sampleCount = 0;
    let squaredTotal = 0;
    let peak = 0;

    chunks.forEach(chunk => {
        for (let index = 0; index < chunk.length; index++) {
            const normalizedSample = Math.abs(chunk[index]) / 32768;
            squaredTotal += normalizedSample * normalizedSample;
            peak = Math.max(peak, normalizedSample);
            sampleCount++;
        }
    });

    if (sampleCount === 0) {
        return false;
    }

    const rms = Math.sqrt(squaredTotal / sampleCount);
    return rms >= localWhisperSilenceRmsThreshold ||
        peak >= localWhisperSilencePeakThreshold;
}

function removeTranscriptOverlap(previousText, newText) {
    const maximumLength = Math.min(previousText.length, newText.length, 80);

    for (let length = maximumLength; length >= 3; length--) {
        if (previousText.slice(-length) === newText.slice(0, length)) {
            return newText.slice(length).trim();
        }
    }

    return newText;
}

function queueLocalWhisperInference() {
    if (localPcmChunks.length === 0) {
        return localInferenceQueue;
    }

    const newChunks = localPcmChunks;
    localPcmChunks = [];

    // 無音だけの区間はWhisperが定型表現を作ることがあるため送信しない
    if (!containsAudibleAudio(newChunks)) {
        localPcmOverlap = new Int16Array(0);
        console.log("ほぼ無音のため文字起こしを省略しました");
        return localInferenceQueue;
    }

    const chunks = localPcmOverlap.length > 0
        ? [localPcmOverlap, ...newChunks]
        : newChunks;

    localPcmOverlap = getTrailingPcmSamples(
        chunks,
        localWhisperOverlapSamples
    );

    const inferenceTask = localInferenceQueue.then(async () => {
        const formData = new FormData();
        formData.append("file", createPcmWavBlob(chunks), "audio.wav");
        formData.append("language", "ja");
        formData.append("response_format", "json");
        formData.append("temperature", "0.0");
        formData.append("no_timestamps", "true");
        formData.append("suppress_non_speech", "true");

        const response = await fetch(
            `${localWhisperBaseURL}/inference`,
            { method: "POST", body: formData }
        );

        if (!response.ok) {
            throw new Error(`文字起こしに失敗しました（HTTP ${response.status}）`);
        }

        const result = await response.json();
        const text = result.text?.trim();

        if (text) {
            const textWithoutOverlap = removeTranscriptOverlap(
                finalTranscript.trim(),
                text
            );

            finalTranscript = [finalTranscript.trim(), textWithoutOverlap]
                .filter(Boolean)
                .join(" ");
            updateTranscriptDisplay();
        }
    });

    localInferenceQueue = inferenceTask.catch(error => {
        localTranscriptionError = error;
        console.error("ローカル文字起こしエラー:", error);
    });

    return inferenceTask;
}


// ============================================================
// PCM音声送信開始
// ============================================================

function startPCMStreaming(stream) {

    microphoneStream =
        stream;


    audioContext =
        new AudioContext();


    console.log(
        "ブラウザのAudioContext:",
        audioContext.sampleRate,
        "Hz"
    );


    mediaStreamSource =
        audioContext.createMediaStreamSource(
            stream
        );


    scriptProcessor =
        audioContext.createScriptProcessor(
            4096,
            1,
            1
        );


    scriptProcessor.onaudioprocess =
        (event) => {

            if (
                !isRecording
            ) {

                return;
            }


            const inputData =
                event
                    .inputBuffer
                    .getChannelData(0);


            // 16kHzへ変換

            const resampled =
                resampleAudio(
                    inputData,
                    audioContext.sampleRate,
                    16000
                );


            // PCM16へ変換

            const pcmData =
                convertFloat32ToInt16(
                    resampled
                );


            // 約8秒ごとにローカルWhisperへ送るため一時保持
            localPcmChunks.push(new Int16Array(pcmData));

        };


    mediaStreamSource.connect(
        scriptProcessor
    );


    scriptProcessor.connect(
        audioContext.destination
    );


    console.log(
        "ローカル文字起こし用PCM音声の収集を開始しました"
    );

    localInferenceTimer = setInterval(() => {
        queueLocalWhisperInference().catch(() => {});
    }, localWhisperChunkMilliseconds);

}


// ============================================================
// PCMストリーミング停止
// ============================================================

function stopPCMStreaming() {

    console.log(
        "PCMストリーミングを停止します..."
    );

    if (localInferenceTimer) {
        clearInterval(localInferenceTimer);
        localInferenceTimer = null;
    }


    if (scriptProcessor) {

        scriptProcessor.disconnect();

        scriptProcessor.onaudioprocess =
            null;

        scriptProcessor = null;
    }


    if (mediaStreamSource) {

        mediaStreamSource.disconnect();

        mediaStreamSource = null;
    }


    if (audioContext) {

        audioContext.close();

        audioContext = null;
    }


    if (microphoneStream) {

        microphoneStream
            .getTracks()
            .forEach(
                track => track.stop()
            );

        microphoneStream = null;
    }

}


// ============================================================
// 保存用録音停止
// ============================================================

function stopMediaRecorder() {

    if (
        mediaRecorder &&
        mediaRecorder.state !==
        "inactive"
    ) {

        mediaRecorder.stop();

    }

}


// ============================================================
// 録音開始
// ============================================================

startButton.addEventListener(
    "click",
    async () => {

        try {

            if (!meetingGroup.value || !activeSpeaker) {
                alert("報告会と報告者を選択してください。");
                return;
            }

            const reportGroup = meetingGroup.value;
            const reportSpeaker = activeSpeaker;

            startButton.disabled = true;
            clearDraftButton.disabled = true;
            meetingGroup.disabled = true;
            memberButtons.querySelectorAll("button").forEach(button => {
                button.disabled = true;
            });

            console.log(
                "録音を開始します..."
            );


            // ------------------------------------------------
            // 文字起こし状態をリセット
            // ------------------------------------------------

            finalTranscript = "";

            localPcmChunks = [];
            localPcmOverlap = new Int16Array(0);
            localInferenceQueue = Promise.resolve();
            localTranscriptionError = null;

            transcript.value = "";

            generateButton.disabled =
                true;


            // ------------------------------------------------
            // マイク取得
            // ------------------------------------------------

            const stream =
                await navigator.mediaDevices
                    .getUserMedia({
                        audio: {
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        }
                    });


            // ------------------------------------------------
            // 保存用MediaRecorder
            // ------------------------------------------------

            const mimeType =
                getSupportedMimeType();


            console.log(
                "保存用録音形式:",
                mimeType
            );


            if (mimeType) {

                mediaRecorder =
                    new MediaRecorder(
                        stream,
                        {
                            mimeType:
                                mimeType
                        }
                    );

            } else {

                mediaRecorder =
                    new MediaRecorder(
                        stream
                    );

            }


            audioChunks = [];

            currentReportSegment = {
                id: crypto.randomUUID(),
                group: reportGroup,
                speaker: reportSpeaker,
                text: "",
                startedAt: new Date().toISOString(),
                endedAt: null,
                durationSeconds: 0,
                audioBlob: null,
                audioMimeType: "",
                cancelled: false
            };

            const reportSegment = currentReportSegment;
            let finishMediaRecorderProcessing;
            mediaRecorderProcessingPromise = new Promise(resolve => {
                finishMediaRecorderProcessing = resolve;
            });


            mediaRecorder.addEventListener(
                "dataavailable",
                (event) => {

                    if (
                        event.data.size > 0
                    ) {

                        audioChunks.push(
                            event.data
                        );

                    }

                }
            );


            // ------------------------------------------------
            // 録音停止時
            // ------------------------------------------------

            mediaRecorder.addEventListener(
                "stop",
                async () => {

                    try {

                    const actualMimeType =
                        mediaRecorder.mimeType ||
                        mimeType ||
                        "audio/webm";


                    const audioBlob =
                        new Blob(
                            audioChunks,
                            {
                                type:
                                    actualMimeType
                            }
                        );

                    if (reportSegment.cancelled) {
                        return;
                    }


                    console.log(
                        "保存用録音形式:",
                        actualMimeType
                    );


                    console.log(
                        "録音データサイズ:",
                        audioBlob.size,
                        "bytes"
                    );

                    // 録音データは各録音の停止時点で保存する
                    let extension = "webm";
                    if (actualMimeType.includes("mp4")) {
                        extension = "mp4";
                    } else if (actualMimeType.includes("ogg")) {
                        extension = "ogg";
                    }

                    const recordingDate = getJapanDateString(reportSegment.startedAt);

                    // アップロードが失敗しても再送できるようブラウザ内にも保持する
                    reportSegment.audioBlob = audioBlob;
                    reportSegment.audioMimeType = actualMimeType;
                    reportSegment.audioUploadStatus = "uploading";
                    reportSegment.audioStorageKey = "";

                    const key = getReportKey(
                        reportSegment.group,
                        reportSegment.speaker
                    );
                    const segments = reportRecords.get(key) || [];
                    segments.push(reportSegment);
                    reportRecords.set(key, segments);
                    await saveDraftToBrowser();

                    try {
                        reportSegment.audioStorageKey = await uploadFileToRustFs({
                            meetingGroupName: reportSegment.group,
                            date: recordingDate,
                            speaker: reportSegment.speaker,
                            kind: "audio",
                            extension,
                            blob: audioBlob
                        });
                        reportSegment.audioUploadStatus = "uploaded";
                        console.log(
                            "RustFSへ音声を保存しました:",
                            reportSegment.audioStorageKey
                        );
                    } catch (error) {
                        reportSegment.audioUploadStatus = "failed";
                        console.error("音声のRustFSアップロードに失敗しました:", error);
                        alert(
                            "音声をRustFSへアップロードできませんでした。" +
                            "データはブラウザ内に残っています。" +
                            `\n詳細: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                    await saveDraftToBrowser();


                    // ----------------------------------------
                    // 音声再生
                    // ----------------------------------------

                    const audioURL =
                        URL.createObjectURL(
                            audioBlob
                        );


                    const audio =
                        document.createElement(
                            "audio"
                        );


                    audio.controls = true;

                    audio.src =
                        audioURL;


                    audioArea.innerHTML =
                        "";

                    audioArea.appendChild(
                        audio
                    );


                    if (!isCompletingTranscription) {
                        currentReportSegment = null;
                        finalTranscript = "";
                        renderReportList();
                        updateTranscriptDisplay();
                        startButton.disabled = false;
                        clearDraftButton.disabled = false;
                        meetingGroup.disabled = false;
                        memberButtons.querySelectorAll("button").forEach(button => {
                            button.disabled = false;
                        });
                    }


                    console.log(
                        "録音処理が完了しました"
                    );

                    } finally {
                        finishMediaRecorderProcessing();
                    }

                }
            );


            // ------------------------------------------------
            // ローカルKotoba-Whisper接続確認
            // ------------------------------------------------

            await connectToLocalWhisper();


            // ------------------------------------------------
            // PCM送信開始
            // ------------------------------------------------

            startPCMStreaming(
                stream
            );


            // ------------------------------------------------
            // 保存用録音開始
            // ------------------------------------------------

            mediaRecorder.start(
                1000
            );


            // ------------------------------------------------
            // UI
            // ------------------------------------------------

            isRecording =
                true;


            startButton.disabled =
                true;


            stopButton.disabled =
                false;


            meetingGroup.disabled = true;
            memberButtons.querySelectorAll("button").forEach(button => {
                button.disabled = true;
            });


            // ここでは
            // 「文字起こしを開始しました」
            // を transcript に入れない。
            //
            // これを入れると、その文字が
            // 文字起こし本文として扱われるため。


            updateTranscriptDisplay();


            // ------------------------------------------------
            // タイマー
            // ------------------------------------------------

            elapsedSeconds = 0;

            timer.textContent =
                "00:00";


            timerInterval =
                setInterval(
                    () => {

                        elapsedSeconds++;


                        const minutes =
                            Math.floor(
                                elapsedSeconds /
                                60
                            );


                        const seconds =
                            elapsedSeconds %
                            60;


                        timer.textContent =
                            String(
                                minutes
                            ).padStart(
                                2,
                                "0"
                            ) +
                            ":" +
                            String(
                                seconds
                            ).padStart(
                                2,
                                "0"
                            );

                    },
                    1000
                );


            console.log(
                "Kotoba-Whisper準リアルタイム文字起こしを開始しました"
            );

        } catch (error) {

            console.error(
                "録音開始エラー:",
                error
            );


            stopPCMStreaming();

            if (currentReportSegment) {
                currentReportSegment.cancelled = true;
                currentReportSegment = null;
            }


            if (
                mediaRecorder &&
                mediaRecorder.state !==
                "inactive"
            ) {

                mediaRecorder.stop();

            }


            alert(
                "ローカル文字起こしサーバーへ接続できませんでした。" +
                "\n先に ./start-local-whisper.sh を起動してください。" +
                `\n詳細: ${error instanceof Error ? error.message : String(error)}`
            );


            startButton.disabled =
                false;


            stopButton.disabled =
                true;

            clearDraftButton.disabled = false;
            meetingGroup.disabled = false;
            memberButtons.querySelectorAll("button").forEach(button => {
                button.disabled = false;
            });

        }

    }
);


// ============================================================
// 録音停止
// ============================================================

stopButton.addEventListener(
    "click",
    async () => {

        console.log(
            "録音を停止します..."
        );


        isRecording =
            false;

        isCompletingTranscription = true;
        const stoppingReportSegment = currentReportSegment;


        // ------------------------------------------------
        // タイマー停止
        // ------------------------------------------------

        clearInterval(
            timerInterval
        );


        timerInterval =
            null;


        // ------------------------------------------------
        // PCM停止
        // ------------------------------------------------

        stopPCMStreaming();


        // ------------------------------------------------
        // MediaRecorder停止
        // ------------------------------------------------

        stopMediaRecorder();


        // 残っているPCMを送信し、全キューの文字起こし完了を待つ
        try {
            await queueLocalWhisperInference();
            await localInferenceQueue;
        } catch (error) {
            localTranscriptionError = error;
        }

        if (localTranscriptionError) {
            alert(
                "一部の文字起こしに失敗しました。録音ファイルは保存されています。" +
                `\n詳細: ${localTranscriptionError.message}`
            );
        }

        // 音声Blobの作成・ブラウザ内保存・RustFSアップロードの完了を待つ
        await mediaRecorderProcessingPromise;

        if (stoppingReportSegment) {
            stoppingReportSegment.text = finalTranscript.trim();
            stoppingReportSegment.endedAt = new Date().toISOString();
            stoppingReportSegment.durationSeconds = elapsedSeconds;
            await saveDraftToBrowser();
        }


        // ------------------------------------------------
        // UI
        // ------------------------------------------------

        isCompletingTranscription = false;
        currentReportSegment = null;
        renderReportList();

        // MediaRecorderのstop処理が完了するまで次の録音を開始させない
        startButton.disabled =
            true;


        stopButton.disabled =
            true;


        finalTranscript = "";
        updateTranscriptDisplay();

        startButton.disabled = false;
        clearDraftButton.disabled = false;
        meetingGroup.disabled = false;
        memberButtons.querySelectorAll("button").forEach(button => {
            button.disabled = false;
        });

        generateButton.disabled = !hasReportData(meetingGroup.value);


        console.log(
            "録音を停止しました"
        );

    }
);


// ============================================================
// 報告データ確定・文字起こし保存
// ============================================================

generateButton.addEventListener("click", async () => {
    const group = meetingGroup.value;

    if (!group) {
        alert("報告会を選択してください。");
        return;
    }

    const reports = meetingGroups[group]
        .map(speaker => ({
            speaker,
            segments: getSpeakerSegments(group, speaker)
        }))
        .filter(report => report.segments.length > 0);

    if (reports.length === 0) {
        alert("保存できる報告データがありません。");
        return;
    }

    savedMeetingData = {
        group,
        savedAt: new Date().toISOString(),
        reports
    };

    const firstSegment = reports
        .flatMap(report => report.segments)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
    const recordingDate = getJapanDateString(firstSegment.startedAt);
    const uploadErrors = [];

    generateButton.disabled = true;

    // AIへ渡すデータを確定するタイミングで、1人1ファイルにまとめて保存する
    for (const report of reports) {
        const text = report.segments
            .map(segment => segment.text.trim())
            .filter(Boolean)
            .join("\n\n");

        if (!text) {
            continue;
        }

        try {
            report.transcriptStorageKey = await uploadFileToRustFs({
                meetingGroupName: group,
                date: recordingDate,
                speaker: report.speaker,
                kind: "transcript",
                extension: "txt",
                blob: new Blob([text], { type: "text/plain;charset=utf-8" })
            });
        } catch (error) {
            uploadErrors.push({ speaker: report.speaker, error });
            console.error(`${report.speaker}のテキスト保存に失敗しました:`, error);
        }
    }

    console.log("確定した報告会データ:", savedMeetingData);

    if (uploadErrors.length > 0) {
        alert(
            "一部の文字起こしをRustFSへ保存できませんでした。" +
            "データはブラウザ内に残っています。\n" +
            `失敗: ${uploadErrors.map(item => item.speaker).join(", ")}`
        );
    } else {
        alert("文字起こしデータを報告者ごとにRustFSへ保存しました。");
    }

    generateButton.disabled = !hasReportData(group);
});
