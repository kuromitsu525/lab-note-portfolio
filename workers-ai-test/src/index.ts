import { Hono } from "hono";
import { cors } from "hono/cors";
import { ANNOUNCEMENTS_PROMPT, findAnnouncementsSection, updateAnnouncementsSection } from "./announcements.ts";

type QueueMessage = {
  jobId: string;
  templateKey: string;
  speaker: string;
  meetingDate: string;
  transcriptUrl: string;
};

type Bindings = {
  AI: any;
  ESA_ACCESS_TOKEN: string;
  MINUTES_QUEUE: any;
  AI_JOB_STATUS: KVNamespace;
};

type JobStatus = "queued" | "processing" | "retrying" | "completed" | "failed";

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", cors({
  origin: ["http://127.0.0.1:53101", "http://localhost:53101"],
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type"]
}));

async function saveJobStatus(
  env: Bindings,
  jobId: string,
  status: JobStatus,
  details: Record<string, unknown> = {}
) {
  await env.AI_JOB_STATUS.put(jobId, JSON.stringify({
    jobId,
    status,
    updatedAt: new Date().toISOString(),
    ...details
  }), { expirationTtl: 60 * 60 * 24 * 7 });
}

// 話者リスト
const SPEAKERS = {
  hci: ["fuseya", "seiken", "taku", "niwa", "machida"],
  har: ["gomamono", "enami", "nakamura", "tada", "tatsunari"],
  lbs: ["hayashi", "natsuki", "hanada", "hiroto", "kakeru", "ryuki"],
  seminar3: ["machida", "rinya", "onogi", "yuga", "kuro", "yoshitomo", "nao", "yu-dai", "sana", "sawaki", "honoka", "kazuma"],
  overall: ["rui", "toyama", "togawa", "fuma", "ueji", "hayato", "kousei", "nishi", "hayashi", "futami", "ryouta", "mizutani", "fuseya", "hibino", "kosuke", "hanao", "kakumu", "makino", "tada", "seiken"]
};

const ANNOUNCEMENTS_SPEAKER = "announcements";
Object.values(SPEAKERS).forEach(speakers => speakers.push(ANNOUNCEMENTS_SPEAKER));

// 5つの会議テンプレート
const TEMPLATES: Record<string, any> = {
  hci: {
    label: "HCI (ヒューマンコンピュータインタラクション)",
    categoryPrefix: "2.議事録/1.HCI",
    titleTemplate: "HCI(ヒューマンコンピュータインタラクション)【完成版】",
    markdown: `# **出席者**
- ### [教員]
- [ ] kaji
- ### [M2]
- [ ] fuseya
- ### [B4]
- [ ] seiken
- [ ] taku
- [ ] niwa
- ### [B3]
- [ ] machida

# **遅刻者**

# **連絡事項**

# **出席率**
[出席管理(HCI2026)](https://docs.google.com/spreadsheets/d/1wzKljj2j8EmRHQ5wK6A6RDtfyJbKzUXUfbKyIHURliU/edit?single=true&gid=1730699719)
<iframe width="100%" height="300" src="https://docs.google.com/spreadsheets/d/e/2PACX-1vR-Y4R7dbToNYyCeaGwiAcwrsq9U3btjFtTG-_Ks16pD-RHFHs6UXjluvWZKuYmcjmQ3FMjfMkHa1Pd/pubhtml?gid=1730699719&amp;single=true&amp;widget=true&amp;headers=false"></iframe>

# **進捗**

## **fuseya**
@fuseya 
### [進捗]
### [議論の内容]
### [今後の予定]
<br>

## **seiken**
@seiken 
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **taku**
@taku 
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **niwa**
@niwa 
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **machida**
@machida 
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>
`
  },
  har: {
    label: "HAR (人間行動認識)",
    categoryPrefix: "2.議事録/2.HAR",
    titleTemplate: "HAR(人間行動認識)【完成版】",
    markdown: `# **出席者**
- ### [教員]
- [ ] kaji
- ### [M1]
- [ ] gomamono
- ### [B4]
- [ ] enami
- [ ] nakamura
- [ ] tada
- [ ] tatsunari

# **遅刻者**

# **連絡事項**

# **出席率**
[出席管理(HAR2026)](https://docs.google.com/spreadsheets/d/1wzKljj2j8EmRHQ5wK6A6RDtfyJbKzUXUfbKyIHURliU/edit?single=true&gid=1989075207)
<iframe width="100%" height="300" src="https://docs.google.com/spreadsheets/d/e/2PACX-1vR-Y4R7dbToNYyCeaGwiAcwrsq9U3btjFtTG-_Ks16pD-RHFHs6UXjluvWZKuYmcjmQ3FMjfMkHa1Pd/pubhtml?gid=1989075207&amp;single=true&amp;widget=true&amp;headers=false"></iframe>

# **進捗**

## **gomamono**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **enami**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **nakamura**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **tada**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **tatsunari**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>
`
  },
  lbs: {
    label: "LBS (位置情報システム)",
    categoryPrefix: "2.議事録/3.LBS",
    titleTemplate: "LBS(位置情報システム)【完成版】",
    markdown: `# **出席者**
- ### [教員]
- [ ] kaji
- ### [M2]
- [ ] hayashi
- ### [M1]
- [ ] natsuki
- ### [B4]
- [ ] hanada
- [ ] hiroto
- [ ] kakeru
- [ ] ryuki

# **遅刻者**

# **連絡事項**

# **出席率**
[出席管理(LBS2026)](https://docs.google.com/spreadsheets/d/1wzKljj2j8EmRHQ5wK6A6RDtfyJbKzUXUfbKyIHURliU/edit?single=true&gid=157417420)
<iframe width="100%" height="300" src="https://docs.google.com/spreadsheets/d/e/2PACX-1vR-Y4R7dbToNYyCeaGwiAcwrsq9U3btjFtTG-_Ks16pD-RHFHs6UXjluvWZKuYmcjmQ3FMjfMkHa1Pd/pubhtml?gid=157417420&amp;single=true&amp;widget=true&amp;headers=false"></iframe>

# **進捗**

## **hayashi**
@hayashi 
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **natsuki**
@natsuki 
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **hanada**
@hanada 
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **hiroto**
@hiroto 
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **kakeru**
@kakeru 
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **ryuki**
@ryuki 
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>
`
  },
  seminar3: {
    label: "3年セミナー",
    categoryPrefix: "2.議事録/4.3年セミナー",
    titleTemplate: "3年セミナー【完成版】",
    markdown: `# **出席者**
- ### [教員]
- [ ] kaji
- ### [B3]
- [ ] machida
- [ ] rinya
- [ ] onogi
- [ ] yuga
- [ ] kuro
- [ ] yoshitomo
- [ ] nao
- [ ] yu-dai
- [ ] sana
- [ ] sawaki
- [ ] honoka
- [ ] kazuma

# **遅刻者**

# **連絡事項**

# **出席率**
[出席管理（3年セミナー2026）](https://docs.google.com/spreadsheets/d/1wzKljj2j8EmRHQ5wK6A6RDtfyJbKzUXUfbKyIHURliU/edit?gid=1505266574&single=true)
<iframe width="100%" height="300" src="https://docs.google.com/spreadsheets/d/1wzKljj2j8EmRHQ5wK6A6RDtfyJbKzUXUfbKyIHURliU/pubhtml?gid=1505266574&amp;single=true&amp;widget=true&amp;headers=false"></iframe>

# **進捗**

## **machida**
### [進捗]
### [議論の内容]
### [今後の予定]
### [進路関係]
<br>

## **rinya**
### [進捗]
### [議論の内容]
### [今後の予定]
### [進路関係]
<br>

## **onogi**
### [進捗]
### [議論の内容]
### [今後の予定]
### [進路関係]
<br>

## **yuga**
### [進捗]
### [議論の内容]
### [今後の予定]
### [進路関係]
<br>

## **kuro**
### [進捗]
### [議論の内容]
### [今後の予定]
### [進路関係]
<br>

## **yoshitomo**
### [進捗]
### [議論の内容]
### [今後の予定]
### [進路関係]
<br>

## **nao**
### [進捗]
### [議論の内容]
### [今後の予定]
### [進路関係]
<br>

## **yu-dai**
### [進捗]
### [議論の内容]
### [今後の予定]
### [進路関係]
<br>

## **sana**
### [進捗]
### [議論の内容]
### [今後の予定]
### [進路関係]
<br>

## **sawaki**
### [進捗]
### [議論の内容]
### [今後の予定]
### [進路関係]
<br>

## **honoka**
### [進捗]
### [議論の内容]
### [今後の予定]
### [進路関係]
<br>

## **kazuma**
### [進捗]
### [議論の内容]
### [今後の予定]
### [進路関係]
<br>
`
  },
  overall: {
    label: "全体ミーティング",
    categoryPrefix: "2.議事録/全体ミーティング",
    titleTemplate: "全体ミーティング #everyone【完成版】",
    markdown: `# **出席者**
- ### [教員]
- [ ] kaji
- ### [M2]
- [ ] rui
- [ ] toyama
- ### [M1]
- [ ] togawa
- [ ] fuma
- [ ] ueji
- [ ] hayato
- ### [B4]
- [ ] kousei
- [ ] nishi
- [ ] hayashi
- [ ] futami
- [ ] ryouta
- [ ] mizutani
- [ ] fuseya
- [ ] hibino
- [ ] kosuke
- [ ] hanao
- [ ] kakumu
- ### [B3]
- [ ] makino
- ### [B2]
- [ ] tada
- [ ] seiken

# **遅刻者**

# **連絡事項**

# **出席率**
[出席管理](https://docs.google.com/spreadsheets/d/1wzKljj2j8EmRHQ5wK6A6RDtfyJbKzUXUfbKyIHURliU/edit#gid=991673774)
<iframe width="100%" height="300" src="https://docs.google.com/spreadsheets/d/e/2PACX-1vR-Y4R7dbToNYyCeaGwiAcwrsq9U3btjFtTG-_Ks16pD-RHFHs6UXjluvWZKuYmcjmQ3FMjfMkHa1Pd/pubhtml?gid=991673774&amp;single=true&amp;widget=true&amp;headers=false"></iframe>
<iframe width="100%" height="371" seamless frameborder="0" scrolling="no" src="https://docs.google.com/spreadsheets/d/e/2PACX-1vR-Y4R7dbToNYyCeaGwiAcwrsq9U3btjFtTG-_Ks16pD-RHFHs6UXjluvWZKuYmcjmQ3FMjfMkHa1Pd/pubchart?oid=899292825&amp;format=interactive"></iframe>

# **進捗**

## **rui**
### [進捗]
### [議論の内容]
### [今後の予定]
<br>

## **toyama**
### [進捗]
### [議論の内容]
### [今後の予定]
<br>

## **togawa**
### [進捗]
### [議論の内容]
### [今後の予定]
<br>

## **fuma**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **ueji**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **hayato**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **kousei**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **nishi**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **hayashi**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **futami**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **ryouta**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **mizutani**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **fuseya**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **hibino**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **kosuke**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **hanao**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **kakumu**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **makino**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **tada**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>

## **seiken**
### [進捗]
### [進路関係]
### [議論の内容]
### [今後の予定]
<br>
`
  }
};

app.get("/", (c) => c.redirect("/hello-ai"));

app.get("/hello-ai", (c) => {
  const optionsHtml = Object.entries(TEMPLATES)
    .map(([key, temp]) => `<option value="${key}">${temp.label}</option>`)
    .join("\n");

  return c.html(`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>議事録AI -> esa自動追記 (Queue対応版)</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { max-width: 760px; margin: 0 auto; padding: 32px 20px; }
      label { display: block; margin-top: 20px; font-weight: 600; }
      textarea, select, input { box-sizing: border-box; width: 100%; margin-top: 8px; padding: 12px; font: inherit; }
      button { margin-top: 20px; padding: 10px 20px; font: inherit; cursor: pointer; background: #0a84ff; color: white; border: none; border-radius: 4px; font-weight: bold; }
      pre { min-height: 80px; padding: 16px; white-space: pre-wrap; border: 1px solid currentColor; border-radius: 8px; }
    </style>
  </head>
  <body>
    <main>
      <h1>議事録AI ⚡️ esa自動追記</h1>
      <form id="ai-form">
        <label for="template">対象の会議</label>
        <select id="template" required>
          <option value="" disabled selected>選択してください</option>
          ${optionsHtml}
        </select>

        <label for="speaker">入力対象の話者</label>
        <select id="speaker" required disabled>
          <option value="" disabled selected>会議を選択してください</option>
        </select>

        <label for="meetingDate">報告会の日付</label>
        <input id="meetingDate" type="date" required>

        <label for="transcriptUrl">RustFS文字起こしURL</label>
        <input id="transcriptUrl" type="url" required>

        <button id="submit-button" type="submit">裏側で議事録を生成・追記する</button>
      </form>

      <h2>送信ステータス</h2>
      <pre id="output">入力して送信してください。</pre>
    </main>

    <script>
      const SPEAKERS = ${JSON.stringify(SPEAKERS)};
      const form = document.querySelector("#ai-form");
      const template = document.querySelector("#template");
      const speakerSelect = document.querySelector("#speaker");
      document.querySelector("#meetingDate").value = new Date().toLocaleDateString("sv-SE");
      
      template.addEventListener("change", (e) => {
        const key = e.target.value;
        speakerSelect.innerHTML = (SPEAKERS[key] || []).map(s => \`<option value="\${s}">\${s === "announcements" ? "連絡事項" : s}</option>\`).join("\\n");
        speakerSelect.disabled = false;
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        document.querySelector("#submit-button").disabled = true;
        document.querySelector("#output").textContent = "キューへ送信中...";

        try {
          const response = await fetch("/api/enqueue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              templateKey: template.value,
              speaker: speakerSelect.value,
              meetingDate: document.querySelector("#meetingDate").value,
              transcriptUrl: document.querySelector("#transcriptUrl").value,
            }),
          });
          
          if (!response.ok) throw new Error("送信エラー");
          document.querySelector("#output").textContent = "✅ キューに登録完了！\\n裏側のターミナル（黒い画面）で進行状況を確認してください。";
          document.querySelector("#transcriptUrl").value = "";
        } catch (error) {
          document.querySelector("#output").textContent = "❌ エラーが発生しました。";
        } finally {
          document.querySelector("#submit-button").disabled = false;
        }
      });
    </script>
  </body>
</html>`);
});

app.post("/api/enqueue", async (c) => {
  const body = await c.req.json<Omit<QueueMessage, "jobId">>();

  const speakers = SPEAKERS[body.templateKey as keyof typeof SPEAKERS];
  let transcriptUrl: URL;

  try {
    transcriptUrl = new URL(body.transcriptUrl);
  } catch {
    return c.json({ error: "文字起こしURLが正しくありません。" }, 400);
  }

  const isAllowedUrl = transcriptUrl.protocol === "https:" &&
    transcriptUrl.hostname === "s3.kajilab.dev" &&
    transcriptUrl.pathname.startsWith("/lab-note/");
  const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(body.meetingDate);

  if (!speakers?.includes(body.speaker) || !isValidDate || !isAllowedUrl) {
    return c.json({ error: "Queueへ登録するデータが正しくありません。" }, 400);
  }

  const jobId = crypto.randomUUID();
  const queueMessage: QueueMessage = { ...body, jobId };

  await saveJobStatus(c.env, jobId, "queued", {
    speaker: body.speaker,
    templateKey: body.templateKey
  });

  try {
    await c.env.MINUTES_QUEUE.send(queueMessage);
  } catch (error) {
    await c.env.AI_JOB_STATUS.delete(jobId);
    throw error;
  }

  return c.json({ jobId, status: "queued" });
});

app.get("/api/status/:jobId", async (c) => {
  const jobId = c.req.param("jobId");

  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    return c.json({ error: "ジョブIDが正しくありません。" }, 400);
  }

  const status = await c.env.AI_JOB_STATUS.get(jobId, "json");

  if (!status) {
    return c.json({ error: "処理状況が見つかりません。" }, 404);
  }

  return c.json(status);
});

export default {
  fetch: app.fetch,
  
  async queue(batch: any, env: Bindings) {
    for (const msg of batch.messages) {
      const { jobId, templateKey, speaker, meetingDate, transcriptUrl } = msg.body as QueueMessage;
      const isAnnouncements = speaker === ANNOUNCEMENTS_SPEAKER;
      const speakerLabel = isAnnouncements ? "連絡事項" : speaker;
      const selectedTemplate = TEMPLATES[templateKey];
      if (!selectedTemplate) {
        await saveJobStatus(env, jobId, "failed", { error: "報告会が見つかりません。" });
        msg.ack();
        continue;
      }

      console.log(`\n========================================`);
      console.log(`🚀 [1/5] キューの処理を開始します: 対象 = ${speakerLabel}`);

      try {
        await saveJobStatus(env, jobId, "processing", { speaker, templateKey });

        const transcriptResponse = await fetch(transcriptUrl);
        if (!transcriptResponse.ok) {
          throw new Error(`文字起こしの取得に失敗しました（HTTP ${transcriptResponse.status}）`);
        }
        const message = await transcriptResponse.text();
        if (!message.trim()) {
          throw new Error("取得した文字起こしが空です。");
        }

        const [yyyy, mm, dd] = meetingDate.split("-");
        const postCategory = `${selectedTemplate.categoryPrefix}/${yyyy}/${mm}/${dd}`;
        const postTitle = selectedTemplate.titleTemplate;

        console.log(`🔍 [2/5] esaから記事を検索・取得中...`);
        const searchQuery = encodeURIComponent(`name:"${postTitle}" category:"${postCategory}"`);
        const searchRes = await fetch(`https://api.esa.io/v1/teams/kjlb/posts?q=${searchQuery}`, {
          headers: { "Authorization": `Bearer ${env.ESA_ACCESS_TOKEN}` }
        });
        if (!searchRes.ok) {
          throw new Error(`esaの記事検索に失敗しました（HTTP ${searchRes.status}）`);
        }
        const searchData: any = await searchRes.json();
        
        let targetPostNumber = null;
        let originalMarkdown = ""; // AIに渡すための枠組み抽出用

        if (searchData.posts && searchData.posts.length > 0) {
          targetPostNumber = searchData.posts[0].number;
          originalMarkdown = searchData.posts[0].body_md;
          console.log(`✅ 既存の記事を発見しました (ID: ${targetPostNumber})`);
        } else {
          console.log(`📝 新規記事を作成中...`);
          const createRes = await fetch("https://api.esa.io/v1/teams/kjlb/posts", {
            method: "POST",
            headers: { "Authorization": `Bearer ${env.ESA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ post: { name: postTitle, body_md: selectedTemplate.markdown, category: postCategory, wip: true } })
          });
          if (!createRes.ok) {
            throw new Error(`esaの記事作成に失敗しました（HTTP ${createRes.status}）`);
          }
          const createData: any = await createRes.json();
          targetPostNumber = createData.number;
          originalMarkdown = selectedTemplate.markdown;
          console.log(`✅ 新規記事を作成しました (ID: ${targetPostNumber})`);
        }

        const speakerRegex = new RegExp(`(## \\*\\*${speaker}\\*\\*[\\s\\S]*?<br>)`, "i");
        const match = originalMarkdown.match(speakerRegex);
        
        if (!isAnnouncements && !match) {
          throw new Error(`${speaker}さんのMarkdownブロックが見つかりません。`);
        }
        if (isAnnouncements) findAnnouncementsSection(originalMarkdown);
        const oldSpeakerBlock = match?.[1] || "";

        const systemPrompt = isAnnouncements ? ANNOUNCEMENTS_PROMPT : `あなたは優秀な議事録作成アシスタントです。
入力された【文字起こし】をもとに、以下の【対象話者のMarkdownブロック】の該当項目（[進捗]、[議論の内容]など）の下に、箇条書きで要約を追記して出力してください。

【厳守するルール】
1. 見出し（## や ###）や改行、一番下の <br> などのMarkdown構造は絶対に崩さず、そのまま出力すること。
2. 余計な挨拶や解説、Markdown記号(\`\`\`markdown など)は一切含めず、純粋なテキストのみを返してください。
3. 該当する文字起こしの内容がない項目は、何も追記せずに空のままにしてください。

【対象話者のMarkdownブロック】
${oldSpeakerBlock}`;

        console.log(`🤖 [3/5] AIに要約とMarkdown生成を依頼中... (数十秒〜数分かかります)`);
        
        const aiResponse = await env.AI.run("@cf/qwen/qwen2.5-coder-32b-instruct", {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `【文字起こし】\n${message}` }
          ],
          max_tokens: isAnnouncements ? 2048 : 1024
        });

        console.log(`✅ [4/5] AIの生成完了！`);
        
        const rawOutput = typeof aiResponse === "string" ? aiResponse : typeof aiResponse?.response === "string" ? aiResponse.response : aiResponse?.response?.text || "";
        let newSpeakerBlock = String(rawOutput).replace(/```markdown/gi, "").replace(/```/g, "").trim();

        if (!isAnnouncements && !newSpeakerBlock.endsWith("<br>")) {
          newSpeakerBlock += "\n<br>";
        }

        console.log(`--- AIが出力したMarkdown ---`);
        console.log(newSpeakerBlock);
        console.log(`---------------------------`);

        // ★★★ ダブルフェッチ（安全対策）★★★
        console.log(`🔄 [4.5/5] 競合を防ぐため、保存直前に最新のesa記事を再取得します...`);
        const latestDocRes = await fetch(`https://api.esa.io/v1/teams/kjlb/posts/${targetPostNumber}`, {
          headers: { "Authorization": `Bearer ${env.ESA_ACCESS_TOKEN}` }
        });
        if (!latestDocRes.ok) {
          throw new Error(`esaの最新記事取得に失敗しました（HTTP ${latestDocRes.status}）`);
        }
        const latestDocData: any = await latestDocRes.json();
        const latestMarkdown = latestDocData.body_md;

        // 最新の記事に対して、自分のブロックだけを入れ替える
        const newMarkdown = isAnnouncements
          ? updateAnnouncementsSection(latestMarkdown, newSpeakerBlock)
          : latestMarkdown.replace(oldSpeakerBlock, newSpeakerBlock);

        console.log(`🚀 [5/5] esaへ最新状態で上書き保存中...`);
        const patchRes = await fetch(`https://api.esa.io/v1/teams/kjlb/posts/${targetPostNumber}`, {
          method: "PATCH",
          headers: { "Authorization": `Bearer ${env.ESA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ post: { body_md: newMarkdown, wip: true,
            message: isAnnouncements ? "連絡事項をAIで更新" : `${speaker} の進捗をAIで更新`
          } })
        });
        
        if (patchRes.ok) {
          await saveJobStatus(env, jobId, "completed", {
            speaker,
            templateKey,
            esaPostNumber: targetPostNumber,
            esaUrl: `https://kjlb.esa.io/posts/${targetPostNumber}`
          });
          console.log(`🎉 処理がすべて完了しました！esaを確認してください。`);
        } else {
          throw new Error(`esaへの保存に失敗しました（HTTP ${patchRes.status}）`);
        }
        console.log(`========================================\n`);

      } catch (e) {
        console.error("Queue処理中のエラー:", e);
        const errorMessage = e instanceof Error ? e.message : String(e);

        if (msg.attempts >= 3) {
          await saveJobStatus(env, jobId, "failed", { error: errorMessage });
          msg.ack();
        } else {
          await saveJobStatus(env, jobId, "retrying", {
            error: errorMessage,
            attempts: msg.attempts
          });
          msg.retry();
        }
      }
    }
  }
};
