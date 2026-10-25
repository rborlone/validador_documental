import { Transform, TransformCallback } from 'node:stream';
import { UploadTooLargeError } from './documents.client';

/** Corta el stream si supera `maxBytes` (defensa cuando no viene content-length o es falso). */
export class SizeLimitStream extends Transform {
  private seen = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.seen += chunk.length;
    if (this.seen > this.maxBytes) {
      cb(new UploadTooLargeError(`La subida supera el máximo permitido de ${Math.round(this.maxBytes / 1024 / 1024)} MB.`));
      return;
    }
    cb(null, chunk);
  }
}
