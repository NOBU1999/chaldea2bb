// SPDX-License-Identifier: MIT
// link.js — 分享链接解析：只认 ?data= 自带数据的那种；?id= 短链要访问对方的服务器，本工具不代理，也不绕过它。
// 解压用 DecompressionStream，Node 18+ 和浏览器/WebView2 都有，不依赖 node:zlib。

const B64 = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

export async function decodeDataParam(data) {
  const tries = [];
  for (let skip = 0; skip <= 2; skip++) {
    try {
      const text = await gunzip(B64(data.slice(skip)));
      const json = JSON.parse(text);
      if (json && typeof json === 'object') return json;
    } catch (e) { tries.push(String((e && e.message) || e)); }
  }
  throw new Error('data 参数解不开: ' + tries.join(' | '));
}

export async function fromUrl(url) {
  const u = new URL(url);
  const data = u.searchParams.get('data');
  const id = u.searchParams.get('id');
  if (data) return { kind: 'data', team: await decodeDataParam(data) };
  if (id) return { kind: 'id', id };
  throw new Error('链接里既没有 data 也没有 id');
}