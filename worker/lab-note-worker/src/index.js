import { AwsClient } from "aws4fetch";

const allowedOrigin = "http://127.0.0.1:5501";
const allowedGroups = new Set(["seminar3", "hci", "har", "lbs"]);
const allowedKinds = new Set(["audio", "transcript"]);
const allowedExtensions = new Set(["webm", "mp4", "ogg", "txt"]);

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin"
    };
}

function json(data, status = 200) {
    return Response.json(data, { status, headers: corsHeaders() });
}

function isValidDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidSpeaker(value) {
    return typeof value === "string" && /^[a-z0-9-]+$/.test(value);
}

function getRustFsConfig(env) {
    const requiredKeys = [
        "RUSTFS_ACCESS_KEY",
        "RUSTFS_SECRET_KEY",
        "RUSTFS_ENDPOINT",
        "RUSTFS_REGION",
        "RUSTFS_BUCKET"
    ];
    const missingKeys = requiredKeys.filter(key => !env[key]);

    if (missingKeys.length > 0) {
        throw new Error(`RustFS設定が不足しています: ${missingKeys.join(", ")}`);
    }

    return {
        endpoint: env.RUSTFS_ENDPOINT.replace(/\/$/, ""),
        region: env.RUSTFS_REGION,
        bucket: env.RUSTFS_BUCKET,
        accessKeyId: env.RUSTFS_ACCESS_KEY,
        secretAccessKey: env.RUSTFS_SECRET_KEY
    };
}

function createAwsClient(config) {
    return new AwsClient({
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        service: "s3",
        region: config.region,
        retries: 0
    });
}

async function createSignedUrl(request, env) {
    let body;

    try {
        body = await request.json();
    } catch {
        return json({ error: "JSON形式のリクエストが必要です。" }, 400);
    }

    const { operation, group, date, speaker, kind, extension, number } = body;

    if (!allowedGroups.has(group) || !isValidDate(date) ||
        !isValidSpeaker(speaker) || !allowedKinds.has(kind)) {
        return json({ error: "保存先の指定が正しくありません。" }, 400);
    }

    const config = getRustFsConfig(env);
    const aws = createAwsClient(config);
    const prefix = `${group}/${date}/${speaker}_${kind}_`;

    if (operation === "list") {
        const url = new URL(`${config.endpoint}/${encodeURIComponent(config.bucket)}`);
        url.searchParams.set("list-type", "2");
        url.searchParams.set("prefix", prefix);
        url.searchParams.set("X-Amz-Expires", "300");

        const signedRequest = await aws.sign(url.toString(), {
            method: "GET",
            aws: { signQuery: true }
        });

        return json({ url: signedRequest.url });
    }

    if (operation !== "put" || !allowedExtensions.has(extension) ||
        !Number.isInteger(number) || number < 1 || number > 9999) {
        return json({ error: "アップロード指定が正しくありません。" }, 400);
    }

    if (kind === "transcript" && extension !== "txt") {
        return json({ error: "文字起こしはtxt形式で保存してください。" }, 400);
    }

    if (kind === "audio" && extension === "txt") {
        return json({ error: "音声ファイルの形式が正しくありません。" }, 400);
    }

    const paddedNumber = String(number).padStart(2, "0");
    const key = `${prefix}${paddedNumber}.${extension}`;
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    const url = new URL(
        `${config.endpoint}/${encodeURIComponent(config.bucket)}/${encodedKey}`
    );
    url.searchParams.set("X-Amz-Expires", "300");

    const signedRequest = await aws.sign(url.toString(), {
        method: "PUT",
        aws: { signQuery: true }
    });

    return json({ url: signedRequest.url, key });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        if (request.method === "GET" && url.pathname === "/") {
            return json({ name: "Lab Note Worker", status: "ready" });
        }

        if (request.method === "POST" && url.pathname === "/api/rustfs/presign") {
            try {
                return await createSignedUrl(request, env);
            } catch (error) {
                console.error("RustFS署名URLの生成に失敗しました:", error);
                return json({ error: "署名URLを生成できませんでした。" }, 500);
            }
        }

        return json({ error: "Not Found" }, 404);
    }
};
