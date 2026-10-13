import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";

describe("Lab Note worker", () => {
	it("responds with its status (unit style)", async () => {
		const request = new Request("http://example.com");
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(await response.json()).toEqual({
			name: "Lab Note Worker",
			status: "ready",
		});
	});

	it("responds with its status (integration style)", async () => {
		const response = await SELF.fetch("http://example.com");
		expect(await response.json()).toEqual({
			name: "Lab Note Worker",
			status: "ready",
		});
	});

	it("rejects an invalid RustFS upload destination", async () => {
		const request = new Request("http://example.com/api/rustfs/presign", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				operation: "put",
				group: "unknown",
				date: "2026-09-18",
				speaker: "fuseya",
				kind: "audio",
				extension: "webm",
				number: 1,
			}),
		});

		const response = await worker.fetch(request, {});
		expect(response.status).toBe(400);
	});

	it("creates a short-lived signed RustFS upload URL", async () => {
		const request = new Request("http://example.com/api/rustfs/presign", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				operation: "put",
				group: "hci",
				date: "2026-09-18",
				speaker: "fuseya",
				kind: "audio",
				extension: "webm",
				number: 1,
			}),
		});
		const testEnv = {
			RUSTFS_ACCESS_KEY: "TESTACCESSKEY",
			RUSTFS_SECRET_KEY: "test-secret-key",
			RUSTFS_ENDPOINT: "http://192.168.200.14:9000",
			RUSTFS_REGION: "us-east-1",
			RUSTFS_BUCKET: "lab-note",
		};

		const response = await worker.fetch(request, testEnv);
		const result = await response.json();

		expect(response.status).toBe(200);
		expect(result.key).toBe("hci/2026/09/18/fuseya_audio_01.webm");
		expect(result.url).toContain("X-Amz-Expires=300");
		expect(result.url).not.toContain(testEnv.RUSTFS_SECRET_KEY);
	});

	it("creates a signed URL for reading a transcript", async () => {
		const request = new Request("http://example.com/api/rustfs/presign", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				operation: "get",
				key: "hci/2026/09/28/fuseya_transcript_01.txt",
			}),
		});
		const testEnv = {
			RUSTFS_ACCESS_KEY: "TESTACCESSKEY",
			RUSTFS_SECRET_KEY: "test-secret-key",
			RUSTFS_ENDPOINT: "https://s3.kajilab.dev",
			RUSTFS_REGION: "us-east-1",
			RUSTFS_BUCKET: "lab-note",
		};

		const response = await worker.fetch(request, testEnv);
		const result = await response.json();

		expect(response.status).toBe(200);
		expect(result.key).toBe("hci/2026/09/28/fuseya_transcript_01.txt");
		expect(result.url).toContain("X-Amz-Expires=86400");
	});

	it("keeps previously stored transcript URLs readable", async () => {
		const request = new Request("http://example.com/api/rustfs/presign", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				operation: "get",
				key: "hci/2026年/9月/28日/fuseya_transcript_01.txt",
			}),
		});
		const testEnv = {
			RUSTFS_ACCESS_KEY: "TESTACCESSKEY",
			RUSTFS_SECRET_KEY: "test-secret-key",
			RUSTFS_ENDPOINT: "https://s3.kajilab.dev",
			RUSTFS_REGION: "us-east-1",
			RUSTFS_BUCKET: "lab-note",
		};

		const response = await worker.fetch(request, testEnv);
		const result = await response.json();

		expect(response.status).toBe(200);
		expect(result.key).toBe("hci/2026年/9月/28日/fuseya_transcript_01.txt");
	});
});
