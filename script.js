// ============================================================
// HTML要素
// ============================================================

const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const uploadButton = document.getElementById("uploadButton");
const recordingDate = document.getElementById("recordingDate");
const timer = document.getElementById("timer");
const audioArea = document.getElementById("audioArea");
const transcriptionResult = document.getElementById("transcriptionResult");
const transcript = document.getElementById("transcript");
const transcriptHint = document.getElementById("transcriptHint");
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

const announcementsSpeaker = "announcements";
Object.values(meetingGroups).forEach(speakers => speakers.push(announcementsSpeaker));

function getSpeakerLabel(speaker) {
    return speaker === announcementsSpeaker ? "連絡事項" : speaker;
}

const rustFsGroupNames = {
    "3年セミナー": "seminar3",
    "HCI班": "hci",
    "HAR班": "har",
    "LBS班": "lbs"
};

const workerBaseURL = `http://${location.hostname || "127.0.0.1"}:53103`;
const aiWorkerBaseURL = `http://${location.hostname || "127.0.0.1"}:53104`;

// 録音停止後、議事録生成まで一時的に保持するデータ
const reportRecords = new Map();

let activeSpeaker = "";
let currentReportSegment = null;

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
            selectedRecordingDate: recordingDate.value,
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

        if (draft.selectedRecordingDate &&
            draft.selectedRecordingDate <= getJapanDateString()) {
            recordingDate.value = draft.selectedRecordingDate;
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

const localWhisperBaseURL = `http://${location.hostname}:53102`;
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
let isUploadingReport = false;

let timerInterval = null;
let elapsedSeconds = 0;


// ============================================================
// 初期状態
// ============================================================

transcript.value = "";

recordingDate.max = getJapanDateString();
recordingDate.value = getJapanDateString();

stopButton.disabled = true;

startButton.disabled = true;

uploadButton.disabled = true;


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
    const segments = getSpeakerSegments(group, speaker);
    // 編集した全文と、その後に追加で録音した区間を表示する。
    // 録音区間ごとの元の文字起こし・音声はそのまま保持する。
    const edit = segments[0]?.transcriptEdit;
    const remainingSegments = edit
        ? segments.filter(segment => !edit.segmentIds.includes(segment.id))
        : segments;
    return [edit?.text, ...remainingSegments.map(segment => segment.text)]
        .filter(Boolean)
        .join("\n\n");
}

function hasUnfinishedAiJob(segments) {
    return segments.some(segment => segment.aiJobId &&
        !["completed", "failed"].includes(segment.aiQueueStatus));
}

function updateTranscriptEditState() {
    const segments = getSpeakerSegments(meetingGroup.value, activeSpeaker);
    const aiBusy = hasUnfinishedAiJob(segments) || segments.some(segment =>
        ["queued", "processing", "retrying"].includes(segment.aiQueueStatus)
    );
    const statusUnknown = segments.some(segment => segment.aiStatusCheckState);
    transcript.readOnly = !activeSpeaker || segments.length === 0 ||
        startButton.disabled || isRecording || isCompletingTranscription ||
        isUploadingReport || aiBusy;
    transcriptHint.textContent = statusUnknown && aiBusy
        ? "AI処理の状況を確認できないため、編集を一時停止しています"
        : isUploadingReport || aiBusy
        ? "保存・AI処理中は編集できません"
        : transcript.readOnly
            ? "録音停止後に編集できます"
            : "編集内容は自動保存されます。修正後は「保存してAI要約」";
}

transcript.addEventListener("input", () => {
    if (transcript.readOnly) return;

    const segments = getSpeakerSegments(meetingGroup.value, activeSpeaker);
    if (segments.length === 0 ||
        transcript.value === getSavedTranscript(meetingGroup.value, activeSpeaker)) return;

    segments[0].transcriptEdit = {
        text: transcript.value,
        segmentIds: segments.map(segment => segment.id)
    };
    // 修正版を次回送信する。アップロード済みの音声は再送しない。
    segments.forEach(segment => {
        delete segment.transcriptUploadedAt;
        delete segment.transcriptStorageKey;
        delete segment.aiQueuedAt;
        delete segment.aiQueueStatus;
        delete segment.aiJobId;
        delete segment.aiStatusError;
        delete segment.aiStatusCheckState;
        delete segment.aiStatusCheckMessage;
        delete segment.aiEsaUrl;
        delete segment.aiEsaPostNumber;
    });
    saveDraftToBrowser();
    renderReportList();
    updateUploadButtonState();
});

function updateUploadButtonState() {
    const segments = activeSpeaker
        ? getSpeakerSegments(meetingGroup.value, activeSpeaker)
        : [];
    const hasPendingAudio = segments.some(
        segment => segment.audioBlob && segment.audioUploadStatus !== "uploaded"
    );
    const hasPendingTranscript = segments.some(
        segment => !segment.transcriptUploadedAt
    );
    const hasPendingAi = segments.some(
        segment => !segment.aiQueuedAt || segment.aiQueueStatus === "failed"
    );
    const hasFailedAi = segments.some(segment => segment.aiQueueStatus === "failed");

    uploadButton.disabled = isRecording || isCompletingTranscription ||
        isUploadingReport || startButton.disabled || !activeSpeaker ||
        hasUnfinishedAiJob(segments) ||
        (!hasPendingAudio && !hasPendingTranscript && !hasPendingAi);
    uploadButton.textContent = hasFailedAi && !hasPendingAudio && !hasPendingTranscript
        ? "AI処理を再実行"
        : "保存してAI要約";
    updateTranscriptEditState();
}

function getSpeakerStatus(segments) {
    if (segments.length === 0) {
        return { label: "未録音", processing: false, className: "not-recorded" };
    }

    const checkProblem = [...segments].reverse().find(segment =>
        segment.aiJobId && segment.aiStatusCheckState
    );
    if (checkProblem) {
        return {
            label: checkProblem.aiStatusCheckState === "unreachable"
                ? "AIサーバーに接続できません"
                : "AI処理状況を要確認",
            processing: false,
            className: "unavailable",
            message: checkProblem.aiStatusCheckMessage,
            canRecheck: true
        };
    }

    if (!hasUnfinishedAiJob(segments) && segments.some(segment => !segment.aiQueuedAt)) {
        return { label: "録音済み", processing: false, className: "recorded" };
    }

    const unfinishedStatus = [...segments].reverse().find(segment =>
        segment.aiJobId && !["completed", "failed"].includes(segment.aiQueueStatus)
    )?.aiQueueStatus;
    const latestStatus = unfinishedStatus || [...segments]
        .reverse()
        .find(segment => segment.aiQueueStatus)?.aiQueueStatus;

    const statuses = {
        queued: { label: "AI生成待ち", processing: true, className: "processing" },
        processing: { label: "AI生成中", processing: true, className: "processing" },
        retrying: { label: "AI再試行中", processing: true, className: "processing" },
        completed: { label: "esa投稿済み", processing: false, className: "completed" },
        failed: { label: "AI処理失敗", processing: false, className: "failed" }
    };

    return statuses[latestStatus] ||
        { label: "録音済み", processing: false, className: "recorded" };
}

function getJapanDateString(value = new Date()) {
    return new Date(value).toLocaleDateString("sv-SE", {
        timeZone: "Asia/Tokyo"
    });
}

function getRustFsDateFolderPath(date) {
    const [year, month, day] = date.split("-");
    return `${year}年/${Number(month)}月/${Number(day)}日`;
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

async function enqueueMinutesGeneration(payload) {
    const response = await fetch(`${aiWorkerBaseURL}/api/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.jobId) {
        throw new Error(result.error || `AI処理の登録に失敗しました（HTTP ${response.status}）`);
    }

    return result;
}

let isPollingAiStatuses = false;
const aiStatusRequestTimeoutMilliseconds = 10000;
const aiStatusStaleMilliseconds = 10 * 60 * 1000;

function updateAiJobFields(jobId, fields) {
    let changed = false;
    reportRecords.forEach(segments => {
        segments.forEach(segment => {
            if (segment.aiJobId !== jobId) return;
            for (const [key, value] of Object.entries(fields)) {
                if (segment[key] !== value) {
                    segment[key] = value;
                    changed = true;
                }
            }
        });
    });
    return changed;
}

async function refreshAiJobStatuses() {
    if (isPollingAiStatuses) {
        return;
    }

    const jobIds = new Set();
    reportRecords.forEach(segments => {
        segments.forEach(segment => {
            if (segment.aiJobId &&
                segment.aiQueueStatus !== "failed" &&
                (segment.aiQueueStatus !== "completed" || !segment.aiEsaUrl)) {
                jobIds.add(segment.aiJobId);
            }
        });
    });

    if (jobIds.size === 0) {
        return;
    }

    isPollingAiStatuses = true;
    let changed = false;

    try {
        for (const jobId of jobIds) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), aiStatusRequestTimeoutMilliseconds);
            try {
                const response = await fetch(
                    `${aiWorkerBaseURL}/api/status/${encodeURIComponent(jobId)}`,
                    { cache: "no-store", signal: controller.signal }
                );

                if (!response.ok) {
                    changed = updateAiJobFields(jobId, {
                        aiStatusCheckState: response.status === 404 ? "not-found" : "server-error",
                        aiStatusCheckMessage: response.status === 404
                            ? "サーバーには接続できましたが、元の処理情報が見つかりません。起動したWorkerとesaの投稿状況を確認してください。自動再送はしません。"
                            : `処理状況の取得に失敗しました（HTTP ${response.status}）。時間をおいて再確認します。`
                    }) || changed;
                    continue;
                }

                const result = await response.json();
                if (!result || !["queued", "processing", "retrying", "completed", "failed"].includes(result.status)) {
                    changed = updateAiJobFields(jobId, {
                        aiStatusCheckState: "invalid-response",
                        aiStatusCheckMessage: "サーバーから正しい処理状況を取得できませんでした。接続先のWorkerを確認してください。"
                    }) || changed;
                    continue;
                }
                const resolvedEsaUrl = result.esaUrl || (
                    result.esaPostNumber
                        ? `https://kjlb.esa.io/posts/${result.esaPostNumber}`
                        : ""
                );
                // 通信が復旧しても、停止前の「処理中」がKVに残っている場合がある。
                // 経過時間だけで失敗と決めたり、AIへ再送したりはしない。
                const updatedAt = Date.parse(result.updatedAt);
                const stale = ["queued", "processing", "retrying"].includes(result.status) &&
                    Number.isFinite(updatedAt) && Date.now() - updatedAt > aiStatusStaleMilliseconds;
                changed = updateAiJobFields(jobId, {
                    aiQueueStatus: result.status,
                    aiStatusError: result.error || "",
                    aiEsaUrl: resolvedEsaUrl,
                    aiEsaPostNumber: result.esaPostNumber || null,
                    aiStatusCheckState: stale ? "stale" : "",
                    aiStatusCheckMessage: stale
                        ? "サーバーには接続できていますが、処理状況が10分以上更新されていません。処理中か中断したかを判断できないため、Workerのログとesaを確認してください。自動再送はしません。"
                        : ""
                }) || changed;
            } catch (error) {
                console.warn("AI処理状況を取得できませんでした:", error);
                changed = updateAiJobFields(jobId, {
                    aiStatusCheckState: "unreachable",
                    aiStatusCheckMessage: "AIサーバーとの接続が切れたか、応答を取得できませんでした。AI・esa用Workerを起動してください。復旧後は元の処理IDで自動確認します。AI処理は再送しません。"
                }) || changed;
            } finally {
                clearTimeout(timeoutId);
            }
        }

        if (changed) {
            await saveDraftToBrowser();
            renderReportList();
            updateUploadButtonState();
        }
    } finally {
        isPollingAiStatuses = false;
    }
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

    const prefix = `${group}/${getRustFsDateFolderPath(date)}/${speaker}_${kind}_`;
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
        const heading = document.createElement("div");
        const controls = document.createElement("div");
        const name = document.createElement("strong");
        let status = document.createElement("span");
        const text = document.createElement("p");
        const detailsButton = document.createElement("button");

        item.className = "report-item";
        heading.className = "report-item-heading";
        controls.className = "report-item-controls";
        name.textContent = getSpeakerLabel(speaker);
        const speakerStatus = getSpeakerStatus(segments);
        const esaUrl = [...segments]
            .reverse()
            .find(segment => segment.aiEsaUrl)?.aiEsaUrl;

        if (speakerStatus.className === "completed" && esaUrl) {
            try {
                const parsedUrl = new URL(esaUrl);
                if (parsedUrl.protocol === "https:" && parsedUrl.hostname === "kjlb.esa.io") {
                    status = document.createElement("a");
                    status.href = parsedUrl.toString();
                    status.target = "_blank";
                    status.rel = "noopener noreferrer";
                    status.title = "esaの記事を新しいタブで開く";
                }
            } catch {
                // URLが不正な場合は通常のステータス表示にする
            }
        }

        status.className = `report-status ${speakerStatus.className}`;
        status.textContent = speakerStatus.label;

        if (speakerStatus.processing) {
            const spinner = document.createElement("span");
            spinner.className = "status-spinner";
            spinner.setAttribute("aria-hidden", "true");
            status.prepend(spinner);
        }
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

        heading.appendChild(name);
        controls.appendChild(status);

        if (speakerStatus.canRecheck) {
            const recheckButton = document.createElement("button");
            recheckButton.type = "button";
            recheckButton.className = "details-button";
            recheckButton.textContent = "状況を再確認";
            recheckButton.addEventListener("click", async () => {
                recheckButton.disabled = true;
                recheckButton.textContent = "確認中…";
                try {
                    await refreshAiJobStatuses();
                } finally {
                    renderReportList();
                }
            });
            controls.appendChild(recheckButton);
        }

        if (segments.length > 0) {
            controls.appendChild(detailsButton);
        }

        heading.appendChild(controls);
        item.appendChild(heading);

        if (speakerStatus.message) {
            const notice = document.createElement("p");
            notice.className = "report-status-notice";
            notice.textContent = speakerStatus.message;
            item.appendChild(notice);
        }

        if (segments.length > 0) {
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
    selectedSpeaker.textContent = speaker === announcementsSpeaker
        ? "選択中：連絡事項"
        : `選択中の報告者：${speaker}`;
    transcript.value = getSavedTranscript(meetingGroup.value, speaker);
    startButton.disabled = false;
    updateUploadButtonState();

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
    updateUploadButtonState();

    if (group) {
        meetingGroups[group].forEach(speaker => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = getSpeakerLabel(speaker);
            button.dataset.speaker = speaker;
            button.addEventListener("click", () => selectSpeaker(speaker));
            memberButtons.appendChild(button);
        });
    }

    renderReportList();
}

meetingGroup.addEventListener("change", () => {
    renderMemberButtons();
    saveDraftToBrowser();
});
recordingDate.addEventListener("change", () => {
    const today = getJapanDateString();

    if (!recordingDate.value || recordingDate.value > today) {
        recordingDate.value = today;
    }

    saveDraftToBrowser();
});
restoreDraftFromBrowser().then(refreshAiJobStatuses);
setInterval(refreshAiJobStatuses, 10000);

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
        activeSpeaker = "";
        currentReportSegment = null;
        finalTranscript = "";

        meetingGroup.value = "";
        recordingDate.value = getJapanDateString();
        transcript.value = "";
        timer.textContent = "00:00";
        elapsedSeconds = 0;
        audioArea.innerHTML = "";

        renderMemberButtons();
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

            if (!recordingDate.value || recordingDate.value > getJapanDateString()) {
                alert("録音日は今日以前の日付を選択してください。");
                return;
            }

            const reportGroup = meetingGroup.value;
            const reportSpeaker = activeSpeaker;

            startButton.disabled = true;
            updateTranscriptEditState();
            clearDraftButton.disabled = true;
            uploadButton.disabled = true;
            recordingDate.disabled = true;
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

            updateTranscriptDisplay();

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
                meetingDate: recordingDate.value,
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

                    // アップロードボタンを押すまでブラウザ内に保持する
                    reportSegment.audioBlob = audioBlob;
                    reportSegment.audioMimeType = actualMimeType;
                    reportSegment.audioUploadStatus = "pending";
                    reportSegment.audioStorageKey = "";

                    const key = getReportKey(
                        reportSegment.group,
                        reportSegment.speaker
                    );
                    const segments = reportRecords.get(key) || [];
                    segments.push(reportSegment);
                    reportRecords.set(key, segments);
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
                        recordingDate.disabled = false;
                        memberButtons.querySelectorAll("button").forEach(button => {
                            button.disabled = false;
                        });
                        updateUploadButtonState();
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

            uploadButton.disabled = true;


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
            recordingDate.disabled = false;
            meetingGroup.disabled = false;
            memberButtons.querySelectorAll("button").forEach(button => {
                button.disabled = false;
            });
            updateTranscriptDisplay();
            updateUploadButtonState();

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

        // 音声Blobの作成とブラウザ内保存の完了を待つ
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
        recordingDate.disabled = false;
        memberButtons.querySelectorAll("button").forEach(button => {
            button.disabled = false;
        });

        updateUploadButtonState();


        console.log(
            "録音を停止しました"
        );

    }
);


// ============================================================
// 選択中の報告者の音声・文字起こしをRustFSへ保存
// ============================================================

uploadButton.addEventListener("click", async () => {
    const group = meetingGroup.value;
    const speaker = activeSpeaker;
    const segments = getSpeakerSegments(group, speaker);

    if (!group || !speaker || segments.length === 0) {
        alert("アップロードする報告者のデータがありません。");
        return;
    }

    if (hasUnfinishedAiJob(segments)) {
        alert("前回のAI処理が完了したか確認できるまで、再送信できません。報告状況を確認してください。");
        return;
    }

    const pendingAudioSegments = segments.filter(
        segment => segment.audioBlob && segment.audioUploadStatus !== "uploaded"
    );
    const hasNewTranscript = segments.some(segment => !segment.transcriptUploadedAt);
    const needsAiQueue = segments.some(
        segment => !segment.aiQueuedAt || segment.aiQueueStatus === "failed"
    );
    const text = getSavedTranscript(group, speaker).trim();

    if (!text) {
        alert("文字起こし結果を入力してから保存してください。");
        return;
    }

    if (pendingAudioSegments.length === 0 && !hasNewTranscript && !needsAiQueue) {
        alert("この報告者のデータはアップロード済みで、AI処理も登録済みです。");
        return;
    }

    isUploadingReport = true;
    uploadButton.disabled = true;
    startButton.disabled = true;
    clearDraftButton.disabled = true;
    updateTranscriptEditState();
    meetingGroup.disabled = true;
    memberButtons.querySelectorAll("button").forEach(button => {
        button.disabled = true;
    });

    const errors = [];
    let transcriptStorageKey = [...segments]
        .reverse()
        .find(segment => segment.transcriptStorageKey)?.transcriptStorageKey || "";
    let transcriptReadyForQueue = !hasNewTranscript && Boolean(transcriptStorageKey);

    for (const segment of pendingAudioSegments) {
        let extension = "webm";
        if (segment.audioMimeType.includes("mp4")) {
            extension = "mp4";
        } else if (segment.audioMimeType.includes("ogg")) {
            extension = "ogg";
        }

        segment.audioUploadStatus = "uploading";

        try {
            segment.audioStorageKey = await uploadFileToRustFs({
                meetingGroupName: group,
                date: segment.meetingDate || getJapanDateString(segment.startedAt),
                speaker,
                kind: "audio",
                extension,
                blob: segment.audioBlob
            });
            segment.audioUploadStatus = "uploaded";
        } catch (error) {
            segment.audioUploadStatus = "failed";
            errors.push(`音声: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    if (hasNewTranscript) {
        try {
            const firstSegment = [...segments]
                .sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
            transcriptStorageKey = await uploadFileToRustFs({
                meetingGroupName: group,
                date: firstSegment.meetingDate || getJapanDateString(firstSegment.startedAt),
                speaker,
                kind: "transcript",
                extension: "txt",
                blob: new Blob([text], { type: "text/plain;charset=utf-8" })
            });

            const uploadedAt = new Date().toISOString();
            segments.forEach(segment => {
                segment.transcriptUploadedAt = uploadedAt;
                segment.transcriptStorageKey = transcriptStorageKey;
            });
            transcriptReadyForQueue = true;
        } catch (error) {
            errors.push(`テキスト: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    if (needsAiQueue && transcriptReadyForQueue) {
        try {
            const readTarget = await requestRustFsSignedUrl({
                operation: "get",
                key: transcriptStorageKey
            });
            const firstSegment = [...segments]
                .sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];

            const queueResult = await enqueueMinutesGeneration({
                templateKey: rustFsGroupNames[group],
                speaker,
                meetingDate: firstSegment.meetingDate || getJapanDateString(firstSegment.startedAt),
                transcriptUrl: readTarget.url
            });

            const queuedAt = new Date().toISOString();
            segments.forEach(segment => {
                segment.aiQueuedAt = queuedAt;
                segment.aiQueueStatus = "queued";
                segment.aiJobId = queueResult.jobId;
                segment.aiStatusError = "";
                segment.aiStatusCheckState = "";
                segment.aiStatusCheckMessage = "";
            });
        } catch (error) {
            segments.forEach(segment => {
                if (!segment.aiQueuedAt) {
                    segment.aiQueueStatus = "failed";
                }
            });
            errors.push(`AI処理: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    await saveDraftToBrowser();
    renderReportList();

    isUploadingReport = false;
    startButton.disabled = false;
    clearDraftButton.disabled = false;
    meetingGroup.disabled = false;
    memberButtons.querySelectorAll("button").forEach(button => {
        button.disabled = false;
    });
    updateUploadButtonState();

    if (errors.length > 0) {
        alert(
            "一部のデータをRustFSへアップロードできませんでした。" +
            "データはブラウザ内に残っています。\n" + errors.join("\n")
        );
    } else {
        alert(
            `${getSpeakerLabel(speaker)}の音声と文字起こしをRustFSへアップロードし、` +
            "AIによる要約とesaへの反映を受け付けました。"
        );
    }
});
