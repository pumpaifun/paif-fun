function toBigIntLE(buffer) {
  const bytes = Uint8Array.from(buffer);
  let result = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    result = (result << 8n) | BigInt(bytes[index]);
  }
  return result;
}

function toBigIntBE(buffer) {
  const bytes = Uint8Array.from(buffer);
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

function toBufferLE(number, width) {
  assertArguments(number, width);
  const output = new Uint8Array(width);
  let remaining = number;
  for (let index = 0; index < width; index += 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) {
    throw new RangeError("number does not fit in the requested width");
  }
  return output;
}

function toBufferBE(number, width) {
  assertArguments(number, width);
  const output = new Uint8Array(width);
  let remaining = number;
  for (let index = width - 1; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) {
    throw new RangeError("number does not fit in the requested width");
  }
  return output;
}

function assertArguments(number, width) {
  if (typeof number !== "bigint" || number < 0n) {
    throw new TypeError("number must be a non-negative bigint");
  }
  if (!Number.isSafeInteger(width) || width < 0) {
    throw new RangeError("width must be a non-negative safe integer");
  }
}

export {
  toBigIntLE,
  toBigIntBE,
  toBufferLE,
  toBufferBE,
};