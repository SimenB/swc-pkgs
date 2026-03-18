/**
 * Local type declarations for @xhmikosr/bin-wrapper v14.
 *
 * v14 is ESM-only and does not ship TypeScript declarations.
 * This describes the subset of the API used by swcx.
 */
declare module "@xhmikosr/bin-wrapper" {
    interface BinWrapperOptions {
        skipCheck?: boolean;
        strip?: number;
    }

    class BinWrapper {
        constructor(options?: BinWrapperOptions);
        src(url: string, os?: string, arch?: string): this;
        dest(dest: string): this;
        use(bin: string): this;
        version(range: string): this;
        path(): string;
        run(cmd?: string[]): Promise<void>;
    }

    export default BinWrapper;
}
