import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import worker from "../src/index.ts";
import { ANNOUNCEMENTS_PROMPT, updateAnnouncementsSection } from "../src/announcements.ts";
import storageWorker from "../../worker/lab-note-worker/src/index.js";
const realSetTimeout = globalThis.setTimeout;

const original = "# **出席者**\n- kuro\n\n# **連絡事項**\n手書きの連絡\n\n# **出席率**\n100%\n\n# **進捗**\n## **kuro**\n### [進捗]\n以前の内容\n<br>\n";
const summary = "- **論文添削への協力**\n  - 先輩の論文を読み、研究の目的を知るためにコメントする。";
const startMarker = "<!-- lab-note:announcements:start -->";

test("すべての報告会の末尾に連絡事項があり、表示名と保存用IDを区別する", () => {
  const source = readFileSync(new URL("../../script.js", import.meta.url), "utf8");
  const config = source.slice(source.indexOf("const meetingGroups ="), source.indexOf("const workerBaseURL ="));
  const result = runInNewContext(`${config}; JSON.stringify({meetingGroups, label: getSpeakerLabel("announcements"), student: getSpeakerLabel("kuro")})`);
  const { meetingGroups, label, student } = JSON.parse(result);
  assert.equal(Object.keys(meetingGroups).length, 4);
  for (const members of Object.values(meetingGroups)) {
    assert.equal(members.at(-1), "announcements");
    assert.equal(members.filter(name => name === "announcements").length, 1);
  }
  assert.equal(label, "連絡事項");
  assert.equal(student, "kuro");
});

test("手書き・他セクションを保持し、AI部分だけ再送時に置き換える", () => {
  const first = updateAnnouncementsSection(original, summary);
  assert.ok(first.includes("手書きの連絡"));
  assert.equal(first.slice(first.indexOf("# **出席率**")), original.slice(original.indexOf("# **出席率**")));
  const withManualAddition = first.replace("# **出席率**", "追加の手書き\n\n# **出席率**");
  const second = updateAnnouncementsSection(withManualAddition, "- **修正版**\n  - 新しい内容");
  assert.ok(second.includes("手書きの連絡"));
  assert.ok(second.includes("追加の手書き"));
  assert.ok(!second.includes(summary));
  assert.equal(second.split(startMarker).length - 1, 1);
  assert.equal(updateAnnouncementsSection(second, "- **修正版**\n  - 新しい内容"), second);
});

test("末尾の連絡事項やCRLFを扱い、コード内の見出しでは区切らない", () => {
  const markdown = "# 連絡事項\r\n手書き\r\n```md\r\n# サンプル\r\n```\r\n末尾の手書き";
  const result = updateAnnouncementsSection(markdown, summary);
  assert.ok(result.startsWith(markdown));
  assert.ok(result.indexOf(startMarker) > result.indexOf("末尾の手書き"));
  assert.ok(updateAnnouncementsSection("# **連絡事項**", summary).includes(`\n${startMarker}\n`));
});

test("見出し欠落・壊れた目印・不正なAI出力では記事を更新しない", () => {
  assert.throws(() => updateAnnouncementsSection("# **進捗**\n", summary), /見出し/);
  for (const body of [startMarker, "<!-- lab-note:announcements:end -->", `${startMarker}\n${startMarker}\n<!-- lab-note:announcements:end -->`]) {
    assert.throws(() => updateAnnouncementsSection(`# **連絡事項**\n${body}\n# 次\n`, summary), /目印/);
  }
  for (const output of ["", "# 連絡事項", "- 連絡\n# 別の見出し", `- 連絡\n${startMarker}`]) {
    assert.throws(() => updateAnnouncementsSection(original, output), /形式/);
  }
});

function createEnv() {
  const statuses = new Map();
  const history = [];
  const messages = [];
  return {
    statuses, history, messages, ESA_ACCESS_TOKEN: "test-token",
    AI_JOB_STATUS: {
      async put(key, value) { const status = JSON.parse(value); statuses.set(key, status); history.push(status); },
      async get(key) { return statuses.get(key); },
      async delete(key) { statuses.delete(key); },
    },
    MINUTES_QUEUE: { async send(body) { messages.push(body); } },
  };
}

test("各テンプレートで連絡事項をキューに登録でき、未知の話者は拒否する", async () => {
  const env = createEnv();
  for (const templateKey of ["hci", "har", "lbs", "seminar3", "overall"]) {
    for (const speaker of ["announcements", "unknown-person"]) {
      const response = await worker.fetch(new Request("http://localhost/api/enqueue", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ templateKey, speaker, meetingDate: "2026-10-05",
          transcriptUrl: "https://s3.kajilab.dev/lab-note/test.txt" }),
      }), env);
      assert.equal(response.status, speaker === "announcements" ? 200 : 400);
    }
  }
  assert.equal(env.messages.length, 5);
  assert.ok(env.messages.every(message => message.speaker === "announcements"));
});

for (const speaker of ["announcements", "kuro"]) {
  test(`Queueから要約・esa更新まで: ${speaker}`, async t => {
    t.mock.method(globalThis, "setTimeout", callback => realSetTimeout(callback, 0));
    t.mock.method(console, "log", () => {});
    const env = createEnv();
    let aiInput;
    let patch;
    const generated = speaker === "announcements" ? summary : "## **kuro**\n### [進捗]\n- 学生の要約\n<br>";
    env.AI = { async run(model, input) { aiInput = input; return {response: generated}; } };
    const latest = original.replace("手書きの連絡", "手書きの連絡\nAI処理中に追記された内容");
    t.mock.method(globalThis, "fetch", async (url, options = {}) => {
      if (url === "https://s3.kajilab.dev/lab-note/test.txt") return new Response("教授または学生の発言");
      if (url.startsWith("https://api.esa.io/v1/teams/kjlb/posts?q=")) {
        return Response.json({posts: [{number: 123, body_md: original}]});
      }
      if (url === "https://api.esa.io/v1/teams/kjlb/posts/123") {
        if (options.method === "PATCH") {
          patch = JSON.parse(options.body).post;
          return Response.json({number: 123});
        }
        return Response.json({body_md: latest});
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    await worker.queue({messages: [{body: {jobId: "test-job", templateKey: "seminar3", speaker,
      meetingDate: "2026-10-05", transcriptUrl: "https://s3.kajilab.dev/lab-note/test.txt"},
      attempts: 3, ack() {}, retry() { assert.fail("Unexpected retry"); }}]}, env);
    assert.equal(env.statuses.get("test-job").status, "completed");
    assert.deepEqual(env.history.filter(entry => entry.status === "processing").map(entry => entry.stage),
      ["transcript", "esa_prepare", "ai", "esa_post"]);
    assert.equal(env.statuses.get("test-job").esaUrl, "https://kjlb.esa.io/posts/123");
    assert.ok(patch.body_md.includes("AI処理中に追記された内容"));
    assert.ok(patch.body_md.includes(generated));
    if (speaker === "announcements") {
      assert.equal(aiInput.messages[0].content, ANNOUNCEMENTS_PROMPT);
      assert.ok(patch.body_md.includes("以前の内容"));
      assert.equal(patch.message, "連絡事項をAIで更新");
    } else {
      assert.notEqual(aiInput.messages[0].content, ANNOUNCEMENTS_PROMPT);
      assert.ok(aiInput.messages[0].content.includes("対象話者のMarkdownブロック"));
      assert.ok(!patch.body_md.includes(startMarker));
    }
  });
}

test("全テンプレートで新規esa記事の連絡事項欄に反映できる", async t => {
  t.mock.method(globalThis, "setTimeout", callback => realSetTimeout(callback, 0));
  t.mock.method(console, "log", () => {});
  let created;
  let patched;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (url === "https://s3.kajilab.dev/lab-note/test.txt") return new Response("論文にコメントしてください。");
    if (url.startsWith("https://api.esa.io/v1/teams/kjlb/posts?q=")) return Response.json({posts: []});
    if (url === "https://api.esa.io/v1/teams/kjlb/posts" && options.method === "POST") {
      created = JSON.parse(options.body).post;
      return Response.json({number: 123});
    }
    if (url === "https://api.esa.io/v1/teams/kjlb/posts/123") {
      if (options.method === "PATCH") {
        patched = JSON.parse(options.body).post;
        return Response.json({number: 123});
      }
      return Response.json({body_md: created.body_md});
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  for (const templateKey of ["hci", "har", "lbs", "seminar3", "overall"]) {
    const env = createEnv();
    env.AI = {async run() { return {response: summary}; }};
    created = patched = undefined;
    await worker.queue({messages: [{body: {jobId: "new-job", templateKey,
      speaker: "announcements", meetingDate: "2026-10-05",
      transcriptUrl: "https://s3.kajilab.dev/lab-note/test.txt"}, attempts: 3, ack() {}, retry() { assert.fail(); }}]}, env);
    assert.equal(env.statuses.get("new-job").status, "completed", templateKey);
    assert.ok(created.category.endsWith("/2026/10/05"));
    assert.equal(patched.body_md, updateAnnouncementsSection(created.body_md, summary));
  }
});

test("連絡事項の音声・テキストに署名URLを発行できる（外部通信なし）", async () => {
  const env = {RUSTFS_ACCESS_KEY: "test-key", RUSTFS_SECRET_KEY: "test-secret",
    RUSTFS_ENDPOINT: "https://s3.kajilab.dev", RUSTFS_REGION: "us-east-1", RUSTFS_BUCKET: "lab-note"};
  for (const group of ["hci", "har", "lbs", "seminar3"]) {
    for (const kind of ["audio", "transcript"]) {
      const extension = kind === "audio" ? "webm" : "txt";
      const response = await storageWorker.fetch(new Request("http://localhost/api/rustfs/presign", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({operation: "put", group, date: "2026-10-05",
          speaker: "announcements", kind, extension, number: 1}),
      }), env);
      assert.equal(response.status, 200);
      const {key} = await response.json();
      assert.equal(key, `${group}/2026/10/05/announcements_${kind}_01.${extension}`);
      if (kind === "transcript") {
        const readResponse = await storageWorker.fetch(new Request("http://localhost/api/rustfs/presign", {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({operation: "get", key}),
        }), env);
        assert.equal(readResponse.status, 200);
      }
    }
  }
});

test("失敗した工程と理由をKVへ保存して画面に渡す", async t => {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "setTimeout", callback => realSetTimeout(callback, 0));
  let failingStage;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (url === "https://s3.kajilab.dev/lab-note/test.txt") {
      return failingStage === "transcript" ? new Response(null, {status: 403}) : new Response("連絡事項");
    }
    if (url.includes("posts?q=")) {
      return failingStage === "esa_prepare" ? new Response(null, {status: 401}) : Response.json({posts: [{number: 123, body_md: original}]});
    }
    if (options.method === "PATCH") return new Response(null, {status: 500});
    return Response.json({body_md: original});
  });
  for (const [stage, prefix] of [["transcript", "文字起こしの取得"], ["esa_prepare", "esa記事の準備"], ["ai", "AI要約の生成"], ["esa_post", "esaへの投稿"]]) {
    failingStage = stage;
    const env = createEnv();
    env.AI = {async run() {
      if (stage === "ai") throw new Error("AI利用上限");
      return {response: summary};
    }};
    await worker.queue({messages: [{body: {jobId: "failed-job", templateKey: "hci", speaker: "announcements",
      meetingDate: "2026-10-06", transcriptUrl: "https://s3.kajilab.dev/lab-note/test.txt"},
      attempts: 3, ack() {}, retry() { assert.fail(); }}]}, env);
    const result = env.statuses.get("failed-job");
    assert.equal(result.status, "failed");
    assert.equal(result.stage, stage);
    assert.ok(result.error.startsWith(`${prefix}:`));
  }
});
