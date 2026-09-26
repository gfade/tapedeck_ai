import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import type { AgentArchive, ArchiveFile } from "../src/archive.ts";
import { AtlasRepository, type AtlasStorage, type PublishSnapshotOptions, type SnapshotManifest } from "../src/atlas.ts";

class MemoryStorage implements AtlasStorage {
	readonly files = new Map<string, Buffer>();
	readonly manifests = new Map<string, SnapshotManifest>();
	readonly uploads: string[] = [];
	readonly events: string[] = [];
	failUpload = 0;
	failPublish = false;
	failRemoval = false;
	closed = false;

	async upload(id: string, _filename: string, source: Readable): Promise<void> {
		this.uploads.push(id);
		this.events.push(`start:${id}`);
		const chunks: Buffer[] = [];
		for await (const chunk of source) {
			chunks.push(Buffer.from(chunk));
			this.files.set(id, Buffer.concat(chunks));
			if (this.failUpload === this.uploads.length) throw new Error("mongodb://username:supersecret@private-host upload failed");
		}
		if (!this.files.has(id)) this.files.set(id, Buffer.alloc(0));
		this.events.push(`end:${id}`);
	}

	download(id: string): Readable {
		const bytes = this.files.get(id);
		if (!bytes) return Readable.from((async function* () { throw new Error("mongodb://secret download failed"); })());
		return Readable.from([bytes]);
	}

	async remove(id: string): Promise<void> {
		if (this.failRemoval) throw new Error("mongodb://secret cleanup failure");
		this.files.delete(id);
	}

	async putManifest(manifest: SnapshotManifest): Promise<void> {
		assert.equal(this.events.filter((event) => event.startsWith("end:")).length, this.uploads.length);
		assert.ok(Object.values(manifest.files).every((file) => this.files.has(file.id)));
		this.events.push("manifest");
		this.manifests.set(manifest.id, structuredClone(manifest));
		if (this.failPublish) throw new Error("mongodb://secret ambiguous insert acknowledgement");
	}

	async getManifest(id: string): Promise<SnapshotManifest | null> { return structuredClone(this.manifests.get(id) ?? null); }
	async listManifests(): Promise<SnapshotManifest[]> { return structuredClone([...this.manifests.values()]); }
	async removeManifest(id: string): Promise<void> { this.manifests.delete(id); }
	async close(): Promise<void> { this.closed = true; }
}

function file(path: string, content: string | Buffer): ArchiveFile {
	const bytes = Buffer.from(content);
	return { path, mode: 0o644, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), data: bytes.toString("base64") };
}

function setup(context: { after: (fn: () => void) => void }): { dir: string; options: PublishSnapshotOptions; storage: MemoryStorage; repository: AtlasRepository } {
	const dir = mkdtempSync(join(tmpdir(), "tapedeck-atlas-test-"));
	context.after(() => rmSync(dir, { recursive: true, force: true }));
	const imagePath = join(dir, "Agent.image");
	const changesPath = join(dir, "Agent.changes");
	const sourcesPath = join(dir, "Pharo.sources");
	writeFileSync(imagePath, Buffer.from([0, 1, 127, 128, 255]));
	writeFileSync(changesPath, "image changes");
	writeFileSync(sourcesPath, "image sources");
	const archive: AgentArchive = { format: "tapedeck.archive/v1", createdAt: new Date().toISOString(), files: [file("reports/saved.json", "{}")], gitBundles: [] };
	const storage = new MemoryStorage();
	return { dir, options: { name: "Portable agent", imagePath, changesPath, sourcesPath, archive }, storage, repository: new AtlasRepository(storage) };
}

test("GridFS abstraction stores image/archive/companions separately and publishes manifest last", async (context) => {
	const { dir, options, storage, repository } = setup(context);
	const snapshot = await repository.publish(options);
	assert.match(snapshot.id, /^[a-f0-9]{24}$/);
	assert.equal(storage.files.size, 4);
	assert.equal(storage.events.at(-1), "manifest");
	assert.ok(JSON.stringify(snapshot).length < 2048);
	assert.deepEqual(JSON.parse(storage.files.get(snapshot.files.archive.id)!.toString()), options.archive);
	assert.deepEqual(await repository.list(), [snapshot]);
	const restored = await repository.restore(snapshot.id, join(dir, "restored"));
	assert.equal(restored.imagePath, join(restored.storePath, "..", "image", "Agent.image"));
	assert.deepEqual(readFileSync(restored.imagePath), readFileSync(options.imagePath));
	assert.equal(readFileSync(restored.changesPath!, "utf8"), "image changes");
	assert.equal(readFileSync(restored.sourcesPath!, "utf8"), "image sources");
	assert.deepEqual(JSON.parse(readFileSync(restored.archivePath, "utf8")), options.archive);
	assert.ok(existsSync(join(restored.store.home, "reports", "saved.json")));
	assert.ok(!readdirSync(dir).some((name) => name.startsWith(".tapedeck-restore-")));
	await repository.close();
	assert.equal(storage.closed, true);
});

test("archive beyond 16MB stays in a blob, not the BSON manifest", async (context) => {
	const { options, storage, repository } = setup(context);
	options.archive.files = [file("reports/large.txt", Buffer.alloc(17 * 1024 * 1024, 65))];
	const snapshot = await repository.publish(options);
	assert.ok(snapshot.files.archive.size > 16 * 1024 * 1024);
	assert.equal(storage.files.get(snapshot.files.archive.id)!.length, snapshot.files.archive.size);
	assert.ok(JSON.stringify(snapshot).length < 2048);
});

test("interrupted upload and ambiguous manifest writes remove all partial snapshot data", async (context) => {
	for (const failure of ["upload", "manifest"]) {
		const { options, storage, repository } = setup(context);
		storage.failUpload = failure === "upload" ? 2 : 0;
		storage.failPublish = failure === "manifest";
		await assert.rejects(repository.publish(options), (error: Error) => /partial uploads were removed/.test(error.message) && !/supersecret|private-host|mongodb:/.test(error.message));
		assert.equal(storage.files.size, 0);
		assert.equal(storage.manifests.size, 0);
	}
});

test("failed cleanup is explicit and does not expose connection credentials", async (context) => {
	const { options, storage, repository } = setup(context);
	storage.failUpload = 2;
	storage.failRemoval = true;
	await assert.rejects(repository.publish(options), (error: Error) => /cleanup was incomplete/.test(error.message) && !error.message.includes("secret"));
	assert.equal(storage.manifests.size, 0);
});

test("corrupt, truncated, oversized, or missing GridFS files never modify restore target", async (context) => {
	for (const corruption of ["checksum", "truncated", "oversized", "missing"]) {
		const { dir, options, storage, repository } = setup(context);
		const snapshot = await repository.publish(options);
		const id = snapshot.files.image.id;
		if (corruption === "missing") storage.files.delete(id);
		else storage.files.set(id, corruption === "truncated" ? Buffer.alloc(1) : corruption === "oversized" ? Buffer.alloc(10) : Buffer.alloc(snapshot.files.image.size));
		const destination = join(dir, "restore");
		mkdirSync(destination);
		await assert.rejects(repository.restore(snapshot.id, destination), /integrity|download/);
		assert.deepEqual(readdirSync(destination), []);
		assert.ok(!readdirSync(dir).some((name) => name.startsWith(".tapedeck-restore-")));
	}
});

test("safe IDs, manifest filenames, symlinks, occupied targets, and byte limits are enforced", async (context) => {
	const { dir, options, storage, repository } = setup(context);
	const snapshot = await repository.publish(options);
	await assert.rejects(repository.restore("../outside", join(dir, "bad")), /ID/);
	const destination = join(dir, "occupied");
	mkdirSync(destination);
	writeFileSync(join(destination, "precious"), "keep");
	await assert.rejects(repository.restore(snapshot.id, destination), /empty/);
	assert.equal(readFileSync(join(destination, "precious"), "utf8"), "keep");
	const manifest = storage.manifests.get(snapshot.id)!;
	manifest.files.image.name = "../outside.image";
	await assert.rejects(repository.restore(snapshot.id, join(dir, "unsafe")), /filename/);
	assert.ok(!existsSync(join(dir, "unsafe")));
	await assert.rejects(new AtlasRepository(new MemoryStorage(), { maxBytes: 1 }).publish(options), /limit/);
	const link = join(dir, "Linked.image");
	symlinkSync(options.imagePath, link);
	const linked = new MemoryStorage();
	await assert.rejects(new AtlasRepository(linked).publish({ ...options, imagePath: link }), /publication failed/);
	assert.equal(linked.uploads.length, 0);
	assert.equal(linked.manifests.size, 0);
});

test("restored run references point to final store, never transaction staging", async (context) => {
	const { dir, options, repository } = setup(context);
	const run = { format: "tapedeck.run/v1", id: "parent", task: "unit", variant: "vanilla", status: "done", repo: "repos/unit.git", sessionFile: "runs/parent/session.jsonl", reportFile: null, snapshotBase: null, snapshotFinal: null, startedAt: new Date().toISOString() };
	options.archive.files = [
		file("runs/parent/run.json", JSON.stringify(run)),
		file("runs/parent/session.jsonl", `${JSON.stringify({ type: "session", cwd: "/original/work/parent" })}\n`),
		file("runs/child/run.json", JSON.stringify({ ...run, id: "child", sessionFile: null, parent: "parent", tapeSource: "/original/runs/parent/session.jsonl" })),
	];
	const snapshot = await repository.publish(options);
	const restored = await repository.restore(snapshot.id, join(dir, "restored"));
	assert.equal(restored.store.getRun("child").tapeSource, join(restored.storePath, "runs", "parent", "session.jsonl"));
	assert.ok(!readFileSync(join(restored.storePath, "runs", "child", "run.json"), "utf8").includes(".tapedeck-restore-"));
});

test("absent and placeholder credentials fail before network access without URI disclosure", async (context) => {
	const { MongoClient } = await import("mongodb");
	const connect = context.mock.method(MongoClient.prototype, "connect", async () => { throw new Error("unexpected connection attempt"); });
	for (const uri of [undefined, "", "mongodb+srv://<user>:<password>@cluster.mongodb.net/", "mongodb+srv://username:secret@cluster.mongodb.net/", "mongodb+srv://real:replace-me@cluster.mongodb.net/", "mongodb+srv://real:%3Csecret%3E@cluster.mongodb.net/", "https://real:secret@private.example.com/", "mongodb+srv://REPLACE_USER:REPLACE_PASSWORD@REPLACE_CLUSTER.mongodb.net/?retryWrites=true&w=majority", "mongodb+srv://REPLACE_USER:valid-token@cluster.mongodb.net/", "mongodb+srv://service:REPLACE_PASSWORD@cluster.mongodb.net/", "mongodb+srv://service:valid-token@REPLACE_CLUSTER.mongodb.net/", "mongodb+srv://YOUR_USERNAME:valid-token@cluster.mongodb.net/", "mongodb+srv://service:valid-token@your-cluster.mongodb.net/"]) {
		await assert.rejects(AtlasRepository.fromEnv({ MONGODB_URI: uri }), (error: Error) => /MONGODB_URI/.test(error.message) && !error.message.includes(uri || "private.example.com") && !error.message.includes("secret"));
	}
	assert.equal(connect.mock.callCount(), 0);
});

test("valid credentials, hosts, and query values may contain placeholder-like substrings", async (context) => {
	const { MongoClient } = await import("mongodb");
	const connect = context.mock.method(MongoClient.prototype, "connect", async () => { throw new Error("offline connection stub"); });
	const uris = [
		"mongodb+srv://yourcompany:password-encrypted-9Yx@yourcluster.mongodb.net/?appName=password-manager",
		"mongodb+srv://service-password-manager:AyourBpasswordC@keepyourpassword.mongodb.net/",
		"mongodb+srv://service:9replace-meQ%40secret@myexample.com/",
		"mongodb://serviceyouruser:7passwordYourX@127.0.0.1:27017,127.0.0.1:27018/?replicaSet=yourProduction",
	];
	for (const uri of uris) await assert.rejects(AtlasRepository.fromEnv({ MONGODB_URI: uri }), (error: Error) => /could not connect to MongoDB/.test(error.message) && !error.message.includes(uri));
	assert.equal(connect.mock.callCount(), uris.length);
});

test("real MongoDB GridFS integration (explicit opt-in only)", { skip: !process.env.TAPEDECK_TEST_MONGODB_URI, timeout: 60_000 }, async (context) => {
	const { dir, options } = setup(context);
	const uri = process.env.TAPEDECK_TEST_MONGODB_URI!;
	const database = process.env.MONGODB_DATABASE || "tapedeck_tests";
	const bucketName = `archive_test_${randomBytes(6).toString("hex")}`;
	const repository = await AtlasRepository.fromEnv({ MONGODB_URI: uri, MONGODB_DATABASE: database, TAPEDECK_ATLAS_BUCKET: bucketName });
	try {
		const snapshot = await repository.publish(options);
		assert.equal((await repository.list()).length, 1);
		const restored = await repository.restore(snapshot.id, join(dir, "real-restored"));
		assert.deepEqual(readFileSync(restored.imagePath), readFileSync(options.imagePath));
	} finally {
		await repository.close();
		const { MongoClient } = await import("mongodb");
		const client = new MongoClient(uri);
		try {
			await client.connect();
			for (const suffix of [".files", ".chunks", "_manifests"]) await client.db(database).collection(`${bucketName}${suffix}`).drop().catch(() => undefined);
		} finally { await client.close(); }
	}
});
