import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface ObjectData {
  bytes: Buffer;
  contentType: string | undefined;
  size: number;
}

export class ReceiptStorage {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  get bucketName(): string {
    return this.bucket;
  }

  async presignUpload(key: string, contentType: string, expiresIn = 900): Promise<{ url: string; headers: Record<string, string> }> {
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn },
    );
    return { url, headers: { "Content-Type": contentType } };
  }

  async presignDownload(key: string, filename: string, expiresIn = 900): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `inline; filename="${filename.replace(/["\\\r\n]/g, "_")}"`,
      }),
      { expiresIn },
    );
  }

  async head(key: string): Promise<{ size: number; contentType: string | undefined } | null> {
    try {
      const res = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (err) {
      if ((err as { name?: string }).name === "NotFound") return null;
      throw err;
    }
  }

  async get(key: string): Promise<ObjectData> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty body for ${key}`);
    const bytes = Buffer.from(await res.Body.transformToByteArray());
    return { bytes, contentType: res.ContentType, size: res.ContentLength ?? bytes.length };
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
