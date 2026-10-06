"use strict";

function toBigIntLE(buffer) {
  const reversed = Buffer.from(buffer);
  reversed.reverse();
  return toBigIntBE(reversed);
}

function toBigIntBE(buffer) {
  const hex = Buffer.from(buffer).toString("hex");
  return hex.length === 0 ? 0n : BigInt(`0x${hex}`);
}

function toBufferLE(number, width) {
  const buffer = toBufferBE(number, width);
  buffer.reverse();
  return buffer;
}

function toBufferBE(number, width) {
  if (typeof number !== "bigint" || number < 0n) {
    throw new TypeError("number must be a non-negative bigint");
  }
  if (!Number.isSafeInteger(width) || width < 0) {
    throw new RangeError("width must be a non-negative safe integer");
  }

  const output = Buffer.alloc(width);
  if (width === 0) {
    return output;
  }

  let hex = number.toString(16);
  if (hex.length % 2 !== 0) {
    hex = `0${hex}`;
  }
  const encoded = Buffer.from(hex, "hex");
  if (encoded.length > width) {
    throw new RangeError("number does not fit in the requested width");
  }
  encoded.copy(output, width - encoded.length);
  return output;
}

module.exports = {
  toBigIntLE,
  toBigIntBE,
  toBufferLE,
  toBufferBE,
};