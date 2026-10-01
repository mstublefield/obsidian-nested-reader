/**
 * The only module that touches Node built-ins.
 *
 * The plugin directory's review lints the source without @types/node
 * installed, which turns every Node API into an unresolved (error-typed)
 * value. Each built-in is therefore imported here and re-exported through a
 * small local interface describing just what this plugin uses, so the rest
 * of the code stays fully typed either way. The static imports are kept so
 * esbuild still treats these modules as externals.
 */
import * as childProcessModule from "child_process";
import * as fsModule from "fs";
import * as httpsModule from "https";
import * as osModule from "os";
import * as pathModule from "path";
import * as processModule from "process";

export type Env = Record<string, string | undefined>;

interface Readable {
	setEncoding(encoding: string): void;
	on(event: "data", listener: (chunk: string) => void): void;
}

interface Writable {
	on(event: "error", listener: (e: Error) => void): void;
	end(data?: string): void;
}

export interface ChildProcess {
	stdin: Writable;
	stdout: Readable;
	stderr: Readable;
	on(event: "error", listener: (e: Error) => void): void;
	on(event: "close", listener: (code: number | null) => void): void;
	kill(): void;
}

export interface SpawnOptions {
	cwd?: string;
	env?: Env;
	stdio?: string[];
}

export interface HttpResponse {
	statusCode?: number;
	setEncoding(encoding: string): void;
	on(event: "data", listener: (chunk: string) => void): void;
	on(event: "end", listener: () => void): void;
	on(event: "error", listener: (e: Error) => void): void;
}

export interface HttpRequest {
	on(event: "error", listener: (e: Error) => void): void;
	end(data?: string): void;
	destroy(): void;
}

export interface RequestOptions {
	method?: string;
	headers?: Record<string, string | number>;
}

interface ChildProcessApi {
	spawn: (command: string, args: string[], options?: SpawnOptions) => ChildProcess;
}
interface FsApi {
	existsSync: (path: string) => boolean;
	mkdirSync: (path: string, options?: { recursive?: boolean }) => unknown;
	readdirSync: (path: string) => string[];
}
interface OsApi {
	homedir: () => string;
	tmpdir: () => string;
}
interface PathApi {
	join: (...parts: string[]) => string;
	delimiter: string;
}
interface HttpsApi {
	request: (url: string, options: RequestOptions, callback: (res: HttpResponse) => void) => HttpRequest;
}
interface ProcessApi {
	env: Env;
}

const childProcess = childProcessModule as unknown as ChildProcessApi;
const fs = fsModule as unknown as FsApi;
const os = osModule as unknown as OsApi;
const path = pathModule as unknown as PathApi;
const https = httpsModule as unknown as HttpsApi;
const proc = processModule as unknown as ProcessApi;

export const spawn = childProcess.spawn;
export const existsSync = fs.existsSync;
export const mkdirSync = fs.mkdirSync;
export const readdirSync = fs.readdirSync;
export const homedir = os.homedir;
export const tmpdir = os.tmpdir;
export const join = path.join;
export const delimiter = path.delimiter;
export const request = https.request;

/** The process environment. */
export function env(): Env {
	return proc.env;
}
