import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { AppError } from '../common/errors/app-error.js';
import type { Env } from '../config/env.js';

/**
 * S3-compatible object storage with short-lived signed URLs (Phase 0 section 3.4).
 *
 * Documents never transit the API process: the client uploads straight to
 * storage with a pre-signed PUT and downloads with a pre-signed GET. That keeps
 * transcripts and passports out of application memory and out of every log line
 * along the path.
 *
 * Signing is implemented here (AWS SigV4 query signing) rather than pulled from
 * the AWS SDK, so the service works unchanged against MinIO locally and any
 * S3-compatible provider in a launch market -- the region and provider are still
 * an open decision (issue #1 section 7, decision 6).
 */
export type StorageOperation = 'PUT' | 'GET';

export interface SignedUrl {
  url: string;
  key: string;
  expiresAt: string;
  /** Headers the client must send verbatim, or the signature will not match. */
  requiredHeaders: Record<string, string>;
}

@Injectable()
export class StorageService {
  constructor(private readonly env: Env) {}

  /**
   * Object keys are opaque and namespaced by owner. They carry no filename and
   * no personal data: a bucket listing must not reveal who applied where.
   */
  buildKey(namespace: string, ownerId: string): string {
    const digest = createHash('sha256').update(`${namespace}:${ownerId}`).digest('hex').slice(0, 16);
    return `${namespace}/${digest}/${randomUUID()}`;
  }

  signUrl(
    operation: StorageOperation,
    key: string,
    options: { ttlSeconds?: number; contentType?: string } = {},
  ): SignedUrl {
    const ttl = Math.min(options.ttlSeconds ?? this.env.SIGNED_URL_TTL_SECONDS, 900);
    if (ttl <= 0) throw new AppError('validation_failed', 'Signed URL lifetime must be positive.');

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${this.env.S3_REGION}/s3/aws4_request`;
    const host = new URL(this.env.S3_ENDPOINT).host;

    const query = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.env.S3_ACCESS_KEY_ID}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(ttl),
      'X-Amz-SignedHeaders': 'host',
    });

    const canonicalRequest = [
      operation,
      `/${this.env.S3_BUCKET}/${key}`,
      // Query parameters must be sorted for the canonical form.
      [...query.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&'),
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const signature = deriveSignature(
      this.env.S3_SECRET_ACCESS_KEY,
      dateStamp,
      this.env.S3_REGION,
      stringToSign,
    );
    query.set('X-Amz-Signature', signature);

    return {
      url: `${this.env.S3_ENDPOINT}/${this.env.S3_BUCKET}/${key}?${query.toString()}`,
      key,
      expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
      requiredHeaders:
        operation === 'PUT' && options.contentType !== undefined
          ? { 'content-type': options.contentType }
          : {},
    };
  }

  /**
   * Reads an object back into memory.
   *
   * The one place the API handles document bytes itself, and it exists for one
   * reason: the malware scanner has to see them. Everything else in the vault
   * uses signed URLs so that transcripts and passports never enter this
   * process. Returns `null` when the object is absent, which the caller must
   * treat as "cannot scan" rather than "nothing to scan".
   */
  async fetchObject(key: string): Promise<Buffer | null> {
    const signed = this.signUrl('GET', key, { ttlSeconds: 60 });
    const response = await fetch(signed.url);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  }
}

function deriveSignature(
  secret: string,
  dateStamp: string,
  region: string,
  stringToSign: string,
): string {
  const kDate = createHmac('sha256', `AWS4${secret}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  return createHmac('sha256', kSigning).update(stringToSign).digest('hex');
}
