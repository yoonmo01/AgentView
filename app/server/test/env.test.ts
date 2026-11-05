import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { dockerfile, envTag, PKG, prepareEnv, envState } from '../src/sandbox.ts';
import type { Agent } from '../src/store.ts';

const agent = (packages?: Agent['sandbox']['packages'], image = 'agentview/sandbox:base'): Agent => ({
  id: 'env-test', name: 'E', role: '', connection: 'x', model: 'x', systemPrompt: '', tools: [], maxSteps: 1,
  avatar: { model: 'default.glb', color: '#888888' }, sandbox: { image, network: false, packages },
});

describe('sandbox packages', () => {
  it('accepts package names with versions and refuses anything a shell would read', () => {
    for (const ok of ['pandas', 'pandas==2.2.3', 'requests[socks]>=2', 'scikit-learn']) expect(PKG.pip.test(ok)).toBe(true);
    for (const ok of ['typescript', '@types/node', 'lodash@4.17.21']) expect(PKG.npm.test(ok)).toBe(true);
    for (const ok of ['ffmpeg', 'libpq-dev', 'curl=7.88.1-10']) expect(PKG.apt.test(ok)).toBe(true);
    for (const bad of ['pandas; rm -rf /', '$(id)', 'a b', '-r x', '`x`', 'a&&b']) {
      expect(PKG.pip.test(bad) || PKG.npm.test(bad) || PKG.apt.test(bad)).toBe(false);
    }
  });

  it('names the image by its setup, so equal setups share one, and writes the Dockerfile', () => {
    expect(envTag(agent())).toBeNull();
    expect(envTag(agent({ pip: [], npm: [], apt: [] }))).toBeNull();
    const a = envTag(agent({ pip: ['b', 'a'], npm: [], apt: [] }));
    expect(a).toBe(envTag(agent({ pip: ['a', 'b'], npm: [], apt: [] })));
    expect(a).not.toBe(envTag(agent({ pip: ['a', 'b'], npm: [], apt: [] }, 'python:3.12-slim')));
    expect(dockerfile(agent({ pip: ['pandas'], npm: [], apt: ['ffmpeg'] }))).toBe(
      'FROM agentview/sandbox:base\nRUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*\nRUN pip install --no-cache-dir pandas\n');
    expect(() => dockerfile(agent({ pip: ['x; rm -rf /'], npm: [], apt: [] }))).toThrow('invalid package name');
  });

  const hasImage = spawnSync('docker', ['image', 'inspect', 'agentview/sandbox:base'], { stdio: 'ignore' }).status === 0;
  it.skipIf(!hasImage)('reports a failed build with its log (a package that does not exist)', async () => {
    const a = agent({ pip: ['agentview-no-such-package-xyz'], npm: [], apt: [] });
    await prepareEnv(a);
    const s = await envState(a);
    expect(s.status).toBe('failed');
    expect(s.log).toMatch(/No matching distribution|ERROR/);
  }, 300_000);
});
