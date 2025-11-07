'use client';

import { ccc, KnownScript } from '@ckb-ccc/connector-react';
import offckb from '@/offckb.config';
import { scriptToHash } from '@nervosnetwork/ckb-sdk-utils';
import { getJoyIDCellDep, getJoyIDLockScript } from '@joyid/ckb';

export type CountdownState = {
  version: number;
  endBlock: bigint;
  lastPayerLockHash: string; // 0x-prefixed 32-byte hex
  rateBlocksPerCkb: number;
  minAddShannons: bigint;
};

const SHANNONS_PER_CKB = BigInt(100000000);
const MIN_COUNTDOWN_CELL_CAPACITY_SHANNONS = BigInt(130) * SHANNONS_PER_CKB;

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

function toU32LEHex(n: number): string {
  const v = BigInt(n >>> 0);
  let h = v.toString(16);
  h = h.padStart(8, '0');
  // little-endian 4 bytes
  const bytes = h.match(/../g)!.reverse().join('');
  return bytes;
}

function toU64LEHex(n: bigint): string {
  const v = n & BigInt('0xffffffffffffffff');
  let h = v.toString(16);
  h = h.padStart(16, '0');
  const bytes = h.match(/../g)!.reverse().join('');
  return bytes;
}

function fromU32LE(hexNoPrefix: string, offset: number): number {
  const slice = hexNoPrefix.slice(offset * 2, offset * 2 + 8);
  const bytes = slice.match(/../g)!.reverse().join('');
  return Number.parseInt(bytes, 16);
}

function fromU64LE(hexNoPrefix: string, offset: number): bigint {
  const slice = hexNoPrefix.slice(offset * 2, offset * 2 + 16);
  const bytes = slice.match(/../g)!.reverse().join('');
  return BigInt('0x' + bytes);
}

export function encodeCountdownState(state: CountdownState): string {
  const lp = (state.lastPayerLockHash.startsWith('0x')
    ? state.lastPayerLockHash.slice(2)
    : state.lastPayerLockHash).padStart(64, '0');
  const hex =
    toU32LEHex(state.version) +
    toU64LEHex(state.endBlock) +
    lp +
    toU64LEHex(BigInt(state.rateBlocksPerCkb)) +
    toU64LEHex(state.minAddShannons);
  return '0x' + hex;
}

export function decodeCountdownState(dataHex: string): CountdownState {
  const hex = dataHex.startsWith('0x') ? dataHex.slice(2) : dataHex;
  if (hex.length < 120) {
    throw new Error('Invalid countdown state length');
  }
  const version = fromU32LE(hex, 0);
  const endBlock = fromU64LE(hex, 4);
  const lastPayerLockHash = '0x' + hex.slice(12 * 2, 12 * 2 + 32 * 2);
  const rateBlocksPerCkb = Number(fromU64LE(hex, 44));
  const minAddShannons = fromU64LE(hex, 52);
  return { version, endBlock, lastPayerLockHash, rateBlocksPerCkb, minAddShannons };
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

export async function getAlwaysSuccessCellDeps(client: ccc.Client): Promise<ccc.CellDep[]> {
  const sMy = offckb.myScripts['always_success'];
  const s = sMy ?? offckb.systemScripts.always_success?.script;
  if (!s) throw new Error('always_success script not found in offckb config');
  return client.getCellDeps(s.cellDeps);
}

export async function getCountdownCellDeps(client: ccc.Client): Promise<ccc.CellDep[]> {
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
    offckb.systemScripts.omnilock?.script,
    offckb.systemScripts.secp256k1_blake160_sighash_all?.script,
    offckb.systemScripts.secp256k1_blake160_multisig_all?.script,
    offckb.systemScripts.anyone_can_pay?.script,
  ];
  const fallback = [
    scriptsMap[KnownScript.OmniLock],
    scriptsMap[KnownScript.Secp256k1Blake160],
    scriptsMap[KnownScript.Secp256k1Multisig],
    scriptsMap[KnownScript.AnyoneCanPay],
    scriptsMap[KnownScript.JoyId]
  ];
  for (const s of [...prefer, ...fallback]) {
    if (!s) continue;
    if (scriptEq(walletLock, s)) {
      return client.getCellDeps(s.cellDeps);
    }
  }
  return [];
}

export async function getTipHeader(client: ccc.Client): Promise<{ hash: string; number: bigint }> {
  const header = await client.getTipHeader();
  return { hash: header.hash, number: BigInt(header.number) };
}

export async function findActiveCountdownCell(client: ccc.Client): Promise<ccc.Cell | undefined> {
  const type = getCountdownTypeScript();
  const preferLock = getAlwaysSuccessLock();

  let fallback: ccc.Cell | undefined;
  let count = 0;
  for await (const cell of client.findCellsByType(type, true, 'desc', 20)) {
    // 记录最新的一个作为后备
    if (!fallback) fallback = cell;

    const lock = (cell as any)?.cellOutput?.lock;
    if (lock && lock.codeHash?.toLowerCase() === preferLock.codeHash.toLowerCase() && lock.hashType === preferLock.hashType) {
      console.info('findActiveCountdownCell: picked preferred always_success lock cell', cell.outPoint);
      return cell;
    }
    count++;
  }

  if (fallback) {
    console.info('findActiveCountdownCell: fallback to the latest countdown cell', fallback.outPoint);
  }
  return fallback;
}

export async function createCountdownCell(
  signer: ccc.Signer,
  params: {
    capacityCkb: string | number; // output capacity in CKB
    rateBlocksPerCkb: number; // blocks per CKB
    minAddCkb: string | number; // min add in CKB
    version?: number;
  },
): Promise<string> {
  const client = signer.client;
  const [{ hash, number }, cellDeps] = await Promise.all([
    getTipHeader(client),
    getCountdownCellDeps(client),
  ]);

  // payer's wallet lock (用于记录 last_payer_lock_hash)
  const addr = await signer.getRecommendedAddress();
  const payerScript = (await ccc.Address.fromString(addr, client)).script;
  const lastPayerLockHash = scriptToHash(payerScript);
  const depsWallet = await getWalletLockCellDeps(client, payerScript);
  const type = getCountdownTypeScript();
  const lockScript = getAlwaysSuccessLock();

  // 校验并规范输出容量，避免链上 OccupiedCapacity 检查失败
  const capacityShannons = BigInt(ccc.fixedPointFrom(params.capacityCkb));
  if (capacityShannons < MIN_COUNTDOWN_CELL_CAPACITY_SHANNONS) {
    throw new Error(`容量不足：至少需要 130 CKB（当前 ${ccc.fixedPointToString(capacityShannons)} CKB）`);
  }

  const minAddShannons = BigInt(ccc.fixedPointFrom(params.minAddCkb));
  if (capacityShannons < minAddShannons) {
    throw new Error(`容量必须不小于最小追加额度（当前容量 ${ccc.fixedPointToString(capacityShannons)} CKB，最小追加 ${ccc.fixedPointToString(minAddShannons)} CKB）`);
  }

  // end_block 按合约创建路径规则：now + floor(capacity/CKB) * rate
  const addedBlocks = (capacityShannons / SHANNONS_PER_CKB) * BigInt(params.rateBlocksPerCkb);
  const endBlock = BigInt(number) + addedBlocks;

  const state: CountdownState = {
    version: params.version ?? 1,
    endBlock,
    lastPayerLockHash,
    rateBlocksPerCkb: params.rateBlocksPerCkb,
    minAddShannons,
  };

  const tx = ccc.Transaction.from({
    cellDeps: [...cellDeps, ...depsWallet],
    headerDeps: [hash],
    outputs: [
      {
        lock: lockScript,
        type,
        capacity: capacityShannons,
      },
    ],
    outputsData: [encodeCountdownState(state)],
  });

  // 打印原始交易 JSON（初始阶段）
  logRawTx('init:create', tx);

  await tx.completeInputsByCapacity(signer);
  // Debug: 计算 inputs 的 lock_hash 列表，对比 lastPayerLockHash
  try {
    const inputLockHashes = tx.inputs
      .map((i: any) => i?.cellOutput?.lock)
      .filter(Boolean)
      .map((lk: any) => scriptToHash(lk));
    console.info('CountdownCreate Inputs LockHashes', { inputLockHashes, lastPayerLockHash });
  } catch (e) {
    console.warn('CountdownCreate: input lock hashes calc failed', e);
  }

  // 打印原始交易 JSON（补全 inputs 后）
  logRawTx('afterInputs:create', tx);

  await tx.completeFeeBy(signer);
  // 打印原始交易 JSON（补全手续费后，最终发送）
  logRawTx('final:create', tx);
  return signer.sendTransaction(tx);
}

export async function listCountdownCells(client: ccc.Client, page: number, pageSize: number): Promise<{ items: { cell: ccc.Cell; state: CountdownState }[]; hasMore: boolean }> {
  const type = getCountdownTypeScript();
  const needCount = Math.max(1, page) * Math.max(1, pageSize) + 1; // 取到下一页判断 hasMore
  const cells: ccc.Cell[] = [];
  let fetched = 0;
  for await (const cell of client.findCellsByType(type, true, 'desc', needCount)) {
    cells.push(cell);
    fetched++;
    if (fetched >= needCount) break;
  }
  const start = (Math.max(1, page) - 1) * Math.max(1, pageSize);
  const selected = cells.slice(start, start + pageSize);
  const items: { cell: ccc.Cell; state: CountdownState }[] = [];
  for (const c of selected) {
    try {
      const st = decodeCountdownState(c.outputData);
      items.push({ cell: c, state: st });
    } catch (_e) {
      // 跳过无法解析的 cell
    }
  }
  const hasMore = cells.length > start + pageSize;
  return { items, hasMore };
}

export async function extendCountdownCell(
  signer: ccc.Signer,
  addedCkb: string | number,
): Promise<string> {
  const client = signer.client;
  const cell = await findActiveCountdownCell(client);
  if (!cell) throw new Error('未找到 countdown cell');

  const [{ hash, number }, depsCountdown, depsAlways] = await Promise.all([
    getTipHeader(client),
    getCountdownCellDeps(client),
    getAlwaysSuccessCellDeps(client),
  ]);
  const cellDeps = [...depsCountdown, ...depsAlways];

  const stateIn = decodeCountdownState(cell.outputData);
  const addedShannons = BigInt(ccc.fixedPointFrom(addedCkb));
  if (addedShannons < stateIn.minAddShannons) {
    throw new Error(`追加金额不足，至少需要 ${ccc.fixedPointToString(stateIn.minAddShannons)} CKB`);
  }

  const addr = await signer.getRecommendedAddress();
  const lockScriptWallet = (await ccc.Address.fromString(addr, client)).script;
  const payerHash = scriptToHash(lockScriptWallet);
  const depsWallet = await getWalletLockCellDeps(client, lockScriptWallet);

  const base = (BigInt(number) > stateIn.endBlock ? BigInt(number) : stateIn.endBlock);
  const extBlocks = (addedShannons / SHANNONS_PER_CKB) * BigInt(stateIn.rateBlocksPerCkb);
  const endOut = base + extBlocks;

  const type = getCountdownTypeScript();

  // Build transaction: consume the countdown cell, recreate it with increased capacity and updated state (always_success 锁)
  const input = ccc.CellInput.from({ previousOutput: cell.outPoint });

  const inCapacityStr = ccc.fixedPointToString(cell.cellOutput.capacity);
  const outCapacityStr = (Number(inCapacityStr) + Number(addedCkb)).toString();

  const stateOut: CountdownState = {
    version: stateIn.version,
    endBlock: endOut,
    lastPayerLockHash: payerHash,
    rateBlocksPerCkb: stateIn.rateBlocksPerCkb,
    minAddShannons: stateIn.minAddShannons,
  };

  const tx = ccc.Transaction.from({
    cellDeps: [...cellDeps, ...depsWallet],
    headerDeps: [hash],
    inputs: [input],
    outputs: [
      {
        lock: cell.cellOutput.lock, // 保持为 always_success 锁
        type,
        capacity: ccc.fixedPointFrom(outCapacityStr),
      },
    ],
    outputsData: [encodeCountdownState(stateOut)],
  });

  // 打印原始交易 JSON（初始阶段）
  logRawTx('init:extend', tx);

  await tx.completeInputsByCapacity(signer);
  // 打印原始交易 JSON（补全 inputs 后）
  logRawTx('afterInputs:extend', tx);

  await tx.completeFeeBy(signer);
  // 打印原始交易 JSON（补全手续费后，最终发送）
  logRawTx('final:extend', tx);
  return signer.sendTransaction(tx);
}

export async function extendSpecificCountdownCell(
  signer: ccc.Signer,
  cell: ccc.Cell,
  addedCkb: string | number,
): Promise<string> {
  const client = signer.client;
  const [{ hash, number }, depsCountdown, depsAlways] = await Promise.all([
    getTipHeader(client),
    getCountdownCellDeps(client),
    getAlwaysSuccessCellDeps(client),
  ]);
  const cellDeps = [...depsCountdown, ...depsAlways];

  const stateIn = decodeCountdownState(cell.outputData);
  const addedShannons = BigInt(ccc.fixedPointFrom(addedCkb));
  if (addedShannons < stateIn.minAddShannons) {
    throw new Error(`追加金额不足，至少需要 ${ccc.fixedPointToString(stateIn.minAddShannons)} CKB`);
  }

  const addr = await signer.getRecommendedAddress();
  const lockScriptWallet = (await ccc.Address.fromString(addr, client)).script;
  const payerHash = scriptToHash(lockScriptWallet);
  const depsWallet = await getWalletLockCellDeps(client, lockScriptWallet);

  const base = (BigInt(number) > stateIn.endBlock ? BigInt(number) : stateIn.endBlock);
  const extBlocks = (addedShannons / SHANNONS_PER_CKB) * BigInt(stateIn.rateBlocksPerCkb);
  const endOut = base + extBlocks;

  const type = getCountdownTypeScript();

  const input = ccc.CellInput.from({ previousOutput: cell.outPoint });
  const inCapacityStr = ccc.fixedPointToString(cell.cellOutput.capacity);
  const outCapacityStr = (Number(inCapacityStr) + Number(addedCkb)).toString();

  const stateOut: CountdownState = {
    version: stateIn.version,
    endBlock: endOut,
    lastPayerLockHash: payerHash,
    rateBlocksPerCkb: stateIn.rateBlocksPerCkb,
    minAddShannons: stateIn.minAddShannons,
  };

  const tx = ccc.Transaction.from({
    cellDeps: [...cellDeps, ...depsWallet],
    headerDeps: [hash],
    inputs: [input],
    outputs: [
      {
        lock: cell.cellOutput.lock, // 保持为 always_success 锁
        type,
        capacity: ccc.fixedPointFrom(outCapacityStr),
      },
    ],
    outputsData: [encodeCountdownState(stateOut)],
  });

  logRawTx('init:extend_specific', tx);
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer);
  logRawTx('afterInputs:extend_specific', tx);
  await tx.completeFeeBy(signer);
  logRawTx('final:extend_specific', tx);
  return signer.sendTransaction(tx);
}

export async function closeSpecificCountdownCell(
  signer: ccc.Signer,
  cell: ccc.Cell,
): Promise<string> {
  const client = signer.client;
  const [{ hash, number }, depsCountdown, depsAlways] = await Promise.all([
    getTipHeader(client),
    getCountdownCellDeps(client),
    getAlwaysSuccessCellDeps(client),
  ]);

  const stateIn = decodeCountdownState(cell.outputData);
  const now = BigInt(number);
  if (now < stateIn.endBlock) {
    throw new Error(`尚未到期，当前区块 ${number} < 结束区块 ${stateIn.endBlock}`);
  }

  const addr = await signer.getRecommendedAddress();
  const walletLock = (await ccc.Address.fromString(addr, client)).script;
  const myHash = scriptToHash(walletLock);
  if (myHash.toLowerCase() !== stateIn.lastPayerLockHash.toLowerCase()) {
    throw new Error('当前账户不是最后出价者，无法关闭并领取奖励');
  }
  const depsWallet = await getWalletLockCellDeps(client, walletLock);
  const cellDeps = [...depsCountdown, ...depsAlways, ...depsWallet];

  const input = ccc.CellInput.from({ previousOutput: cell.outPoint });
  const inCapacityStr = ccc.fixedPointToString(cell.cellOutput.capacity);

  const tx = ccc.Transaction.from({
    cellDeps,
    headerDeps: [hash],
    inputs: [input],
    outputs: [
      {
        lock: walletLock,
        capacity: ccc.fixedPointFrom(inCapacityStr),
      },
    ],
    outputsData: ['0x'],
  });

  logRawTx('init:close_specific', tx);
  await tx.completeInputsByCapacity(signer);
  logRawTx('afterInputs:close_specific', tx);
  await tx.completeFeeBy(signer);
  logRawTx('final:close_specific', tx);
  return signer.sendTransaction(tx);
}

export async function closeCountdownCell(signer: ccc.Signer): Promise<string> {
  const client = signer.client;
  const cell = await findActiveCountdownCell(client);
  if (!cell) throw new Error('未找到 countdown cell');

  const [{ hash, number }, depsCountdown, depsAlways] = await Promise.all([
    getTipHeader(client),
    getCountdownCellDeps(client),
    getAlwaysSuccessCellDeps(client),
  ]);
  const cellDeps = [...depsCountdown, ...depsAlways];

  const stateIn = decodeCountdownState(cell.outputData);
  const now = BigInt(number);
  if (now < stateIn.endBlock) {
    throw new Error(`尚未到期，当前区块 ${number} < 结束区块 ${stateIn.endBlock}`);
  }

  const addr = await signer.getRecommendedAddress();
  const walletLock = (await ccc.Address.fromString(addr, client)).script;
  const myHash = scriptToHash(walletLock);
  const depsWallet = await getWalletLockCellDeps(client, walletLock);
  if (myHash.toLowerCase() !== stateIn.lastPayerLockHash.toLowerCase()) {
    throw new Error('当前账户不是最后出价者，无法关闭并领取奖励');
  }

  const input = ccc.CellInput.from({ previousOutput: cell.outPoint });
  const inCapacityStr = ccc.fixedPointToString(cell.cellOutput.capacity);

  const tx = ccc.Transaction.from({
    cellDeps: [...cellDeps, ...depsWallet],
    headerDeps: [hash],
    inputs: [input],
    outputs: [
      {
        lock: walletLock,
        capacity: ccc.fixedPointFrom(inCapacityStr),
      },
    ],
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
