import { createHash, randomBytes } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { prepareArchiveDestination, restoreArchive, validateArchive, type AgentArchive, type ArchiveOptions } from "./archive.ts";
import { Store } from "./store.ts";

export interface SnapshotFile {
	id: string;
	name: string;
	size: number;
	sha256: string;
}

export interface SnapshotManifest {
	format: "tapedeck.snapshot/v1";
	id: string;
	name: string;
	createdAt: string;
	files: {
		image: SnapshotFile;
		archive: SnapshotFile;
		changes?: SnapshotFile;
		sources?: SnapshotFile;
	};
}

export interface AtlasStorage {
	upload(id: string, filename: string, source: Readable): Promise<void>;
	download(id: string): Readable;
	remove(id: string): Promise<void>;
	putManifest(manifest: SnapshotManifest): Promise<void>;
	getManifest(id: string): Promise<unknown | null>;
	listManifests(): Promise<unknown[]>;
	removeManifest(id: string): Promise<void>;
	close(): Promise<void>;
}

export interface AtlasOptions {
	maxBytes?: number;
	archiveOptions?: ArchiveOptions;
}

export interface PublishSnapshotOptions {
	name: string;
	imagePath: string;
	archive: AgentArchive;
	changesPath?: string;
	sourcesPath?: string;
}

export interface RestoredSnapshot {
	snapshot: SnapshotManifest;
	imagePath: string;
	archivePath: string;
	changesPath?: string;
	sourcesPath?: string;
	storePath: string;
	store: Store;
}

const ID = /^[a-f0-9]{24}$/;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const PARTS = ["image", "archive", "changes", "sources"] as const;
type Part = typeof PARTS[number];

function fail(message: string): never {
	throw new Error(`Atlas: ${message}`);
}

function snapshotId(value: unknown): string {
	if (typeof value !== "string" || !ID.test(value)) fail("invalid snapshot/file ID");
	return value;
}

function filename(value: unknown): string {
	if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,179}$/.test(value) || /[. ]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(value)) fail("unsafe snapshot filename");
	return value;
}

function displayName(value: unknown): string {
	if (typeof value !== "string" || !value.trim() || value.length > 160 || /[\x00-\x1f\x7f]/.test(value)) fail("snapshot name must contain 1–160 printable characters");
	return value;
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid snapshot manifest");
	return value as Record<string, unknown>;
}

function validateManifest(value: unknown, maxBytes: number): SnapshotManifest {
	const manifest = object(value);
	snapshotId(manifest.id);
	displayName(manifest.name);
	if (manifest.format !== "tapedeck.snapshot/v1" || typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt))) fail("invalid snapshot manifest format/date");
	const files = object(manifest.files);
	if (!files.image || !files.archive || Object.keys(files).some((key) => !PARTS.includes(key as Part))) fail("invalid snapshot file set");
	const ids = new Set<string>();
	const names = new Set<string>();
	let size = 0;
	for (const part of PARTS) {
		if (files[part] === undefined) continue;
		const file = object(files[part]);
		const id = snapshotId(file.id);
		const name = filename(file.name);
		if (ids.has(id) || names.has(name.toLowerCase())) fail("duplicate snapshot file");
		ids.add(id);
		names.add(name.toLowerCase());
		if (!Number.isSafeInteger(file.size) || (file.size as number) < 0 || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) fail("invalid snapshot integrity metadata");
		size += file.size as number;
		if (size > maxBytes) fail("snapshot exceeds total byte limit");
		if (!name.endsWith(part === "archive" ? ".json" : `.${part}`)) fail("unexpected companion file extension");
	}
	return manifest as unknown as SnapshotManifest;
}

function meter(limit: number): { stream: Transform; result: () => { size: number; sha256: string } } {
	const hash = createHash("sha256");
	let size = 0;
	return {
		stream: new Transform({
			transform(chunk: Buffer, _encoding, callback) {
				size += chunk.length;
				if (size > limit) callback(new Error("Atlas: snapshot exceeds total byte limit"));
				else {
					hash.update(chunk);
					callback(null, chunk);
				}
			},
		}),
		result: () => ({ size, sha256: hash.digest("hex") }),
	};
}

export class AtlasRepository {
	private readonly storage: AtlasStorage;
	private readonly maxBytes: number;
	private readonly archiveOptions: ArchiveOptions;

	constructor(storage: AtlasStorage, options: AtlasOptions = {}) {
		this.storage = storage;
		this.maxBytes = options.maxBytes ?? Number(process.env.TAPEDECK_ATLAS_MAX_BYTES ?? DEFAULT_MAX_BYTES);
		this.archiveOptions = options.archiveOptions ?? {};
		if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes <= 0) fail("byte limit must be a positive safe integer");
	}

	static async fromEnv(env: NodeJS.ProcessEnv = process.env, options: AtlasOptions = {}): Promise<AtlasRepository> {
		const uri = env.MONGODB_URI?.trim();
		if (!uri) fail("MONGODB_URI is required; configure real MongoDB Atlas credentials");
		if (placeholderConnection(uri)) fail("MONGODB_URI contains invalid or placeholder credentials; configure a real connection string");
		const database = env.MONGODB_DATABASE || "tapedeck";
		const bucketName = env.TAPEDECK_ATLAS_BUCKET || "tapedeck_snapshots";
		if (![database, bucketName].every((name) => /^[A-Za-z0-9_-]{1,63}$/.test(name))) fail("MONGODB_DATABASE and TAPEDECK_ATLAS_BUCKET must be simple database/bucket names");
		const { MongoClient, GridFSBucket, ObjectId } = await import("mongodb");
		let client: InstanceType<typeof MongoClient>;
		try {
			client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000, connectTimeoutMS: 10_000 });
		} catch {
			return fail("invalid MongoDB connection configuration (connection string withheld)");
		}
		try {
			await client.connect();
			const db = client.db(database);
			const bucket = new GridFSBucket(db, { bucketName });
			const manifests = db.collection<SnapshotManifest & { _id: string }>(`${bucketName}_manifests`);
			const storage: AtlasStorage = {
				async upload(id, name, source) {
					const stream = bucket.openUploadStreamWithId(new ObjectId(id), name);
					try {
						await pipeline(source, stream);
					} catch (error) {
						await stream.abort().catch(() => undefined);
						throw error;
					}
				},
				download: (id) => bucket.openDownloadStream(new ObjectId(id)),
				async remove(id) {
					await bucket.delete(new ObjectId(id)).catch(async () => {
						await db.collection(`${bucketName}.chunks`).deleteMany({ files_id: new ObjectId(id) });
						await db.collection(`${bucketName}.files`).deleteOne({ _id: new ObjectId(id) });
					});
				},
				async putManifest(manifest) { await manifests.insertOne({ ...manifest, _id: manifest.id }); },
				getManifest: (id) => manifests.findOne({ _id: id }),
				listManifests: () => manifests.find({ format: "tapedeck.snapshot/v1" }).sort({ createdAt: -1, _id: -1 }).toArray(),
				async removeManifest(id) { await manifests.deleteOne({ _id: id }); },
				close: () => client.close(),
			};
			return new AtlasRepository(storage, options);
		} catch {
			await client.close().catch(() => undefined);
			return fail("could not connect to MongoDB; check credentials, Atlas network access, and database permissions (connection string withheld)");
		}
	}

	async publish(options: PublishSnapshotOptions): Promise<SnapshotManifest> {
		displayName(options.name);
		const archive = validateArchive(options.archive, this.archiveOptions);
		const bytes = Buffer.from(JSON.stringify(archive));
		if (bytes.length > this.maxBytes) fail("snapshot exceeds total byte limit");
		const id = randomBytes(12).toString("hex");
		const files = {} as SnapshotManifest["files"];
		const uploaded: string[] = [];
		const handles: Awaited<ReturnType<typeof open>>[] = [];
		const sources: { part: Part; name: string; size: number; source: () => Readable }[] = [{ part: "archive", name: "archive.json", size: bytes.length, source: () => Readable.from([bytes]) }];
		let total = bytes.length;
		try {
			for (const part of ["image", "changes", "sources"] as const) {
				const path = options[`${part}Path`];
				if (!path) {
					if (part === "image") fail("imagePath is required");
					continue;
				}
				const name = filename(basename(path));
				if (!name.endsWith(`.${part}`)) fail(`expected a .${part} file`);
				const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
				handles.push(handle);
				const stat = await handle.stat();
				if (!stat.isFile()) fail("snapshot companions must be regular files, not symlinks");
				total += stat.size;
				if (total > this.maxBytes) fail("snapshot exceeds total byte limit");
				sources.push({ part, name, size: stat.size, source: () => handle.createReadStream({ autoClose: false }) });
			}
			for (const item of sources) {
				const fileId = randomBytes(12).toString("hex");
				uploaded.push(fileId);
				const checksum = meter(item.size);
				const source = item.source();
				const pumping = pipeline(source, checksum.stream);
				try {
					await Promise.all([pumping, this.storage.upload(fileId, item.name, checksum.stream)]);
				} catch (error) {
					source.destroy();
					checksum.stream.destroy();
					await pumping.catch(() => undefined);
					throw error;
				}
				const result = checksum.result();
				if (result.size !== item.size) fail("source file changed during upload");
				files[item.part] = { id: fileId, name: item.name, ...result };
			}
			const snapshot = validateManifest({ format: "tapedeck.snapshot/v1", id, name: options.name, createdAt: new Date().toISOString(), files }, this.maxBytes);
			await this.storage.putManifest(snapshot);
			return snapshot;
		} catch {
			const cleanup = await Promise.allSettled([this.storage.removeManifest(id), ...uploaded.map((fileId) => this.storage.remove(fileId))]);
			return fail(cleanup.some((result) => result.status === "rejected") ? "snapshot publication failed; partial-upload cleanup was incomplete; administrative cleanup may be required" : "snapshot publication failed; partial uploads were removed (connection details withheld)");
		} finally {
			await Promise.all(handles.map((handle) => handle.close()));
		}
	}

	async restore(id: string, destination: string): Promise<RestoredSnapshot> {
		snapshotId(id);
		let value: unknown;
		try { value = await this.storage.getManifest(id); } catch { return fail("could not read snapshot manifest (connection details withheld)"); }
		if (!value) fail("snapshot not found");
		const snapshot = validateManifest(value, this.maxBytes);
		if (snapshot.id !== id) fail("snapshot ID does not match manifest");
		const transaction = await prepareArchiveDestination(destination);
		try {
			await mkdir(join(transaction.staging, "image"));
			for (const part of PARTS) {
				const file = snapshot.files[part];
				if (!file) continue;
				const path = part === "archive" ? join(transaction.staging, file.name) : join(transaction.staging, "image", file.name);
				const checksum = meter(file.size);
				try {
					await pipeline(this.storage.download(file.id), checksum.stream, createWriteStream(path, { flags: "wx", mode: 0o600 }));
				} catch { return fail("snapshot download failed or exceeded expected size (connection details withheld)"); }
				const result = checksum.result();
				if (result.size !== file.size || result.sha256 !== file.sha256) fail("snapshot SHA256 integrity check failed");
			}
			let archive: unknown;
			try { archive = JSON.parse(await readFile(join(transaction.staging, snapshot.files.archive.name), "utf8")); } catch { return fail("snapshot archive is not valid JSON"); }
			const storePath = join(transaction.target, "store");
			await restoreArchive(archive, join(transaction.staging, "store"), { ...this.archiveOptions, referenceHome: storePath });
			await transaction.commit();
			return {
				snapshot,
				imagePath: join(transaction.target, "image", snapshot.files.image.name),
				archivePath: join(transaction.target, snapshot.files.archive.name),
				...(snapshot.files.changes ? { changesPath: join(transaction.target, "image", snapshot.files.changes.name) } : {}),
				...(snapshot.files.sources ? { sourcesPath: join(transaction.target, "image", snapshot.files.sources.name) } : {}),
				storePath, store: Store.open(storePath),
			};
		} finally {
			await transaction.cleanup();
		}
	}

	async list(): Promise<SnapshotManifest[]> {
		let values: unknown[];
		try { values = await this.storage.listManifests(); } catch { return fail("could not list snapshots (connection details withheld)"); }
		return values.map((value) => validateManifest(value, this.maxBytes)).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
	}

	async close(): Promise<void> {
		try { await this.storage.close(); } catch { fail("could not close MongoDB connection (connection details withheld)"); }
	}
}

function placeholderConnection(uri: string): boolean {
	const authority = /^mongodb(?:\+srv)?:\/\/([^/?#]+)/.exec(uri)?.[1];
	if (!authority) return true;
	const separator = authority.lastIndexOf("@");
	const credentials = separator < 0 ? [] : authority.slice(0, separator).split(":");
	const hosts = authority.slice(separator + 1).split(",");
	const placeholder = (component: string): boolean => /^(?:username|password|placeholder|replace[-_]?me|change[-_]?me|<[^<>]+>)$/i.test(component) || /^(?:replace|your|insert|enter)[-_]/i.test(component);
	try {
		if (credentials.some((component) => placeholder(decodeURIComponent(component)))) return true;
		return hosts.some((host) => {
			const decoded = decodeURIComponent(host).replace(/:\d+$/, "");
			return !decoded || /(?:^|\.)example\.(?:com|net|org)$/i.test(decoded) || /^cluster0\.xxxxx(?:\.|$)/i.test(decoded) || decoded.split(".").some(placeholder);
		});
	} catch {
		return true;
	}
}
