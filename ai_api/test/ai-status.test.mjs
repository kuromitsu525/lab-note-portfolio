import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../../app/front/script.js", import.meta.url), "utf8");

function setup(speaker = "kuro") {
  const listeners = {};
  const requests = [];
  const segment = {id: "recording-1", aiJobId: "original-job", aiQueueStatus: "processing",
    aiQueuedAt: "2026-10-05T00:00:00Z", transcriptUploadedAt: "saved",
    text: "文字起こし", audioBlob: new Blob(["audio"]), audioUploadStatus: "uploaded"};
  let snapshot;
  let timeoutCallback;
  let cleared = 0;
  let response = () => Response.json({status: "processing", updatedAt: new Date().toISOString()});
  const context = vm.createContext({
    reportRecords: new Map([[`HCI班::${speaker}`, [segment]]]),
    meetingGroup: {value: "HCI班"}, activeSpeaker: speaker,
    transcript: {addEventListener() {}}, transcriptHint: {},
    startButton: {disabled: false}, uploadButton: {addEventListener(type, fn) { listeners[type] = fn; }},
    isRecording: false, isCompletingTranscription: false, isUploadingReport: false,
    cloudflareAccessCredentials: {clientId: "test-id", clientSecret: "test-secret"},
    presentationEsaUrlInput: {value: ""},
    aiWorkerBaseURL: "http://localhost:53104", AbortController,
    console: {warn() {}},
    setTimeout(callback) { timeoutCallback = callback; return 1; },
    clearTimeout() { cleared++; },
    fetch: async (url, options) => {
      requests.push({url, options});
      return response(url, options);
    },
    fetchProtectedApi: async (url, options) => {
      requests.push({url, options});
      return response(url, options);
    },
    async saveDraftToBrowser() { snapshot = structuredClone([...context.reportRecords]); },
    renderReportList() {}, alert(message) { context.lastAlert = message; },
  });
  vm.runInContext(source.slice(source.indexOf("function getReportKey("), source.indexOf("function getJapanDateString(")), context);
  vm.runInContext(source.slice(source.indexOf("let isPollingAiStatuses ="), source.indexOf("async function getNextRustFsFileNumber(")), context);
  vm.runInContext(source.slice(source.indexOf('uploadButton.addEventListener("click"')), context);
  return {context, segment, requests, listeners,
    respond(fn) { response = fn; },
    snapshot: () => snapshot,
    expire: () => timeoutCallback(),
    cleared: () => cleared,
    status: () => context.getSpeakerStatus(context.reportRecords.get(`HCI班::${speaker}`)),
  };
}

for (const speaker of ["kuro", "announcements"]) {
  test(`${speaker}: 切断を表示・保存し、再起動後は同じIDで完了を取得する`, async () => {
    const app = setup(speaker);
    app.respond(() => { throw new TypeError("Failed to fetch"); });
    await app.context.refreshAiJobStatuses();
    assert.equal(app.status().label, "AIサーバーに接続できません");
    assert.equal(app.status().processing, false);
    assert.equal(app.status().canRecheck, true);
    assert.equal(app.segment.aiQueueStatus, "processing");
    assert.equal(app.segment.aiJobId, "original-job");
    assert.equal(app.context.uploadButton.disabled, true);
    assert.equal(app.context.transcript.readOnly, true);
    assert.ok(app.context.transcriptHint.textContent.includes("確認できない"));

    // ブラウザの再読み込み相当。IndexedDBに渡したデータから復元する。
    app.context.reportRecords = new Map(app.snapshot());
    assert.equal(app.status().className, "unavailable");
    app.respond(() => Response.json({status: "completed", esaPostNumber: 123,
      updatedAt: new Date().toISOString()}));
    await app.context.refreshAiJobStatuses();
    assert.equal(app.status().label, "esa投稿済み");
    const restored = app.context.reportRecords.get(`HCI班::${speaker}`)[0];
    assert.equal(restored.aiStatusCheckState, "");
    assert.equal(restored.aiEsaUrl, "https://kjlb.esa.io/posts/123");
    assert.equal(await restored.audioBlob.text(), "audio");
    assert.equal(app.context.transcript.readOnly, false);
    assert.equal(app.requests.length, 2);
    assert.ok(app.requests.every(({url, options}) => url.endsWith("/api/status/original-job") && !options.method));
  });
}

test("404・HTTPエラー・不正な応答をAI失敗にせず要確認にする", async () => {
  for (const reply of [() => new Response(null, {status: 404}),
    () => new Response(null, {status: 503}), () => Response.json({status: "unknown"})]) {
    const app = setup();
    app.respond(reply);
    await app.context.refreshAiJobStatuses();
    assert.equal(app.status().label, "AI処理状況を要確認");
    assert.equal(app.segment.aiQueueStatus, "processing");
    assert.equal(app.context.uploadButton.disabled, true);
  }
});

test("応答が戻らない場合もタイムアウトし、次回の確認で復帰できる", async () => {
  const app = setup();
  app.respond((url, {signal}) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("timeout")), {once: true});
  }));
  const pending = app.context.refreshAiJobStatuses();
  await app.context.refreshAiJobStatuses();
  assert.equal(app.requests.length, 1, "確認要求が重ならない");
  app.expire();
  await pending;
  assert.equal(app.status().className, "unavailable");
  assert.equal(app.cleared(), 1);
  app.respond(() => Response.json({status: "processing", updatedAt: new Date().toISOString()}));
  await app.context.refreshAiJobStatuses();
  assert.equal(app.status().label, "AI生成中");
  assert.equal(app.requests.length, 2);
});

test("停止前の処理中が残った場合は要確認となり、追加録音があっても再送しない", async () => {
  const app = setup();
  app.context.reportRecords.get("HCI班::kuro").push({id: "recording-2", text: "追加録音"});
  assert.equal(app.status().label, "AI生成中");
  app.respond(() => Response.json({status: "processing", updatedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString()}));
  await app.context.refreshAiJobStatuses();
  assert.equal(app.status().className, "unavailable");
  assert.equal(app.segment.aiStatusCheckState, "stale");
  assert.equal(app.context.uploadButton.disabled, true);
  await app.listeners.click();
  assert.ok(app.segment.reportNotice.includes("再送信できません"));
  assert.equal(app.requests.length, 1, "クリックでもAIへ再送しない");
});

test("サーバーが失敗を確定した場合だけAI再実行を有効にする", async () => {
  const app = setup();
  app.segment.aiStatusCheckState = "unreachable";
  app.respond(() => Response.json({status: "failed", error: "AI実行エラー"}));
  await app.context.refreshAiJobStatuses();
  assert.equal(app.status().label, "AI処理失敗");
  assert.equal(app.segment.aiStatusCheckState, "");
  assert.equal(app.context.uploadButton.disabled, false);
  assert.equal(app.context.uploadButton.textContent, "AI処理を再実行");
});

test("再確認ボタンと接続断の説明を表示し、ボタンは状態取得だけを行う", async () => {
  const app = setup();
  app.respond(() => { throw new Error("offline"); });
  await app.context.refreshAiJobStatuses();
  function element() {
    return {children: [], listeners: {}, classList: {add() {}, remove() {}},
      appendChild(child) { this.children.push(child); }, prepend(child) { this.children.unshift(child); },
      addEventListener(event, callback) { this.listeners[event] = callback; },
      setAttribute() {}, set innerHTML(value) { this.children = []; }};
  }
  app.context.document = {createElement: element};
  app.context.reportList = element();
  app.context.meetingGroups = {"HCI班": ["kuro"]};
  app.context.getSpeakerLabel = speaker => speaker;
  vm.runInContext(source.slice(source.indexOf("function renderReportList("), source.indexOf("function selectSpeaker(")), app.context);
  app.context.renderReportList();
  const row = app.context.reportList.children[0];
  const controls = row.children[0].children[1];
  const recheck = controls.children.find(node => node.textContent === "状況を再確認");
  assert.ok(recheck);
  assert.ok(row.children.some(node => node.className === "report-status-notice" && node.textContent.includes("元の処理ID")));
  app.respond(() => Response.json({status: "failed", error: "失敗を確認"}));
  await recheck.listeners.click();
  assert.equal(app.status().label, "AI処理失敗");
  assert.equal(app.requests.length, 2);
  assert.ok(app.requests.every(request => request.url.includes("/api/status/")));
});

for (const failure of [null, "audio", "transcript", "enqueue"]) {
  test(`保存からAI受付までを報告状況だけで表示する: ${failure || "成功"}`, async () => {
    const app = setup();
    for (const field of ["aiJobId", "aiQueueStatus", "aiQueuedAt", "transcriptUploadedAt"]) delete app.segment[field];
    Object.assign(app.segment, {audioUploadStatus: "pending", audioMimeType: "audio/webm",
      startedAt: "2026-10-06T00:00:00Z", meetingDate: "2026-10-06"});
    const operations = [];
    const phases = [];
    Object.assign(app.context, {
      Blob, clearDraftButton: {}, memberButtons: {querySelectorAll: () => []},
      rustFsGroupNames: {"HCI班": "hci"},
      alert() { assert.fail("保存ボタンではポップアップを表示しない"); },
      renderReportList() { phases.push(app.status().label); },
      async uploadFileToRustFs({kind}) {
        operations.push(kind);
        if (failure === kind) throw new Error(`${kind} HTTP 403`);
        return `hci/${kind}`;
      },
      async requestRustFsSignedUrl() { return {url: "https://example.invalid/transcript"}; },
      async enqueueMinutesGeneration() {
        operations.push("enqueue");
        if (failure === "enqueue") throw new Error("AI受付 HTTP 500");
        return {jobId: "new-job"};
      },
    });
    await app.listeners.click();
    assert.ok(phases.includes("音声を保存中"));
    assert.ok(phases.includes("テキストを保存中"));
    assert.equal(app.context.isUploadingReport, false);
    assert.equal(app.context.startButton.disabled, false);
    assert.ok(app.snapshot());
    const problems = app.context.getReportProblems([app.segment]).join("\n");
    if (failure) assert.ok(problems.includes(failure === "enqueue" ? "AI受付 HTTP 500" : `${failure} HTTP 403`));
    else assert.equal(problems, "");
    if (failure === "transcript") {
      assert.ok(!operations.includes("enqueue"));
      assert.equal(app.status().label, "アップロード失敗");
    } else if (failure === "enqueue") {
      assert.equal(app.status().label, "AI処理失敗");
      assert.equal(app.context.uploadButton.disabled, false);
    } else {
      assert.equal(app.status().label, failure === "audio" ? "アップロード失敗" : "AI生成待ち");
      if (!failure) assert.ok(phases.includes("AI処理を登録中"));
    }
  });
}

test("AIの処理段階と失敗理由を表示し、esa投稿中も区別する", async () => {
  const app = setup();
  for (const [stage, label] of [["transcript", "文字起こしを取得中"], ["esa_prepare", "esa記事を準備中"], ["ai", "AI生成中"], ["esa_post", "esaへ投稿中"]]) {
    app.respond(() => Response.json({status: "processing", stage, updatedAt: new Date().toISOString()}));
    await app.context.refreshAiJobStatuses();
    assert.equal(app.status().label, label);
  }
  app.respond(() => Response.json({status: "failed", stage: "esa_post", error: "esaへの投稿: HTTP 403"}));
  await app.context.refreshAiJobStatuses();
  assert.equal(app.status().label, "esa投稿失敗");
  assert.ok(app.context.getReportProblems([app.segment])[0].includes("esaへの投稿: HTTP 403"));
});

test("esa投稿後も音声の失敗を優先し、再保存成功後はesa投稿済みに戻す", () => {
  const app = setup();
  Object.assign(app.segment, {aiQueueStatus: "completed", aiEsaUrl: "https://kjlb.esa.io/posts/123",
    audioUploadStatus: "failed", audioUploadError: "HTTP 403"});
  assert.equal(app.status().label, "アップロード失敗");
  assert.ok(app.context.getReportProblems([app.segment])[0].includes("HTTP 403"));
  app.segment.audioUploadStatus = "uploaded";
  assert.equal(app.status().label, "esa投稿済み");
  assert.equal(app.context.getReportProblems([app.segment]).length, 0);
});
