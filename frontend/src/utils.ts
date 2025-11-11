'use client';

import offCKBConfig from '@/offckb.config';

// 将 UDT 展示信息编码为链上数据：
// [1 byte decimals] [2 bytes symLen] [sym bytes UTF-8] [2 bytes nameLen] [name bytes UTF-8]
export function tokenInfoToBytes(decimals: number, symbol: string, name: string): `0x${string}` {
  const d = (decimals ?? 0) & 0xff;
  const te = new TextEncoder();
  const symBytes = te.encode(symbol ?? '');
  const nameBytes = te.encode(name ?? '');
  const toHex = (arr: Uint8Array) => Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
  const lenToHex2 = (n: number) => {
    const v = Math.max(0, Math.min(0xffff, n | 0));
    // 使用大端两字节表示长度
    const hi = ((v >> 8) & 0xff).toString(16).padStart(2, '0');
    const lo = (v & 0xff).toString(16).padStart(2, '0');
    return hi + lo;
  };
  const head = d.toString(16).padStart(2, '0');
  const body = head + lenToHex2(symBytes.length) + toHex(symBytes) + lenToHex2(nameBytes.length) + toHex(nameBytes);
  return ('0x' + body) as `0x${string}`;
}

// 简易 Explorer 链接（可供页面跳转），根据当前网络提供默认地址
export function useGetExplorerLink(): (txHash: string) => string {
  const net = offCKBConfig.currentNetwork;
  const base = net === 'mainnet'
    ? 'https://explorer.nervos.org/'
    : 'https://pudge.explorer.nervos.org/'; // devnet/testnet 默认 pudge
  return (txHash: string) => {
    const clean = txHash.startsWith('0x') ? txHash : ('0x' + txHash);
    return `${base}transaction/${clean}`;
  };
}
