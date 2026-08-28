import { mkdtempSync, promises, readFileSync, rmSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
    copyFileAtomicallyIfChanged,
    writeFileAtomicallyIfChanged,
    writeFileAtomicallyIfChangedSync,
} from "../util";

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

    it("applies the given mode", async () => {
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
