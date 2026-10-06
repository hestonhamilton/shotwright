import zlib from 'node:zlib'

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(typeName: string, data: Buffer): Buffer {
  const type = Buffer.from(typeName, 'ascii')
  const value = Buffer.alloc(12 + data.byteLength)
  value.writeUInt32BE(data.byteLength, 0)
  type.copy(value, 4)
  data.copy(value, 8)
  value.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.byteLength)
  return value
}

export function makePng(width = 20, height = 10, marker = 0): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  const rowLength = width * 4 + 1
  const rows = Buffer.alloc(rowLength * height)
  for (let row = 0; row < height; row++) {
    rows.fill(marker & 0xff, row * rowLength + 1, (row + 1) * rowLength)
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
