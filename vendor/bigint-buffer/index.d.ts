/// <reference types="node" />

export declare function toBigIntLE(buffer: Buffer): bigint;
export declare function toBigIntBE(buffer: Buffer): bigint;
export declare function toBufferLE(number: bigint, width: number): Buffer;
export declare function toBufferBE(number: bigint, width: number): Buffer;