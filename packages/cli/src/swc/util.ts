import * as swc from "@swc/core";
import slash from "slash";
import writeFileAtomic from "write-file-atomic";
import { mkdirSync, readFileSync, promises } from "fs";
import { dirname, extname, join, relative } from "path";
import { stderr } from "process";

export async function exists(path: string): Promise<boolean> {
    let pathExists = true;
    try {
        await promises.access(path);
    } catch (err: any) {
        pathExists = false;
    }
    return pathExists;
}

export async function transform(
    filename: string,
    code: string,
    opts: swc.Options,
    sync: boolean,
    outputPath: string | undefined
): Promise<swc.Output> {
    opts = {
        filename,
        ...opts,
    };

    if (outputPath) {
        opts.outputPath = outputPath;
    }

    if (sync) {
        return swc.transformSync(code, opts);
    }

    return swc.transform(code, opts);
}

export async function compile(
    filename: string,
    opts: swc.Options,
    sync: boolean,
    outputPath: string | undefined
): Promise<swc.Output | void> {
    opts = {
        ...opts,
    };
    if (outputPath) {
        opts.outputPath = outputPath;
    }

    try {
        const result = sync
            ? swc.transformFileSync(filename, opts)
            : await swc.transformFile(filename, opts);

        if (result.map) {
            // TODO: fix this in core
            // https://github.com/swc-project/swc/issues/1388
            const sourceMap = JSON.parse(result.map);
            if (opts.sourceFileName) {
                sourceMap["sources"][0] = opts.sourceFileName;
            }
            if (opts.sourceRoot) {
                sourceMap["sourceRoot"] = opts.sourceRoot;
            }
            result.map = JSON.stringify(sourceMap);
        }
        return result;
    } catch (err: any) {
        if (!err.message.includes("ignored by .swcrc")) {
            throw err;
        }
    }
}

export function outputFile(
    output: swc.Output,
    filename: string,
    sourceMaps: undefined | swc.Options["sourceMaps"]
) {
    const destDir = dirname(filename);
    mkdirSync(destDir, { recursive: true });

    let code = output.code;
    if (output.map && sourceMaps !== "inline") {
        // we've requested for a sourcemap to be written to disk
        const fileDirName = dirname(filename);
        const mapLoc = filename + ".map";
        code +=
            "\n//# sourceMappingURL=" + slash(relative(fileDirName, mapLoc));
        writeFileAtomicallyIfChangedSync(mapLoc, output.map);
    }

    writeFileAtomicallyIfChangedSync(filename, code);
}

// Watch consumers (bundler child compilers) read these files the moment they
// change: never truncate-write in place, and skip identical content so a
// recompile of unchanged sources causes no downstream rebuilds.
export async function writeFileAtomicallyIfChanged(
    filename: string,
    content: string,
    options?: { mode?: number }
): Promise<void> {
    if (await hasContent(filename, content)) {
        return;
    }

    await writeFileAtomic(filename, content, { ...options, fsync: false });
}

export function writeFileAtomicallyIfChangedSync(
    filename: string,
    content: string
): void {
    try {
        if (readFileSync(filename).equals(Buffer.from(content))) {
            return;
        }
    } catch {}

    writeFileAtomic.sync(filename, content, { fsync: false });
}

export async function copyFileAtomicallyIfChanged(
    src: string,
    dest: string
): Promise<void> {
    if (await isSameFile(src, dest)) {
        return;
    }

    // Copies can be arbitrarily large binaries, so they go through copyFile
    // rather than a buffer. The temporary file must live next to the
    // destination: rename is only atomic within a single filesystem.
    const tmpDest = `${dest}.${process.pid}.${++copies}.tmp`;
    try {
        await promises.copyFile(src, tmpDest);
        await promises.rename(tmpDest, dest);
    } catch (err: any) {
        await promises.unlink(tmpDest).catch(() => {});
        throw err;
    }
}

let copies = 0;

async function hasContent(filename: string, content: string) {
    try {
        const existing = await promises.readFile(filename);
        return existing.equals(Buffer.from(content));
    } catch {
        return false;
    }
}

// Compare size and mode before reading anything: a differing size rules out
// identical content, and copyFile applies the source mode, so a chmod-only
// change still has to be copied.
async function isSameFile(src: string, dest: string) {
    try {
        const [srcStats, destStats] = await Promise.all([
            promises.stat(src),
            promises.stat(dest),
        ]);
        if (
            srcStats.size !== destStats.size ||
            srcStats.mode !== destStats.mode
        ) {
            return false;
        }

        return await hasSameBytes(src, dest);
    } catch {
        return false;
    }
}

// Read in chunks rather than with readFile: a copied asset can be larger than
// the 2 GiB a single buffer holds.
async function hasSameBytes(src: string, dest: string) {
    const chunkSize = 64 * 1024;
    const [srcFile, destFile] = await Promise.all([
        promises.open(src, "r"),
        promises.open(dest, "r"),
    ]);

    try {
        const srcChunk = Buffer.allocUnsafe(chunkSize);
        const destChunk = Buffer.allocUnsafe(chunkSize);

        for (;;) {
            const [srcRead, destRead] = await Promise.all([
                srcFile.read(srcChunk, 0, chunkSize),
                destFile.read(destChunk, 0, chunkSize),
            ]);
            if (srcRead.bytesRead !== destRead.bytesRead) {
                return false;
            }
            if (srcRead.bytesRead === 0) {
                return true;
            }
            const read = srcRead.bytesRead;
            if (
                !srcChunk.subarray(0, read).equals(destChunk.subarray(0, read))
            ) {
                return false;
            }
        }
    } finally {
        await Promise.all([srcFile.close(), destFile.close()]);
    }
}

export function assertCompilationResult<T>(
    result: Map<string, Error | T>,
    quiet = false
): asserts result is Map<string, T> {
    let compiled = 0;
    let copied = 0;
    let failed = 0;
    for (const value of result.values()) {
        if (value instanceof Error) {
            failed++;
        } else if ((value as unknown) === "copied") {
            copied++;
        } else if (value) {
            compiled++;
        }
    }
    if (!quiet && compiled + copied > 0) {
        const copyResult = copied === 0 ? " " : ` (copied ${copied}) `;
        stderr.write(
            `Successfully compiled ${compiled} ${
                compiled !== 1 ? "files" : "file"
            }${copyResult}with swc.\n`
        );
    }

    if (failed > 0) {
        throw new Error(
            `Failed to compile ${failed} ${
                failed !== 1 ? "files" : "file"
            } with swc.`
        );
    }
}

function stripComponents(filename: string) {
    const components = filename.split("/").slice(1);
    if (!components.length) {
        return filename;
    }
    while (components[0] === "..") {
        components.shift();
    }
    return components.join("/");
}

const cwd = process.cwd();

export function getDest(
    filename: string,
    outDir: string,
    stripLeadingPaths: boolean,
    ext?: string
) {
    let base = slash(relative(cwd, filename));
    if (stripLeadingPaths) {
        base = stripComponents(base);
    }
    if (ext) {
        base = base.replace(/\.\w*$/, ext);
    }
    return join(outDir, base);
}

export function mapTsExt(filename: string) {
    return (
        {
            ".ts": "js",
            ".mts": "mjs",
            ".cts": "cjs",
        }[extname(filename)] ?? "js"
    );
}

export function mapDtsExt(filename: string) {
    return (
        {
            ".ts": "d.ts",
            ".mts": "d.mts",
            ".cts": "d.cts",
        }[extname(filename)] ?? "d.ts"
    );
}
