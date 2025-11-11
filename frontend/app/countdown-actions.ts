'use client';

import { ccc, KnownScript } from '@ckb-ccc/connector-react';
import offckb from '@/offckb.config';
import { scriptToHash } from '@nervosnetwork/ckb-sdk-utils';
import { tokenInfoToBytes } from '../src/utils';

export type CountdownState = {
  version: number;
  endBlock: bigint;
  rateBlocksPerCkb: number;
  minAddShannons: bigint;
  xudtPerBlock: bigint;
  minPoolXudt: bigint;
  // 保留旧字段用于前端兼容展示（新布局不再使用）
  lastPayerLockHash: string;
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
  const toU128LEHex = (n: bigint): string => {
    if (n < BigInt(0)) throw new Error('negative not supported for u128');
    const hex = n.toString(16).padStart(32, '0');
    return hex.match(/../g)!.reverse().join('');
  };
  const hex =
    toU32LEHex(state.version) +
    toU64LEHex(state.endBlock) +
    toU64LEHex(BigInt(state.rateBlocksPerCkb)) +
    toU64LEHex(state.minAddShannons) +
    toU128LEHex(state.xudtPerBlock) +
    toU128LEHex(state.minPoolXudt);
  return '0x' + hex;
}

export function decodeCountdownState(dataHex: string): CountdownState {
  const hex = dataHex.startsWith('0x') ? dataHex.slice(2) : dataHex;
  if (hex.length !== 120) {
    throw new Error('Invalid countdown state length');
  }
  const fromU128LE = (h: string, offset: number): bigint => {
    const slice = h.slice(offset * 2, offset * 2 + 32);
    const bytes = slice.match(/../g)!.reverse().join('');
    return BigInt('0x' + bytes);
  };
  const version = fromU32LE(hex, 0);
  const endBlock = fromU64LE(hex, 4);
  const rateBlocksPerCkb = Number(fromU64LE(hex, 12));
  const minAddShannons = fromU64LE(hex, 20);
  const xudtPerBlock = fromU128LE(hex, 28);
  const minPoolXudt = fromU128LE(hex, 44);
  // 新布局不包含 lastPayerLockHash，返回占位以保持前端兼容
  const lastPayerLockHash = '0x' + '0'.repeat(64);
  return { version, endBlock, rateBlocksPerCkb, minAddShannons, xudtPerBlock, minPoolXudt, lastPayerLockHash };
}

export function getCountdownTypeScript(): { codeHash: `0x${string}`; hashType: 'data' | 'type' | 'data1'; args: '0x' } {
  const s = offckb.myScripts['countdown'];
  if (!s) throw new Error('countdown script not found in offckb config');
  return { codeHash: s.codeHash, hashType: s.hashType, args: '0x' };
}

export function getCountdownLockScript(): { codeHash: `0x${string}`; hashType: 'data' | 'type' | 'data1'; args: '0x' } {
  const s = offckb.myScripts['countdown'];
  if (!s) throw new Error('countdown script not found in offckb config');
  return { codeHash: s.codeHash, hashType: s.hashType, args: '0x' };
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
  const lockScript = getCountdownLockScript();

  let fallback: ccc.Cell | undefined;
  let count = 0;
  // 通过锁脚本的 code_hash 和 hash_type 进行索引，忽略 args（prefix 模式）
  for await (const cell of client.findCells(
    {
      script: lockScript,
      scriptType: 'lock',
      scriptSearchMode: 'prefix',
      withData: true,
    },
    'desc',
    20,
  )) {
    // 记录最新的一个作为后备
    if (!fallback) fallback = cell;
    count++;
  }

  if (fallback) {
    console.info('findActiveCountdownCell: picked latest countdown lock cell', fallback.outPoint);
  }
  return fallback;
}

export async function createCountdownCell(
  signer: ccc.Signer,
  params: {
    capacityCkb: string | number; // output capacity in CKB
    rateBlocksPerCkb: number; // blocks per CKB
    minAddCkb: string | number; // min add in CKB
    xudtPerBlock: string | number | bigint; // minted per block (u128)
    minPoolXudt: string | number | bigint; // pool threshold (u128)
    // xUDT 发行参数（页面新增）
    xudtAmount?: string | number | bigint; // 发行总量（原子单位，u128）
    xudtDecimals?: number; // 展示精度（仅前端展示用，不上链）
    xudtSymbol?: string; // 代币符号（仅前端展示用，不上链）
    xudtName?: string; // 代币名称（仅前端展示用，不上链）
    version?: number;
  },
): Promise<string> {
  const client = signer.client;
  const [{ hash, number }, depsCountdown] = await Promise.all([
    getTipHeader(client),
    getCountdownCellDeps(client),
  ]);
  const lockScriptCountdown = getCountdownLockScript();

  // payer's wallet lock（用于签名与支付手续费）
  const addr = await signer.getRecommendedAddress();
  const payerScript = (await ccc.Address.fromString(addr, client)).script;
  const depsWallet = await getWalletLockCellDeps(client, payerScript);

  // 校验并规范输出容量，避免链上 OccupiedCapacity 检查失败
  const capacityShannons = BigInt(ccc.fixedPointFrom(params.capacityCkb));
  if (capacityShannons < MIN_COUNTDOWN_CELL_CAPACITY_SHANNONS) {
    throw new Error(`容量不足：至少需要 130 CKB（当前 ${ccc.fixedPointToString(capacityShannons)} CKB）`);
  }

  const minAddShannons = BigInt(ccc.fixedPointFrom(params.minAddCkb));
  if (capacityShannons < minAddShannons) {
    throw new Error(`容量必须不小于最小追加额度（当前容量 ${ccc.fixedPointToString(capacityShannons)} CKB，最小追加 ${ccc.fixedPointToString(minAddShannons)} CKB）`);
  }

  // 计算 countdown 状态
  const addedBlocks = (capacityShannons / SHANNONS_PER_CKB) * BigInt(params.rateBlocksPerCkb);
  const endBlock = BigInt(number) + addedBlocks;
  const xudtPerBlock = typeof params.xudtPerBlock === 'bigint' ? params.xudtPerBlock : BigInt(params.xudtPerBlock);
  const minPoolXudt = typeof params.minPoolXudt === 'bigint' ? params.minPoolXudt : BigInt(params.minPoolXudt);

  const state: CountdownState = {
    version: params.version ?? 1,
    endBlock,
    rateBlocksPerCkb: params.rateBlocksPerCkb,
    minAddShannons,
    xudtPerBlock,
    minPoolXudt,
    lastPayerLockHash: '0x' + '0'.repeat(64),
  };

  // 发行总量（原子单位，u128），默认 0
  const xudtAmount = typeof params.xudtAmount === 'bigint'
    ? params.xudtAmount
    : BigInt(params.xudtAmount ?? 0);

  // Step 1: 创建 SUS 锚点 Cell（钱包锁，输出数据为空）
  const anchorOutput = ccc.CellOutput.from({ capacity: 0, lock: payerScript });
  const anchorCapacity = ccc.fixedPointFrom(anchorOutput.occupiedSize);
  anchorOutput.capacity = anchorCapacity;

  const tx1 = ccc.Transaction.from({
    cellDeps: [...depsWallet],
    headerDeps: [hash],
    outputs: [anchorOutput],
    outputsData: ['0x'],
  });

  logRawTx('init:create:step1_anchor', tx1);
  await tx1.completeInputsByCapacity(signer);
  logRawTx('afterInputs:create:step1_anchor', tx1);
  await tx1.completeFeeBy(signer);
  logRawTx('final:create:step1_anchor', tx1);
  const txHash1 = await signer.sendTransaction(tx1);

  // 将锚点 cell 标记为不可用于自动选取，避免被后续 completeInputs 误选
  try {
    await client.cache.markUnusable({ txHash: txHash1, index: 0 });
  } catch (_e) {
    // ignore cache mark failure
  }

  // Step 2: 创建 SUS Owner Cell（SingleUseLock，args = anchor outPoint）
  const susArgs = ccc.hexFrom(ccc.OutPoint.from({ txHash: txHash1, index: 0 }).toBytes()) as `0x${string}`;
  const singleUseLock = await ccc.Script.fromKnownScript(client, KnownScript.SingleUseLock, susArgs);
  const ownerOutput = ccc.CellOutput.from({ capacity: 0, lock: singleUseLock });
  ownerOutput.capacity = ccc.fixedPointFrom(ownerOutput.occupiedSize);

  const tx2 = ccc.Transaction.from({
    cellDeps: [...depsWallet],
    headerDeps: [hash],
    outputs: [ownerOutput],
    outputsData: ['0x'],
  });

  // 添加 SUS 锁依赖
  await tx2.addCellDepsOfKnownScripts(signer.client, KnownScript.SingleUseLock);
  logRawTx('init:create:step2_owner', tx2);
  await tx2.completeInputsByCapacity(signer);
  logRawTx('afterInputs:create:step2_owner', tx2);
  await tx2.completeFeeBy(signer);
  logRawTx('final:create:step2_owner', tx2);
  const txHash2 = await signer.sendTransaction(tx2);

  // Step 3: 铸造 XUDT（owner = SUS 锁哈希），创建 countdown cell 作为代币持有者
  const ownerLockHash = singleUseLock.hash();
  const xudtArgs = (ownerLockHash as `0x${string}`) + '00000000';
  const xudtType = await ccc.Script.fromKnownScript(client, KnownScript.XUdt, xudtArgs);

  // 计算最终 countdown + XUDT 输出的最小占用容量（字节 -> Shannons）并进行强校验
  const previewOutput = ccc.CellOutput.from({
    capacity: 0,
    lock: { ...lockScriptCountdown, args: encodeCountdownState(state) },
    type: xudtType,
  });
  const requiredCapacity = ccc.fixedPointFrom(previewOutput.occupiedSize + 16); // +16 字节为 u128 数据长度
  if (capacityShannons < requiredCapacity) {
    throw new Error(
      `容量不足：该输出至少需要 ${ccc.fixedPointToString(requiredCapacity)} CKB（锁+type+数据），当前 ${ccc.fixedPointToString(capacityShannons)} CKB。请增大容量后重试。`,
    );
  }

  const inputOwner = ccc.CellInput.from({ previousOutput: { txHash: txHash2, index: 0 } });
  // 为满足 SingleUseLock 的解锁约束：第三步同时消耗锚点 cell
  const inputAnchor = ccc.CellInput.from({ previousOutput: { txHash: txHash1, index: 0 } });

  // 返还锚点容量到钱包锁（与第一步创建锚点时一致的最小占用）
  // 如果将 UDT 展示信息上链到该“返还”输出的数据区，需要为数据预留容量
  const displayDecimals = params.xudtDecimals ?? 8;
  const displaySymbol = params.xudtSymbol ?? 'XUDT';
  const displayName = params.xudtName ?? displaySymbol;
  const tokenInfoHex = tokenInfoToBytes(displayDecimals, displaySymbol, displayName);
  const tokenInfoBytesLen = (tokenInfoHex.length - 2) / 2; // hex 字节长度
  // xUDT Info 类型脚本（UniqueType），args 使用 Type ID 规则
  // 依据 demo：args = hexFrom(bytesFrom(hashTypeId(inputs[0], outputIndex)).slice(0, 20))
  const typeIdHash = ccc.hashTypeId(inputOwner, 1);
  const uniqueTypeArgs = ccc.hexFrom(ccc.bytesFrom(typeIdHash).slice(0, 20)) as `0x${string}`;
  const uniqueType = await ccc.Script.fromKnownScript(client, KnownScript.UniqueType, uniqueTypeArgs);
  // 预估 xUDT Info 输出的最小占用容量（锁+UniqueType+tokenInfo 数据）
  const infoPreview = ccc.CellOutput.from({ capacity: 0, lock: payerScript, type: uniqueType });
  const xudtInfoCapacity = ccc.fixedPointFrom(infoPreview.occupiedSize + tokenInfoBytesLen);
  // 锚点返还输出恢复为仅锁与空数据的最小占用容量
  const anchorRefundCapacity = ccc.fixedPointFrom(
    ccc.CellOutput.from({ capacity: 0, lock: payerScript }).occupiedSize,
  );

  const tx3 = ccc.Transaction.from({
    // 同时包含 countdown、钱包锁 与 SUS 的依赖
    cellDeps: [...depsCountdown, ...depsWallet],
    headerDeps: [hash],
    inputs: [inputOwner, inputAnchor],
    outputs: [
      // 目标：倒计时 + XUDT 输出
      {
        lock: { ...lockScriptCountdown, args: encodeCountdownState(state) },
        type: xudtType,
        capacity: capacityShannons,
      },
      // xUDT Info 输出：携带展示信息，类型为 UniqueType
      {
        lock: payerScript,
        type: uniqueType,
        capacity: xudtInfoCapacity,
      },
      // 返还：锚点容量回钱包锁
      {
        lock: payerScript,
        capacity: anchorRefundCapacity,
      },
    ],
    outputsData: [
      // XUDT 数据区：u128 原子单位（LE，16 字节）
      // 如需与 demo 完全一致，可替换为 ccc.numLeToBytes(xudtAmount, 16)
      ('0x' + ((): string => {
        const toU128LEHexLocal = (n: bigint): string => {
          if (n < BigInt(0)) throw new Error('negative not supported for u128');
          const hex = n.toString(16).padStart(32, '0');
          return hex.match(/../g)!.reverse().join('');
        };
        return toU128LEHexLocal(xudtAmount);
      })()) as `0x${string}`,
      // xUDT Info 输出数据：代币展示信息（decimals/symbol/name）
      tokenInfoHex,
      // 锚点返还输出数据为空
      '0x',
    ],
  });

  // 添加依赖：XUdt 与 SingleUseLock
  await tx3.addCellDepsOfKnownScripts(signer.client, KnownScript.XUdt, KnownScript.SingleUseLock, KnownScript.UniqueType);
  logRawTx('init:create:step3_mint', tx3);
  await tx3.completeInputsByCapacity(signer);
  logRawTx('afterInputs:create:step3_mint', tx3);
  await tx3.completeFeeBy(signer);
  logRawTx('final:create:step3_mint', tx3);
  const txHash3 = await signer.sendTransaction(tx3);

  return txHash3;
}

export async function listCountdownCells(client: ccc.Client, page: number, pageSize: number): Promise<{ items: { cell: ccc.Cell; state: CountdownState }[]; hasMore: boolean }> {
  const lockScript = getCountdownLockScript();
  const needCount = Math.max(1, page) * Math.max(1, pageSize) + 1; // 取到下一页判断 hasMore
  const cells: ccc.Cell[] = [];
  let fetched = 0;
  // 通过锁脚本的 code_hash 和 hash_type 进行索引，忽略 args（prefix 模式）
  for await (const cell of client.findCells(
    {
      script: lockScript,
      scriptType: 'lock',
      scriptSearchMode: 'prefix',
      withData: true,
    },
    'desc',
    needCount,
  )) {
    cells.push(cell);
    fetched++;
    if (fetched >= needCount) break;
  }
  const start = (Math.max(1, page) - 1) * Math.max(1, pageSize);
  const selected = cells.slice(start, start + pageSize);
  const items: { cell: ccc.Cell; state: CountdownState }[] = [];
  for (const c of selected) {
    try {
      const st = decodeCountdownState(c.cellOutput.lock.args);
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

  const [{ hash, number }, depsCountdown] = await Promise.all([
    getTipHeader(client),
    getCountdownCellDeps(client),
  ]);
  const cellDeps = [...depsCountdown];

  const stateIn = decodeCountdownState(cell.cellOutput.lock.args);
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
  // 计算需分发的 XUDT 数量：addedBlocks * xudt_per_block（不增发，直接从池分发）
  const toU128LEHex = (n: bigint): string => {
    if (n < BigInt(0)) throw new Error('negative not supported for u128');
    const hex = n.toString(16).padStart(32, '0');
    return hex.match(/../g)!.reverse().join('');
  };
  const fromU128LEHex = (hex: string): bigint => {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = clean.match(/../g)?.map((b) => b) ?? [];
    const be = bytes.slice().reverse().join('');
    return BigInt('0x' + be);
  };
  const distribute = BigInt(stateIn.xudtPerBlock) * BigInt(extBlocks);
  if (distribute <= BigInt(0)) {
    throw new Error('追加 CKB 太少，无法获得任何 XUDT');
  }
  const currentAmt = fromU128LEHex(cell.outputData as string);
  const remaining = currentAmt - distribute;
  if (remaining < BigInt(stateIn.minPoolXudt)) {
    throw new Error(`池内 XUDT 不足以分发，请等待倒计时结束，通过swap获取`);
  }

  // 预检池输出最小占用容量（锁+type+16字节数据）
  const outLockPreview = { ...cell.cellOutput.lock, args: encodeCountdownState({
    version: stateIn.version,
    endBlock: endOut,
    lastPayerLockHash: payerHash,
    rateBlocksPerCkb: stateIn.rateBlocksPerCkb,
    minAddShannons: stateIn.minAddShannons,
    xudtPerBlock: stateIn.xudtPerBlock,
    minPoolXudt: stateIn.minPoolXudt,
  }) };
  const previewPool = ccc.CellOutput.from({ capacity: 0, lock: outLockPreview, type: cell.cellOutput.type! });
  const requiredPoolCap = ccc.fixedPointFrom(previewPool.occupiedSize + 16);

  // Build transaction: countdown 输入 + 钱包补充，输出池和用户奖励
  const input = ccc.CellInput.from({ previousOutput: cell.outPoint });
  const inCapacityStr = ccc.fixedPointToString(cell.cellOutput.capacity);
  const outCapacityStr = (Number(inCapacityStr) + Number(addedCkb)).toString();
  const outCapacity = ccc.fixedPointFrom(outCapacityStr);
  if (outCapacity < requiredPoolCap) {
    throw new Error(`延长后容量不足，至少需要 ${ccc.fixedPointToString(requiredPoolCap)} CKB（锁+type+数据）`);
  }

  const outputs: ccc.CellOutputLike[] = [
    { lock: outLockPreview, type: cell.cellOutput.type, capacity: outCapacity },
  ];
  const outputsData: (`0x${string}`)[] = [ ('0x' + toU128LEHex(remaining)) as `0x${string}` ];
  {
    const previewReward = ccc.CellOutput.from({ capacity: 0, lock: lockScriptWallet, type: cell.cellOutput.type! });
    const rewardCap = ccc.fixedPointFrom(previewReward.occupiedSize + 16);
    outputs.push({ lock: lockScriptWallet, type: cell.cellOutput.type, capacity: rewardCap });
    outputsData.push(('0x' + toU128LEHex(distribute)) as `0x${string}`);
  }

  const tx = ccc.Transaction.from({
    cellDeps: [...cellDeps, ...depsWallet],
    headerDeps: [hash],
    inputs: [input],
    outputs,
    outputsData,
  });
  await tx.addCellDepsOfKnownScripts(client, KnownScript.XUdt);

  logRawTx('init:extend_single', tx);
  await tx.completeInputsByCapacity(signer);
  logRawTx('afterInputs:extend_single', tx);
  await tx.completeFeeBy(signer);
  logRawTx('final:extend_single', tx);
  return signer.sendTransaction(tx);
}

export async function extendSpecificCountdownCell(
  signer: ccc.Signer,
  cell: ccc.Cell,
  addedCkb: string | number,
): Promise<string> {
  const client = signer.client;
  const [{ hash, number }, depsCountdown] = await Promise.all([
    getTipHeader(client),
    getCountdownCellDeps(client),
  ]);
  const cellDeps = [...depsCountdown];

  const stateIn = decodeCountdownState(cell.cellOutput.lock.args);
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
  // 单笔延长（指定 cell）：从池分发 XUDT 到钱包（不增发），池保持至少 minPoolXudt
  const toU128LEHex = (n: bigint): string => {
    if (n < BigInt(0)) throw new Error('negative not supported for u128');
    const hex = n.toString(16).padStart(32, '0');
    return hex.match(/../g)!.reverse().join('');
  };
  const fromU128LEHex = (hex: string): bigint => {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = clean.match(/../g)?.map((b) => b) ?? [];
    const be = bytes.slice().reverse().join('');
    return BigInt('0x' + be);
  };
  const distribute = BigInt(stateIn.xudtPerBlock) * BigInt(extBlocks);
  if (distribute <= BigInt(0)) {
    throw new Error('追加 CKB 太少，无法获得任何 XUDT');
  }
  const currentAmt = fromU128LEHex(cell.outputData as string);
  const remaining = currentAmt - distribute;
  if (remaining < BigInt(stateIn.minPoolXudt)) {
    throw new Error(`池内 XUDT 不足以分发，请等待倒计时结束，通过swap获取`);
  }

  const outLockPreview = { ...cell.cellOutput.lock, args: encodeCountdownState({
    version: stateIn.version,
    endBlock: endOut,
    lastPayerLockHash: payerHash,
    rateBlocksPerCkb: stateIn.rateBlocksPerCkb,
    minAddShannons: stateIn.minAddShannons,
    xudtPerBlock: stateIn.xudtPerBlock,
    minPoolXudt: stateIn.minPoolXudt,
  }) };
  const previewPool = ccc.CellOutput.from({ capacity: 0, lock: outLockPreview, type: cell.cellOutput.type! });
  const requiredPoolCap = ccc.fixedPointFrom(previewPool.occupiedSize + 16);

  const input = ccc.CellInput.from({ previousOutput: cell.outPoint });
  const outCapacity = ccc.fixedPointFrom((Number(ccc.fixedPointToString(cell.cellOutput.capacity)) + Number(addedCkb)).toString());
  if (outCapacity < requiredPoolCap) {
    throw new Error(`延长后容量不足，至少需要 ${ccc.fixedPointToString(requiredPoolCap)} CKB（锁+type+数据）`);
  }

  const outputs: ccc.CellOutputLike[] = [
    { lock: outLockPreview, type: cell.cellOutput.type, capacity: outCapacity },
  ];
  const outputsData: (`0x${string}`)[] = [ ('0x' + toU128LEHex(remaining)) as `0x${string}` ];
  {
    const previewReward = ccc.CellOutput.from({ capacity: 0, lock: lockScriptWallet, type: cell.cellOutput.type! });
    const rewardCap = ccc.fixedPointFrom(previewReward.occupiedSize + 16);
    outputs.push({ lock: lockScriptWallet, type: cell.cellOutput.type, capacity: rewardCap });
    outputsData.push(('0x' + toU128LEHex(distribute)) as `0x${string}`);
  }

  const tx = ccc.Transaction.from({
    cellDeps: [...cellDeps, ...depsWallet],
    headerDeps: [hash],
    inputs: [input],
    outputs,
    outputsData,
  });
  await tx.addCellDepsOfKnownScripts(client, KnownScript.XUdt);
  logRawTx('init:extend_specific_distribute', tx);
  await tx.completeInputsByCapacity(signer);
  logRawTx('afterInputs:extend_specific_single', tx);
  await tx.completeFeeBy(signer);
  logRawTx('final:extend_specific_single', tx);
  return signer.sendTransaction(tx);
}

export async function closeSpecificCountdownCell(
  signer: ccc.Signer,
  cell: ccc.Cell,
): Promise<string> {
  const client = signer.client;
  const [{ hash, number }, depsCountdown] = await Promise.all([
    getTipHeader(client),
    getCountdownCellDeps(client),
  ]);

  const stateIn = decodeCountdownState(cell.cellOutput.lock.args);
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
  const cellDeps = [...depsCountdown, ...depsWallet];

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

  const [{ hash, number }, depsCountdown] = await Promise.all([
    getTipHeader(client),
    getCountdownCellDeps(client),
  ]);
  const cellDeps = [...depsCountdown];

  const stateIn = decodeCountdownState(cell.cellOutput.lock.args);
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

// 查找钱包下与指定 typeScript 匹配的 XUDT 资产 cells（带数据）
async function findWalletXudtCells(client: ccc.Client, walletLock: any, typeScript: any, limit: number = 50): Promise<ccc.Cell[]> {
  const cells: ccc.Cell[] = [];
  let fetched = 0;
  for await (const cell of client.findCells(
    {
      script: typeScript,
      scriptType: 'type',
      scriptSearchMode: 'exact',
      withData: true,
    },
    'desc',
    limit,
  )) {
    const lockEq = scriptEq((cell as any)?.cellOutput?.lock, walletLock);
    if (lockEq) {
      cells.push(cell);
    }
    fetched++; if (fetched >= limit) break;
  }
  return cells;
}

// 辅助：解析/编码 u128 LE（原子单位）
function toU128LEHexLocal(n: bigint): string {
  if (n < BigInt(0)) throw new Error('negative not supported for u128');
  const hex = n.toString(16).padStart(32, '0');
  return hex.match(/../g)!.reverse().join('');
}
function fromU128LEHexLocal(hex: string): bigint {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = clean.match(/../g)?.map((b) => b) ?? [];
  const be = bytes.slice().reverse().join('');
  return BigInt('0x' + be);
}

// Swap：用 CKB 兑换 XUDT（到期后，常数乘积 k = x * y）
export async function swapCkbForXudt(
  signer: ccc.Signer,
  cell: ccc.Cell,
  ckbIn: string | number,
): Promise<string> {
  const client = signer.client;
  const [{ hash, number }, depsCountdown] = await Promise.all([
    getTipHeader(client),
    getCountdownCellDeps(client),
  ]);
  const now = BigInt(number);
  const stateIn = decodeCountdownState(cell.cellOutput.lock.args);
  if (now < stateIn.endBlock) {
    throw new Error(`尚未到期，当前区块 ${number} < 结束区块 ${stateIn.endBlock}`);
  }

  const addr = await signer.getRecommendedAddress();
  const walletLock = (await ccc.Address.fromString(addr, client)).script;
  const depsWallet = await getWalletLockCellDeps(client, walletLock);

  // 储备读取
  const x_in_ckb_str = ccc.fixedPointToString(cell.cellOutput.capacity);
  const x_in = BigInt(ccc.fixedPointFrom(x_in_ckb_str)); // shannons
  const y_in = fromU128LEHexLocal(cell.outputData as string);

  const dx = BigInt(ccc.fixedPointFrom(ckbIn));
  if (dx <= BigInt(0)) throw new Error('输入 CKB 必须为正');
  const x_out = x_in + dx;
  // 常数乘积：y_out = floor((x_in * y_in) / x_out)
  const numer = x_in * y_in;
  const y_out = numer / x_out; // floor
  if (y_out >= y_in) throw new Error('无法得到任何 XUDT（可能输入过小）');
  const y_delta = y_in - y_out; // 给用户的 XUDT 数量
  if (y_delta <= BigInt(0)) throw new Error('无法得到任何 XUDT');

  // 预检池输出最小占用容量
  const outLockSame = { ...cell.cellOutput.lock, args: cell.cellOutput.lock.args };
  const previewPool = ccc.CellOutput.from({ capacity: 0, lock: outLockSame, type: cell.cellOutput.type! });
  const requiredPoolCap = ccc.fixedPointFrom(previewPool.occupiedSize + 16);
  const x_out_ckb_str = (Number(x_in_ckb_str) + Number(ckbIn)).toString();
  const outCapacity = ccc.fixedPointFrom(x_out_ckb_str);
  if (outCapacity < requiredPoolCap) {
    throw new Error(`池容量不足（锁+type+数据），至少需要 ${ccc.fixedPointToString(requiredPoolCap)} CKB`);
  }

  // 构建输出：池（x_out, y_out）+ 用户奖励 XUDT（y_delta）
  const outputs: ccc.CellOutputLike[] = [
    { lock: outLockSame, type: cell.cellOutput.type, capacity: outCapacity },
  ];
  const outputsData: (`0x${string}`)[] = [ ('0x' + toU128LEHexLocal(y_out)) as `0x${string}` ];
  {
    const previewReward = ccc.CellOutput.from({ capacity: 0, lock: walletLock, type: cell.cellOutput.type! });
    const rewardCap = ccc.fixedPointFrom(previewReward.occupiedSize + 16);
    outputs.push({ lock: walletLock, type: cell.cellOutput.type, capacity: rewardCap });
    outputsData.push(('0x' + toU128LEHexLocal(y_delta)) as `0x${string}`);
  }

  const inputPool = ccc.CellInput.from({ previousOutput: cell.outPoint });
  const tx = ccc.Transaction.from({
    cellDeps: [...depsCountdown, ...depsWallet],
    headerDeps: [hash],
    inputs: [inputPool],
    outputs,
    outputsData,
  });
  await tx.addCellDepsOfKnownScripts(client, KnownScript.XUdt);
  logRawTx('init:swap_ckb_for_xudt', tx);
  await tx.completeInputsByCapacity(signer); // 自动从钱包补充 CKB
  logRawTx('afterInputs:swap_ckb_for_xudt', tx);
  await tx.completeFeeBy(signer);
  logRawTx('final:swap_ckb_for_xudt', tx);
  return signer.sendTransaction(tx);
}

// Swap：用 XUDT 兑换 CKB（到期后，常数乘积 k = x * y）
export async function swapXudtForCkb(
  signer: ccc.Signer,
  cell: ccc.Cell,
  xudtIn: string | number | bigint,
): Promise<string> {
  const client = signer.client;
  const [{ hash, number }, depsCountdown] = await Promise.all([
    getTipHeader(client),
    getCountdownCellDeps(client),
  ]);
  const now = BigInt(number);
  const stateIn = decodeCountdownState(cell.cellOutput.lock.args);
  if (now < stateIn.endBlock) {
    throw new Error(`尚未到期，当前区块 ${number} < 结束区块 ${stateIn.endBlock}`);
  }

  const addr = await signer.getRecommendedAddress();
  const walletLock = (await ccc.Address.fromString(addr, client)).script;
  const depsWallet = await getWalletLockCellDeps(client, walletLock);

  // 储备读取
  const x_in_ckb_str = ccc.fixedPointToString(cell.cellOutput.capacity);
  const x_in = BigInt(ccc.fixedPointFrom(x_in_ckb_str)); // shannons
  const y_in = fromU128LEHexLocal(cell.outputData as string);

  const dy = typeof xudtIn === 'bigint' ? xudtIn : BigInt(xudtIn);
  if (dy <= BigInt(0)) throw new Error('输入 XUDT 必须为正');
  const y_out = y_in + dy;
  // 常数乘积：x_out = floor((x_in * y_in) / y_out)
  const numer = x_in * y_in;
  if (y_out === BigInt(0)) throw new Error('池内 XUDT 为空');
  const x_out = numer / y_out; // floor
  if (x_out >= x_in) throw new Error('无法得到任何 CKB（可能输入过小）');
  const x_delta = x_in - x_out; // 给用户的 CKB（shannons）
  if (x_delta <= BigInt(0)) throw new Error('无法得到任何 CKB');

  // 预检池输出最小占用容量
  const outLockSame = { ...cell.cellOutput.lock, args: cell.cellOutput.lock.args };
  const previewPool = ccc.CellOutput.from({ capacity: 0, lock: outLockSame, type: cell.cellOutput.type! });
  const requiredPoolCap = ccc.fixedPointFrom(previewPool.occupiedSize + 16);
  const x_out_ckb_str = ccc.fixedPointToString(x_out);
  const outCapacity = ccc.fixedPointFrom(x_out_ckb_str);
  if (outCapacity < requiredPoolCap) {
    throw new Error(`池容量不足（锁+type+数据），至少需要 ${ccc.fixedPointToString(requiredPoolCap)} CKB`);
  }

  // 聚合钱包的 XUDT 输入（同 typeScript）
  const xudtType = cell.cellOutput.type!;
  const xudtInputs = await findWalletXudtCells(client, walletLock, xudtType, 50);
  let need = dy;
  const inputs: ccc.CellInput[] = [ccc.CellInput.from({ previousOutput: cell.outPoint })];
  type XChange = { amount: bigint; cell: ccc.Cell };
  const xudtChanges: XChange[] = [];
  for (const c of xudtInputs) {
    const amt = fromU128LEHexLocal(c.outputData as string);
    if (amt <= BigInt(0)) continue;
    inputs.push(ccc.CellInput.from({ previousOutput: c.outPoint }));
    if (amt > need) {
      xudtChanges.push({ amount: amt - need, cell: c });
      need = BigInt(0);
      break;
    } else {
      // 全部消耗，无剩余
      need -= amt;
    }
    if (need <= BigInt(0)) break;
  }
  if (need > BigInt(0)) {
    throw new Error('钱包内同类型 XUDT 数量不足');
  }

  // 构建输出：池（x_out, y_out）+ 钱包 XUDT 找零 + 钱包 CKB 收益
  const outputs: ccc.CellOutputLike[] = [
    { lock: outLockSame, type: xudtType, capacity: outCapacity },
  ];
  const outputsData: (`0x${string}`)[] = [ ('0x' + toU128LEHexLocal(y_out)) as `0x${string}` ];
  for (const ch of xudtChanges) {
    const preview = ccc.CellOutput.from({ capacity: 0, lock: walletLock, type: xudtType });
    const cap = ccc.fixedPointFrom(preview.occupiedSize + 16);
    outputs.push({ lock: walletLock, type: xudtType, capacity: cap });
    outputsData.push(('0x' + toU128LEHexLocal(ch.amount)) as `0x${string}`);
  }
  {
    // 钱包 CKB 收益（纯 CKB 锁，无数据）
    // 注意：纯 CKB 输出的容量必须至少满足锁脚本的最小占用容量，否则会出现 InsufficientCellCapacity。
    // 这里将最小占用容量与收益 x_delta 相加，确保输出可验证通过。
    const preview = ccc.CellOutput.from({ capacity: 0, lock: walletLock });
    const minCap = ccc.fixedPointFrom(preview.occupiedSize); // 最小占用容量（shannons）
    const profitCap = ccc.fixedPointFrom(ccc.fixedPointToString(x_delta)); // 收益（shannons）
    const outCapShannons = BigInt(minCap) + BigInt(profitCap);
    const ckbOutCap = ccc.fixedPointFrom(ccc.fixedPointToString(outCapShannons));
    outputs.push({ lock: walletLock, capacity: ckbOutCap });
    outputsData.push('0x');
  }

  const tx = ccc.Transaction.from({
    cellDeps: [...depsCountdown, ...depsWallet],
    headerDeps: [hash],
    inputs,
    outputs,
    outputsData,
  });
  await tx.addCellDepsOfKnownScripts(client, KnownScript.XUdt);
  logRawTx('init:swap_xudt_for_ckb', tx);
  await tx.completeInputsByCapacity(signer); // 自动补充手续费等 CKB
  logRawTx('afterInputs:swap_xudt_for_ckb', tx);
  await tx.completeFeeBy(signer);
  logRawTx('final:swap_xudt_for_ckb', tx);
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
