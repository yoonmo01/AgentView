/**
 * A fake GitHub for tests: repos as { "owner/repo": { "path/in/repo": "content" } } on branch main.
 * Answers the repo, tree and raw-file requests the code makes.
 */
export function fakeGithub(repos: Record<string, Record<string, string>>): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    let m = /^https:\/\/api\.github\.com\/repos\/([\w.-]+\/[\w.-]+)$/.exec(url);
    if (m) return repos[m[1]] ? Response.json({ default_branch: 'main' }) : new Response('no', { status: 404 });
    m = /^https:\/\/api\.github\.com\/repos\/([\w.-]+\/[\w.-]+)\/git\/trees\/main\?recursive=1$/.exec(url);
    if (m) {
      const files = repos[m[1]];
      return files ? Response.json({ tree: Object.entries(files).map(([path, c]) => ({ path, type: 'blob', size: c.length })) }) : new Response('no', { status: 404 });
    }
    m = /^https:\/\/raw\.githubusercontent\.com\/([\w.-]+\/[\w.-]+)\/main\/(.+)$/.exec(url);
    if (m) {
      const p = m[2].split('/').map(decodeURIComponent).join('/');
      const c = repos[m[1]]?.[p];
      return c === undefined ? new Response('missing', { status: 404 }) : new Response(c);
    }
    return new Response('unexpected request', { status: 500 });
  }) as typeof fetch;
}
