import { Hono } from "hono";
import { cors } from "hono/cors";
import { ANNOUNCEMENTS_PROMPT, findAnnouncementsSection, updateAnnouncementsSection } from "./announcements.ts";

type QueueMessage = {
  jobId: string;
  templateKey: string;
  speaker: string;
  meetingDate: string;
  transcriptUrl: string;
  presentationEsaUrl?: string;
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

type PresentationEsaInfo = {
  title: string;
  content: string;
  url: string;
  error?: string;
};

async function fetchPresentationEsa(
  urlString: string,
  accessToken: string
): Promise<PresentationEsaInfo> {
  const trimmedUrl = urlString.trim();
  try {
    const url = new URL(trimmedUrl);
    const postMatch = url.pathname.match(/\/posts\/(\d+)/);
    if (!postMatch) {
      return { title: "", content: "", url: trimmedUrl, error: "URLに投稿IDが含まれていません" };
    }

    const team = url.hostname.endsWith(".esa.io") ? url.hostname.split(".")[0] : "kjlb";
    const response = await fetch(`https://api.esa.io/v1/teams/${team}/posts/${postMatch[1]}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      return { title: "", content: "", url: trimmedUrl, error: `記事取得エラー (HTTP ${response.status})` };
    }

    const data: any = await response.json();
    const content = typeof data.body_md === "string" ? data.body_md : "";
    if (!content.trim()) {
      return { title: data.name || "", content: "", url: data.url || trimmedUrl, error: "記事本文が空でした" };
    }
    return { title: data.name || "", content, url: data.url || trimmedUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { title: "", content: "", url: trimmedUrl, error: `取得失敗 (${message})` };
  }
}

async function resolvePresentationEsa(
  speaker: string,
  meetingDate: string,
  manualUrl: string | undefined,
  accessToken: string
): Promise<PresentationEsaInfo> {
  if (manualUrl?.trim()) {
    return fetchPresentationEsa(manualUrl, accessToken);
  }

  const dateMatch = meetingDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) {
    return { title: "", content: "", url: "", error: `報告日が正しくありません: ${meetingDate}` };
  }
  const [, year, month, day] = dateMatch;
  const normalizedMonth = String(Number(month));
  const normalizedDay = String(Number(day));
  const dateCategories = [[month, day], [normalizedMonth, normalizedDay]];
  const baseCategory = `1.進捗報告(個人)/${year}年度/3.B3/${speaker}`;
  const queries = dateCategories.map(([categoryMonth, categoryDay]) => ({
    date: `${categoryMonth}/${categoryDay}`,
    categoryMonth,
    categoryDay,
    query: `category:"${baseCategory}/${categoryMonth}/${categoryDay}"`
  }));

  const normalizeCategory = (category: unknown) => typeof category === "string"
    ? category.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/").toLowerCase()
    : "";

  try {
    for (const { date, categoryMonth, categoryDay, query: rawQuery } of queries) {
      const query = encodeURIComponent(rawQuery);
      const response = await fetch(`https://api.esa.io/v1/teams/kjlb/posts?q=${query}&per_page=100`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        console.warn(`esa記事の自動検索に失敗しました: query=${rawQuery}, HTTP=${response.status}`);
        continue;
      }

      const data: any = await response.json();
      const posts = Array.isArray(data.posts) ? data.posts : [];
      const post = posts.find((candidate: any) => {
        const category = normalizeCategory(candidate.category);
        const expectedPrefix = normalizeCategory(baseCategory);
        const pathParts = category.split("/");
        const expectedParts = expectedPrefix.split("/");
        const hasExpectedPrefix = expectedParts.every((part, index) => pathParts[index] === part);
        const hasExpectedDate = pathParts.some((part, index) => index >= expectedParts.length &&
          (part === categoryMonth && pathParts[index + 1] === categoryDay ||
            part === normalizedMonth && pathParts[index + 1] === normalizedDay));
        return hasExpectedPrefix && hasExpectedDate;
      });
      if (post) {
        if (!post.url && !post.number) continue;
        const postUrl = post.url || `https://kjlb.esa.io/posts/${post.number}`;
        const result = await fetchPresentationEsa(postUrl, accessToken);
        console.log(`esa発表資料の取得結果: query=${rawQuery}, title=${result.title}, url=${result.url}, contentLength=${result.content.length}, error=${result.error || "なし"}`);
        return result;
      }
    }
    return { title: "", content: "", url: "", error: `${baseCategory}/${dateCategories[0].join("/")} の進捗報告記事が見つかりませんでした` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { title: "", content: "", url: "", error: `検索エラー (${message})` };
  }
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
  const presentationEsaUrl = typeof body.presentationEsaUrl === "string" && body.presentationEsaUrl.trim()
    ? body.presentationEsaUrl.trim()
    : undefined;

  if (!speakers?.includes(body.speaker) || !isValidDate || !isAllowedUrl) {
    return c.json({ error: "Queueへ登録するデータが正しくありません。" }, 400);
  }

  const jobId = crypto.randomUUID();
  const queueMessage: QueueMessage = { ...body, presentationEsaUrl, jobId };

  await saveJobStatus(c.env, jobId, "queued", {
    speaker: body.speaker,
    templateKey: body.templateKey,
    presentationEsaUrl
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
      const { jobId, templateKey, speaker, meetingDate, transcriptUrl, presentationEsaUrl } = msg.body as QueueMessage;
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

      let stage = "transcript";
      let lastStatusWriteAt = Date.now();
      const stageLabels: Record<string, string> = {
        transcript: "文字起こしの取得", esa_prepare: "esa記事の準備",
        ai: "AI要約の生成", esa_post: "esaへの投稿"
      };
      const persistStatus = async (status: JobStatus, details: Record<string, unknown> = {}) => {
        // KVの同一キーへの短時間の連続書き込みを避ける。
        const delay = Math.max(0, 1100 - (Date.now() - lastStatusWriteAt));
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        await saveJobStatus(env, jobId, status, { speaker, templateKey, stage, ...details });
        lastStatusWriteAt = Date.now();
      };
      try {
        await persistStatus("processing");

        const transcriptResponse = await fetch(transcriptUrl);
        if (!transcriptResponse.ok) {
          throw new Error(`文字起こしの取得に失敗しました（HTTP ${transcriptResponse.status}）`);
        }
        const message = await transcriptResponse.text();
        if (!message.trim()) {
          throw new Error("取得した文字起こしが空です。");
        }

        let presentation: PresentationEsaInfo = { title: "", content: "", url: "" };
        if (!isAnnouncements) {
          try {
            presentation = await resolvePresentationEsa(speaker, meetingDate, presentationEsaUrl, env.ESA_ACCESS_TOKEN);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            presentation = { title: "", content: "", url: "", error: `取得失敗 (${message})` };
          }
        }

        const [yyyy, mm, dd] = meetingDate.split("-");
        const postCategory = `${selectedTemplate.categoryPrefix}/${yyyy}/${mm}/${dd}`;
        const postTitle = selectedTemplate.titleTemplate;

        console.log(`🔍 [2/5] esaから記事を検索・取得中...`);
        stage = "esa_prepare";
        await persistStatus("processing");
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

        const presentationContext = presentation.content
          ? `\n\n【要約の主資料: 個人発表用esa記事】\nタイトル: ${presentation.title}\nURL: ${presentation.url}\n本文（先頭12000文字）:\n${presentation.content.slice(0, 12000)}\n\nこのesa本文に書かれた研究内容・進捗・結果・今後の予定を要約の中心にしてください。文字起こしは会議での補足、更新点、質疑の確認に使ってください。`
          : presentation.error
            ? `\n\n【個人発表用esa記事】\n参照できませんでした: ${presentation.error}`
            : "";
        const systemPrompt = isAnnouncements ? ANNOUNCEMENTS_PROMPT : `あなたは優秀な議事録作成アシスタントです。
      個人発表用esa記事が入力されている場合は、それを要約の主資料として扱い、記事に書かれた具体的な内容を必ず議事録内の該当話者欄へ反映してください。文字起こしだけを要約してesa記事の内容を省略してはいけません。文字起こしは会議中の補足・更新・議論を加えるために使ってください。esa記事がない場合に限り、文字起こしを主資料にしてください。
      以下の既存Markdownの該当項目（[進捗]、[議論の内容]など）の下に、記事の内容を保った具体的な箇条書きで追記して出力してください。

      ${presentationContext}

【厳守するルール】
1. 見出し（## や ###）や改行、一番下の <br> などのMarkdown構造は絶対に崩さず、そのまま出力すること。
2. 余計な挨拶や解説、Markdown記号(\`\`\`markdown など)は一切含めず、純粋なテキストのみを返してください。
3. esa記事に書かれた進捗は文字起こしに同じ発言がなくても省略せず、該当する項目に要約して記載してください。esa記事にも文字起こしにも根拠がない内容は追加しないでください。
4. 「UWBについて研究を進めている」のような抽象的な表現で終わらせず、UWBが何を指すか、何を目的に、どの対象へ、どの手法・データ・実験で取り組んでいるかを、esa記事を中心に具体化してください。
5. 各トピックは可能な限り「対象・目的・実施内容・結果または分かったこと・次の作業」が分かる粒度にしてください。根拠がない内容は推測で補わず、「確認できなかった」としてください。
6. 専門用語や略語は、記事や文字起こしに説明があれば正式名称や役割を併記してください。説明がなければ意味を創作せず、用語そのものを残してください。

【更新対象の既存Markdown】
${oldSpeakerBlock}`;

        console.log(`🤖 [3/5] AIに要約とMarkdown生成を依頼中... (数十秒〜数分かかります)`);
        stage = "ai";
        await persistStatus("processing");
        
        const aiResponse = await env.AI.run("@cf/qwen/qwen2.5-coder-32b-instruct", {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `【文字起こし】\n${message}` }
          ],
          max_tokens: isAnnouncements ? 2048 : 1536
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
        stage = "esa_post";
        await persistStatus("processing");
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
          await persistStatus("completed", {
            speaker,
            templateKey,
            esaPostNumber: targetPostNumber,
            esaUrl: `https://kjlb.esa.io/posts/${targetPostNumber}`,
            presentationEsaWarning: presentation.error || ""
          });
          console.log(`🎉 処理がすべて完了しました！esaを確認してください。`);
        } else {
          throw new Error(`esaへの保存に失敗しました（HTTP ${patchRes.status}）`);
        }
        console.log(`========================================\n`);

      } catch (e) {
        console.error("Queue処理中のエラー:", e);
        const errorMessage = `${stageLabels[stage]}: ${e instanceof Error ? e.message : String(e)}`;

        if (msg.attempts >= 3) {
          await persistStatus("failed", { error: errorMessage });
          msg.ack();
        } else {
          await persistStatus("retrying", {
            error: errorMessage,
            attempts: msg.attempts
          });
          msg.retry();
        }
      }
    }
  }
};
