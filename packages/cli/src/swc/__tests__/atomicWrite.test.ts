import {
    chmodSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    promises,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
    copyFileAtomicallyIfChanged,
    writeFileAtomicallyIfChanged,
    writeFileAtomicallyIfChangedSync,
} from "../util";

// Windows has no POSIX permission bits: mode always reads back as 0o666.
const itPosix = process.platform === "win32" ? it.skip : it;

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "swc-cli-atomic-"));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

function identity(path: string) {
    const { mtimeMs, ino } = statSync(path);
    return { mtimeMs, ino };
}

async function tmpFiles() {
    const entries = await promises.readdir(dir);
    return entries.filter(entry => entry.endsWith(".tmp"));
}

describe("writeFileAtomicallyIfChanged", () => {
    it("skips the write when the content is identical", async () => {
        const dest = join(dir, "out.js");
        await writeFileAtomicallyIfChanged(dest, "content");
        const before = identity(dest);

        await writeFileAtomicallyIfChanged(dest, "content");

        expect(identity(dest)).toEqual(before);
        expect(await tmpFiles()).toEqual([]);
    });

    it("writes when the content changed", async () => {
        const dest = join(dir, "out.js");
        await writeFileAtomicallyIfChanged(dest, "old");

        await writeFileAtomicallyIfChanged(dest, "new");

        expect(readFileSync(dest, "utf8")).toBe("new");
        expect(await tmpFiles()).toEqual([]);
    });

    itPosix("applies the given mode", async () => {
        const dest = join(dir, "out.js");
        await writeFileAtomicallyIfChanged(dest, "content", { mode: 0o640 });

        expect(statSync(dest).mode & 0o777).toBe(0o640);
    });
});

describe("writeFileAtomicallyIfChangedSync", () => {
    it("skips the write when the content is identical", async () => {
        const dest = join(dir, "out.js");
        writeFileAtomicallyIfChangedSync(dest, "content");
        const before = identity(dest);

        writeFileAtomicallyIfChangedSync(dest, "content");

        expect(identity(dest)).toEqual(before);
        expect(await tmpFiles()).toEqual([]);
    });

    it("writes when the content changed", async () => {
        const dest = join(dir, "out.js");
        writeFileAtomicallyIfChangedSync(dest, "old");

        writeFileAtomicallyIfChangedSync(dest, "new");

        expect(readFileSync(dest, "utf8")).toBe("new");
        expect(await tmpFiles()).toEqual([]);
    });
});

describe("copyFileAtomicallyIfChanged", () => {
    it("skips the copy when the files are identical", async () => {
        const src = join(dir, "src.bin");
        const dest = join(dir, "dest.bin");
        await promises.writeFile(src, Buffer.from([0, 1, 2, 255]));
        await copyFileAtomicallyIfChanged(src, dest);
        const before = identity(dest);

        await copyFileAtomicallyIfChanged(src, dest);

        expect(identity(dest)).toEqual(before);
        expect(await tmpFiles()).toEqual([]);
    });

    it("copies when the source changed", async () => {
        const src = join(dir, "src.bin");
        const dest = join(dir, "dest.bin");
        await promises.writeFile(src, Buffer.from([0, 1, 2, 255]));
        await copyFileAtomicallyIfChanged(src, dest);

        const changed = Buffer.from([3, 4, 5, 254]);
        await promises.writeFile(src, changed);
        await copyFileAtomicallyIfChanged(src, dest);

        expect(await promises.readFile(dest)).toEqual(changed);
        expect(await tmpFiles()).toEqual([]);
    });
});

describe("write-file-atomic behaviour", () => {
    itPosix("keeps the destination's existing mode", async () => {
        const dest = join(dir, "out.js");
        writeFileSync(dest, "old");
        chmodSync(dest, 0o755);

        await writeFileAtomicallyIfChanged(dest, "new");

        expect(statSync(dest).mode & 0o777).toBe(0o755);
    });

    itPosix("writes through a symlinked destination", async () => {
        const target = join(dir, "target.js");
        const link = join(dir, "link.js");
        writeFileSync(target, "old");
        symlinkSync(target, link);

        await writeFileAtomicallyIfChanged(link, "new");

        expect(lstatSync(link).isSymbolicLink()).toBe(true);
        expect(readFileSync(target, "utf8")).toBe("new");
    });

    it("leaves no temp file behind when the write fails", async () => {
        const dest = join(dir, "adir");
        mkdirSync(dest);

        await expect(
            writeFileAtomicallyIfChanged(dest, "content")
        ).rejects.toThrow();

        expect(await tmpFiles()).toEqual([]);
    });

    it("compares bytes rather than decoded text", async () => {
        const dest = join(dir, "malformed.js");
        writeFileSync(dest, Buffer.from([0xff]));

        await writeFileAtomicallyIfChanged(dest, "\uFFFD");

        expect([...readFileSync(dest)]).toEqual([0xef, 0xbf, 0xbd]);
    });

    it("survives concurrent writes to the same destination", async () => {
        const dest = join(dir, "out.js");

        await Promise.all([
            writeFileAtomicallyIfChanged(dest, "a".repeat(100)),
            writeFileAtomicallyIfChanged(dest, "b".repeat(100)),
        ]);

        expect(readFileSync(dest, "utf8")).toHaveLength(100);
        expect(await tmpFiles()).toEqual([]);
    });

    itPosix("copies when only the source mode changed", async () => {
        const src = join(dir, "script.sh");
        const dest = join(dir, "out.sh");
        writeFileSync(src, "#!/bin/sh\n");
        await copyFileAtomicallyIfChanged(src, dest);

        chmodSync(src, 0o755);
        await copyFileAtomicallyIfChanged(src, dest);

        expect(statSync(dest).mode & 0o777).toBe(0o755);
    });
});
