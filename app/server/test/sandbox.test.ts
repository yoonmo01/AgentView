import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listFiles, readFile, safePath, writeFile } from '../src/sandbox.ts';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'av-ws-'));

describe('workspace files', () => {
  it('writes, reads and lists files using /work or relative paths', async () => {
    const root = path.join(tmp(), 'nova');
    await writeFile(root, '/work/src/hello.py', 'print("hi")');
    expect(await readFile(root, 'src/hello.py')).toBe('print("hi")');
    expect(await listFiles(root)).toEqual(['src/hello.py']);
  });

  it('rejects traversal and absolute paths outside the workspace', async () => {
    const root = path.join(tmp(), 'nova');
    await expect(safePath(root, '../secret.txt')).rejects.toThrow('outside workspace');
    await expect(safePath(root, path.resolve(tmp(), 'x.txt'))).rejects.toThrow('outside workspace');
  });

  it('rejects escapes through a directory link', async () => {
    const base = tmp();
    const root = path.join(base, 'nova');
    const outside = path.join(base, 'outside');
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'secret.txt'), 's');
    symlinkSync(outside, path.join(root, 'link'), 'junction'); // junction needs no admin rights on Windows
    await expect(readFile(root, 'link/secret.txt')).rejects.toThrow('outside workspace');
    await expect(writeFile(root, 'link/new.txt', 'x')).rejects.toThrow('outside workspace');
  });

  it('skips node_modules and .git when listing', async () => {
    const root = path.join(tmp(), 'nova');
    await writeFile(root, 'a.txt', '1');
    await writeFile(root, 'node_modules/x/i.js', '2');
    await writeFile(root, '.git/HEAD', '3');
    expect(await listFiles(root)).toEqual(['a.txt']);
  });

  it('refuses non-string content', async () => {
    await expect(writeFile(path.join(tmp(), 'nova'), 'a.txt', 42)).rejects.toThrow('content must be a string');
  });
});
