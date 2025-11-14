'use client';

import { ccc, KnownScript } from '@ckb-ccc/connector-react';
import offckb from '@/offckb.config';
import { scriptToHash } from '@nervosnetwork/ckb-sdk-utils';
import { getJoyIDCellDep, getJoyIDLockScript } from '@joyid/ckb';

export type AuctionState = {
  endBlock: bigint;
  priceStepShannons: bigint;
  bidderLockHash: string;
  bidShannons: bigint;
};

const SHANNONS_PER_CKB = BigInt(100000000);
const MIN_AUCTION_CELL_CAPACITY_SHANNONS = BigInt(130) * SHANNONS_PER_CKB;

// 将交易对象序列化为可读 JSON（BigInt 转字符串）并打印
function logRawTx(stage: string, tx: any) {
  try {
    const json = JSON.stringify(
      tx,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    );
    // 使用分组便于在控制台折叠查看
    console.group(`RawTransaction:${stage}`);
    console.log(json);
    console.groupEnd();
  } catch (e) {
    console.warn(`RawTransaction:${stage} stringify failed`, e);
    console.log(tx);
  }
}

function toU64LEHex(n: bigint): string {
  const v = n & BigInt('0xffffffffffffffff');
  let h = v.toString(16);
  h = h.padStart(16, '0');
  const bytes = h.match(/../g)!.reverse().join('');
  return bytes;
}

function fromU64LE(hexNoPrefix: string, offset: number): bigint {
  const slice = hexNoPrefix.slice(offset * 2, offset * 2 + 16);
  const bytes = slice.match(/../g)!.reverse().join('');
  return BigInt('0x' + bytes);
}

export function encodeAuctionArgs(state: AuctionState): string {
  const bh = (state.bidderLockHash.startsWith('0x') ? state.bidderLockHash.slice(2) : state.bidderLockHash).padStart(64, '0');
  const hex = toU64LEHex(state.endBlock) + toU64LEHex(state.priceStepShannons) + bh + toU64LEHex(state.bidShannons);
  return '0x' + hex;
}

export function decodeAuctionArgs(argsHex: string): AuctionState {
  const hex = argsHex.startsWith('0x') ? argsHex.slice(2) : argsHex;
  if (hex.length < 112) {
    throw new Error('Invalid auction args length');
  }
  const endBlock = fromU64LE(hex, 0);
  const priceStepShannons = fromU64LE(hex, 8);
  const bidderLockHash = '0x' + hex.slice(16 * 2, 16 * 2 + 32 * 2);
  const bidShannons = fromU64LE(hex, 48);
  return { endBlock, priceStepShannons, bidderLockHash, bidShannons };
}

export function getAuctionLockNoArgs(): { codeHash: `0x${string}`; hashType: 'data' | 'type' | 'data1'; args: '0x' } {
  const s = offckb.myScripts['countdown'];
  if (!s) throw new Error('countdown script not found in offckb config');
  return { codeHash: s.codeHash, hashType: s.hashType, args: '0x' };
}

export function getCountdownTypeScript(): { codeHash: `0x${string}`; hashType: 'data' | 'type' | 'data1'; args: '0x' } {
  const s = offckb.myScripts['countdown'];
  if (!s) throw new Error('countdown script not found in offckb config');
  return { codeHash: s.codeHash, hashType: s.hashType, args: '0x' };
}

export function getAlwaysSuccessLock(): { codeHash: `0x${string}`; hashType: 'data' | 'type' | 'data1'; args: '0x' } {
  const sMy = offckb.myScripts['always_success'];
  const s = sMy ?? offckb.systemScripts.always_success?.script;
  if (!s) throw new Error('always_success script not found in offckb config');
  return { codeHash: s.codeHash, hashType: s.hashType, args: '0x' };
}

export async function getAuctionCellDeps(client: ccc.Client): Promise<ccc.CellDep[]> {
  const s = offckb.myScripts['countdown'];
  if (!s) throw new Error('countdown script not found in offckb config');
  return client.getCellDeps(s.cellDeps);
}

function scriptEq(a: any, b: any): boolean {
  return !!a && !!b && a.codeHash?.toLowerCase() === b.codeHash?.toLowerCase() && a.hashType === b.hashType;
}

export async function getWalletLockCellDeps(client: ccc.Client, walletLock: any): Promise<ccc.CellDep[]> {
  const scriptsMap = (client as any)?.scripts ?? {};
  const prefer = [
    scriptsMap[KnownScript.Secp256k1Blake160],
    scriptsMap[KnownScript.Secp256k1Multisig],
    scriptsMap[KnownScript.AnyoneCanPay],
    scriptsMap[KnownScript.JoyId],
  ];
  const fallback = Object.values(scriptsMap);
  for (const s of [...prefer, ...fallback]) {
    if (!s) continue;
    if (scriptEq(walletLock, s)) {
      return client.getCellDeps(s.cellDeps);
    }
  }
  return [];
}

function mergeCellDepsUnique(...lists: ccc.CellDep[][]): ccc.CellDep[] {
  const m = new Map<string, ccc.CellDep>();
  for (const list of lists) {
    for (const d of list) {
      const op = (d as any)?.outPoint;
      const k = `${op?.txHash ?? ''}:${op?.index ?? ''}:${(d as any)?.depType ?? ''}`;
      if (!m.has(k)) m.set(k, d);
    }
  }
  return Array.from(m.values());
}

export async function getTipHeader(client: ccc.Client): Promise<{ hash: string; number: bigint }> {
  const header = await client.getTipHeader();
  return { hash: header.hash, number: BigInt(header.number) };
}

export async function findActiveAuctionCell(client: ccc.Client): Promise<ccc.Cell | undefined> {
  const type = getCountdownTypeScript();
  let fallback: ccc.Cell | undefined;
  try {
    for await (const cell of client.findCellsByType(type, true, 'desc', 20)) {
      if (!fallback) fallback = cell;
      return cell;
    }
  } catch (_e) {
    // fallback to lock scan in case older cells have no type
    const lock = getAuctionLockNoArgs();
    for await (const cell of client.findCells({ script: lock, scriptType: 'lock', scriptSearchMode: 'prefix', withData: true }, 'desc', 20)) {
      if (!fallback) fallback = cell;
      return cell;
    }
  }
  return fallback;
}

export async function createAuctionCell(
  signer: ccc.Signer,
  params: { capacityCkb: string | number; endBlock: string | number; priceStepCkb: string | number },
): Promise<string> {
  const client = signer.client;
  const [{ hash, number }, cellDeps] = await Promise.all([getTipHeader(client), getAuctionCellDeps(client)]);
  const addr = await signer.getRecommendedAddress();
  const bidderScript = (await ccc.Address.fromString(addr, client)).script;
  const bidderLockHash = scriptToHash(bidderScript);
  const depsWallet = await getWalletLockCellDeps(client, bidderScript);
  const capacityShannons = BigInt(ccc.fixedPointFrom(params.capacityCkb));
  if (capacityShannons < MIN_AUCTION_CELL_CAPACITY_SHANNONS) {
    throw new Error(`容量不足：至少需要 130 CKB（当前 ${ccc.fixedPointToString(capacityShannons)} CKB）`);
  }
  const endBlock = BigInt(params.endBlock);
  if (BigInt(number) >= endBlock) {
    throw new Error('结束区块必须大于当前区块高度');
  }
  const priceStepShannons = BigInt(ccc.fixedPointFrom(params.priceStepCkb));
  if (priceStepShannons <= BigInt(0)) {
    throw new Error('加价步长必须为正数');
  }
  const state: AuctionState = {
    endBlock,
    priceStepShannons,
    bidderLockHash,
    bidShannons: capacityShannons,
  };
  const lockScript = { ...getAuctionLockNoArgs(), args: encodeAuctionArgs(state) };
  const tx = ccc.Transaction.from({
    cellDeps: mergeCellDepsUnique(cellDeps, depsWallet),
    headerDeps: [hash],
    outputs: [
      {
        lock: lockScript,
        capacity: capacityShannons,
      },
    ],
    outputsData: ['0x'],
  });
  logRawTx('init:create', tx);
  await tx.completeInputsByCapacity(signer);
  logRawTx('afterInputs:create', tx);
  await tx.completeFeeBy(signer);
  logRawTx('final:create', tx);
  return signer.sendTransaction(tx);
}

export async function listAuctionCells(client: ccc.Client, page: number, pageSize: number): Promise<{ items: { cell: ccc.Cell; state: AuctionState }[]; hasMore: boolean }> {
  const type = getCountdownTypeScript();
  const needCount = Math.max(1, page) * Math.max(1, pageSize) + 1;
  const cells: ccc.Cell[] = [];
  let fetched = 0;
  {
    const lock = getAuctionLockNoArgs();
    for await (const cell of client.findCells({ script: lock, scriptType: 'lock', scriptSearchMode: 'prefix', withData: true }, 'desc', needCount)) {
      cells.push(cell);
      fetched++;
      if (fetched >= needCount) break;
    }
  }
  const start = (Math.max(1, page) - 1) * Math.max(1, pageSize);
  const selected = cells.slice(start, start + pageSize);
  const items: { cell: ccc.Cell; state: AuctionState }[] = [];
  for (const c of selected) {
    try {
      const st = decodeAuctionArgs((c as any).cellOutput.lock.args);
      items.push({ cell: c, state: st });
    } catch (_e) {}
  }
  const hasMore = cells.length > start + pageSize;
  return { items, hasMore };
}

export async function bidAuctionCell(signer: ccc.Signer, addedCkb: string | number): Promise<string> {
  const client = signer.client;
  const cell = await findActiveAuctionCell(client);
  if (!cell) throw new Error('未找到 auction cell');
  const [{ hash }, depsAuction] = await Promise.all([getTipHeader(client), getAuctionCellDeps(client)]);
  const stateIn = decodeAuctionArgs((cell as any).cellOutput.lock.args);
  const addedShannons = BigInt(ccc.fixedPointFrom(addedCkb));
  const minNext = stateIn.bidShannons + stateIn.priceStepShannons;
  if (addedShannons < minNext) {
    throw new Error(`出价不足，至少需要 ${ccc.fixedPointToString(minNext)} CKB`);
  }
  const addr = await signer.getRecommendedAddress();
  const newBidderLock = (await ccc.Address.fromString(addr, client)).script;
  const newBidderHash = scriptToHash(newBidderLock);
  const depsNewBidder = await getWalletLockCellDeps(client, newBidderLock);
  const prevAddr = await resolveLastPayerAddress(client, cell, stateIn.bidderLockHash);
  if (!prevAddr) throw new Error('无法解析上一个出价者锁地址');
  const prevLock = (await ccc.Address.fromString(prevAddr, client)).script;
  const depsPrevBidder = await getWalletLockCellDeps(client, prevLock);
  const input = ccc.CellInput.from({ previousOutput: cell.outPoint });
  const inCapacityStr = ccc.fixedPointToString(cell.cellOutput.capacity);
  const outCapacityStr = String(addedCkb);
  const stateOut: AuctionState = {
    endBlock: stateIn.endBlock,
    priceStepShannons: stateIn.priceStepShannons,
    bidderLockHash: newBidderHash,
    bidShannons: BigInt(ccc.fixedPointFrom(outCapacityStr)),
  };
  const newLock = { ...getAuctionLockNoArgs(), args: encodeAuctionArgs(stateOut) };
  const tx = ccc.Transaction.from({
    cellDeps: mergeCellDepsUnique(depsAuction, depsNewBidder, depsPrevBidder),
    headerDeps: [hash],
    inputs: [input],
    outputs: [
      { lock: newLock, capacity: ccc.fixedPointFrom(outCapacityStr) },
      { lock: prevLock, capacity: ccc.fixedPointFrom(inCapacityStr) },
    ],
    outputsData: ['0x', '0x'],
  });
  logRawTx('init:bid', tx);
  await tx.completeInputsByCapacity(signer);
  logRawTx('afterInputs:bid', tx);
  await tx.completeFeeBy(signer);
  logRawTx('final:bid', tx);
  return signer.sendTransaction(tx);
}

export async function bidSpecificAuctionCell(signer: ccc.Signer, cell: ccc.Cell, addedCkb: string | number): Promise<string> {
  const client = signer.client;
  const [{ hash }, depsAuction] = await Promise.all([getTipHeader(client), getAuctionCellDeps(client)]);
  const stateIn = decodeAuctionArgs((cell as any).cellOutput.lock.args);
  const addedShannons = BigInt(ccc.fixedPointFrom(addedCkb));
  const minNext = stateIn.bidShannons + stateIn.priceStepShannons;
  if (addedShannons < minNext) {
    throw new Error(`出价不足，至少需要 ${ccc.fixedPointToString(minNext)} CKB`);
  }
  const addr = await signer.getRecommendedAddress();
  const newBidderLock = (await ccc.Address.fromString(addr, client)).script;
  const newBidderHash = scriptToHash(newBidderLock);
  const depsNewBidder = await getWalletLockCellDeps(client, newBidderLock);
  const prevAddr = await resolveLastPayerAddress(client, cell, stateIn.bidderLockHash);
  if (!prevAddr) throw new Error('无法解析上一个出价者锁地址');
  const prevLock = (await ccc.Address.fromString(prevAddr, client)).script;
  const depsPrevBidder = await getWalletLockCellDeps(client, prevLock);
  const input = ccc.CellInput.from({ previousOutput: cell.outPoint });
  const inCapacityStr = ccc.fixedPointToString(cell.cellOutput.capacity);
  const outCapacityStr = String(addedCkb);
  const stateOut: AuctionState = {
    endBlock: stateIn.endBlock,
    priceStepShannons: stateIn.priceStepShannons,
    bidderLockHash: newBidderHash,
    bidShannons: BigInt(ccc.fixedPointFrom(outCapacityStr)),
  };
  const newLock = { ...getAuctionLockNoArgs(), args: encodeAuctionArgs(stateOut) };
  const tx = ccc.Transaction.from({
    cellDeps: mergeCellDepsUnique(depsAuction, depsNewBidder, depsPrevBidder),
    headerDeps: [hash],
    inputs: [input],
    outputs: [
      { lock: newLock, capacity: ccc.fixedPointFrom(outCapacityStr) },
      { lock: prevLock, capacity: ccc.fixedPointFrom(inCapacityStr) },
    ],
    outputsData: ['0x', '0x'],
  });
  logRawTx('init:extend_specific', tx);
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer);
  logRawTx('afterInputs:extend_specific', tx);
  await tx.completeFeeBy(signer);
  logRawTx('final:extend_specific', tx);
  return signer.sendTransaction(tx);
}

export async function claimSpecificAuctionCell(signer: ccc.Signer, cell: ccc.Cell): Promise<string> {
  const client = signer.client;
  const [{ hash, number }, depsAuction] = await Promise.all([getTipHeader(client), getAuctionCellDeps(client)]);
  const stateIn = decodeAuctionArgs((cell as any).cellOutput.lock.args);
  const now = BigInt(number);
  if (now < stateIn.endBlock) {
    throw new Error(`尚未到期，当前区块 ${number} < 结束区块 ${stateIn.endBlock}`);
  }
  const addr = await signer.getRecommendedAddress();
  const walletLock = (await ccc.Address.fromString(addr, client)).script;
  const myHash = scriptToHash(walletLock);
  if (myHash.toLowerCase() !== stateIn.bidderLockHash.toLowerCase()) {
    throw new Error('当前账户不是最后出价者，无法关闭并领取奖励');
  }
  const depsWallet = await getWalletLockCellDeps(client, walletLock);
  const cellDeps = [...depsAuction, ...depsWallet];
  const input = ccc.CellInput.from({ previousOutput: cell.outPoint });
  const inCapacityStr = ccc.fixedPointToString(cell.cellOutput.capacity);
  const tx = ccc.Transaction.from({
    cellDeps: mergeCellDepsUnique(cellDeps),
    headerDeps: [hash],
    inputs: [input],
    outputs: [{ lock: walletLock, capacity: ccc.fixedPointFrom(inCapacityStr) }],
    outputsData: ['0x'],
  });
  logRawTx('init:close_specific', tx);
  await tx.completeInputsByCapacity(signer);
  logRawTx('afterInputs:close_specific', tx);
  await tx.completeFeeBy(signer);
  logRawTx('final:close_specific', tx);
  return signer.sendTransaction(tx);
}

export async function claimAuctionCell(signer: ccc.Signer): Promise<string> {
  const client = signer.client;
  const cell = await findActiveAuctionCell(client);
  if (!cell) throw new Error('未找到 auction cell');
  const [{ hash, number }, depsAuction] = await Promise.all([getTipHeader(client), getAuctionCellDeps(client)]);
  const stateIn = decodeAuctionArgs((cell as any).cellOutput.lock.args);
  const now = BigInt(number);
  if (now < stateIn.endBlock) {
    throw new Error(`尚未到期，当前区块 ${number} < 结束区块 ${stateIn.endBlock}`);
  }
  const addr = await signer.getRecommendedAddress();
  const walletLock = (await ccc.Address.fromString(addr, client)).script;
  const myHash = scriptToHash(walletLock);
  const depsWallet = await getWalletLockCellDeps(client, walletLock);
  if (myHash.toLowerCase() !== stateIn.bidderLockHash.toLowerCase()) {
    throw new Error('当前账户不是最后出价者，无法关闭并领取奖励');
  }
  const input = ccc.CellInput.from({ previousOutput: cell.outPoint });
  const inCapacityStr = ccc.fixedPointToString(cell.cellOutput.capacity);
  const tx = ccc.Transaction.from({
    cellDeps: mergeCellDepsUnique(depsAuction, depsWallet),
    headerDeps: [hash],
    inputs: [input],
    outputs: [{ lock: walletLock, capacity: ccc.fixedPointFrom(inCapacityStr) }],
    outputsData: ['0x'],
  });
  logRawTx('init:close', tx);
  await tx.completeInputsByCapacity(signer);
  logRawTx('afterInputs:close', tx);
  await tx.completeFeeBy(signer);
  logRawTx('final:close', tx);
  return signer.sendTransaction(tx);
}

export async function resolveLastPayerAddress(
  client: ccc.Client,
  cell: ccc.Cell,
  lastPayerLockHash: string,
): Promise<string | null> {
  try {
    const res = await client.getTransaction(cell.outPoint.txHash);
    const tx = res?.transaction;
    if (!tx) return null;
    for (const input of (tx.inputs ?? [])) {
      try {
        const prevOut = (input as any)?.previousOutput;
        if (!prevOut) continue;
        const inCell = await client.getCell(prevOut);
        const lock = (inCell as any)?.cellOutput?.lock;
        if (!lock) continue;
        const hash = scriptToHash(lock);
        if (hash.toLowerCase() === lastPayerLockHash.toLowerCase()) {
          return ccc.Address.fromScript(lock, client).toString();
        }
      } catch (_e) {
        // ignore single input failure
      }
    }
    return null;
  } catch (_e) {
    return null;
  }
}
