/* tslint:disable */
/* eslint-disable */
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */

export type ReadableStreamType = "bytes";

export class Channel {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Close the send side and tear down the connection.
     */
    close(): void;
    /**
     * Dial `node_id` (hex EndpointId) with the given ALPN and open a bi stream.
     * `relay` is the optional relay URL from the pairing payload; passing it
     * lets us reach a peer on a non-default relay (e.g. iroh-canary).
     * `direct_addrs` are optional IP socket addresses from the host endpoint;
     * iroh can use them for LAN/direct paths while retaining relay fallback.
     */
    static connect(node_id: string, alpn: Uint8Array, relay: string | null | undefined, direct_addrs: string[]): Promise<Channel>;
    /**
     * Returns a small JSON summary of currently open iroh paths.
     */
    path_summary(): string;
    /**
     * Take the receive-side ReadableStream (call once).
     */
    readable(): ReadableStream;
    /**
     * Queue bytes to send to the peer.
     */
    send(data: Uint8Array): Promise<void>;
}

export class IntoUnderlyingByteSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableByteStreamController): Promise<any>;
    start(controller: ReadableByteStreamController): void;
    readonly autoAllocateChunkSize: number;
    readonly type: ReadableStreamType;
}

export class IntoUnderlyingSink {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    abort(reason: any): Promise<any>;
    close(): Promise<any>;
    write(chunk: any): Promise<any>;
}

export class IntoUnderlyingSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableStreamDefaultController): Promise<any>;
}

export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_channel_free: (a: number, b: number) => void;
    readonly channel_close: (a: number) => void;
    readonly channel_connect: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly channel_path_summary: (a: number, b: number) => void;
    readonly channel_readable: (a: number, b: number) => void;
    readonly channel_send: (a: number, b: number, c: number) => number;
    readonly start: () => void;
    readonly __wbg_intounderlyingbytesource_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsink_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsource_free: (a: number, b: number) => void;
    readonly intounderlyingbytesource_autoAllocateChunkSize: (a: number) => number;
    readonly intounderlyingbytesource_cancel: (a: number) => void;
    readonly intounderlyingbytesource_pull: (a: number, b: number) => number;
    readonly intounderlyingbytesource_start: (a: number, b: number) => void;
    readonly intounderlyingbytesource_type: (a: number) => number;
    readonly intounderlyingsink_abort: (a: number, b: number) => number;
    readonly intounderlyingsink_close: (a: number) => number;
    readonly intounderlyingsink_write: (a: number, b: number) => number;
    readonly intounderlyingsource_cancel: (a: number) => void;
    readonly intounderlyingsource_pull: (a: number, b: number) => number;
    readonly ring_core_0_17_14__bn_mul_mont: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly __wasm_bindgen_func_elem_13276: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_13300: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_4658: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_1320: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_6332: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_4434: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_5603: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_5628: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_13148: (a: number, b: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export5: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
