import { connect } from 'node:net';
import type { MalwareScanner, ScanVerdict } from './scanner.port.js';

/**
 * ClamAV adapter, speaking clamd's `INSTREAM` protocol directly.
 *
 * No client library: the protocol is four lines of framing, and a dependency
 * here would be a supply-chain surface sitting directly in the path of every
 * student's passport. `docker-compose.yml` runs `clamav/clamav` locally so the
 * flow is exercised the same way it is in a deployed environment.
 *
 * Errors resolve to `failed`, never to `clean`. A scanner that cannot be
 * reached must not be able to release a document.
 */
export class ClamAvScanner implements MalwareScanner {
  readonly name = 'clamav';

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 30_000,
  ) {}

  async scan(bytes: Buffer): Promise<ScanVerdict> {
    try {
      const response = await this.instream(bytes);
      // clamd answers "stream: OK" or "stream: <signature> FOUND".
      if (/\bOK\b/.test(response)) return { state: 'clean', detail: null };
      if (/\bFOUND\b/.test(response)) {
        const signature = response.replace(/^stream:\s*/, '').replace(/\s*FOUND\s*$/, '').trim();
        return {
          state: 'quarantined',
          detail: signature.length > 0 ? `Malware signature: ${signature}` : 'Malware detected.',
        };
      }
      return { state: 'failed', detail: `Unexpected scanner response: ${response.trim()}` };
    } catch (error) {
      return {
        state: 'failed',
        detail: error instanceof Error ? error.message : 'The malware scanner could not be reached.',
      };
    }
  }

  private instream(bytes: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];

      socket.setTimeout(this.timeoutMs, () => {
        socket.destroy();
        reject(new Error('The malware scanner timed out.'));
      });

      socket.on('error', reject);
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      socket.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        // Chunked as <4-byte big-endian length><bytes>, terminated by a zero
        // length. clamd rejects a chunk over its StreamMaxLength, so 64KiB
        // keeps well inside every default.
        const CHUNK = 64 * 1024;
        for (let offset = 0; offset < bytes.length; offset += CHUNK) {
          const slice = bytes.subarray(offset, offset + CHUNK);
          const header = Buffer.alloc(4);
          header.writeUInt32BE(slice.length, 0);
          socket.write(header);
          socket.write(slice);
        }
        const terminator = Buffer.alloc(4);
        terminator.writeUInt32BE(0, 0);
        socket.write(terminator);
      });
    });
  }
}
