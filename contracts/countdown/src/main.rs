#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]
extern crate alloc as alloc_crate;

use alloc_crate::vec::Vec;
use ckb_std::{
    ckb_constants::Source,
    ckb_types::{packed::Byte32, prelude::*},
    // replace old error type
    error::SysError,
    high_level::{
        load_cell_capacity, load_cell_lock, load_cell_lock_hash, load_cell_type_hash,
        load_cell_data, load_header, load_script, QueryIter,
    },
};

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

const SHANNONS_PER_CKB: u64 = 100_000_000;
const STATE_LEN: usize = 60; // u32 + u64 + [u8;32] + u64 + u64

#[derive(Clone, Copy, Debug)]
struct State {
    version: u32,
    end_block: u64,
    last_payer_lock_hash: [u8; 32],
    rate_blocks_per_ckb: u64,
    min_add_shannons: u64,
}

fn decode_state(data: &[u8]) -> Option<State> {
    if data.len() != STATE_LEN {
        return None;
    }
    let version = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    let end_block = u64::from_le_bytes(data[4..12].try_into().ok()?);
    let mut last = [0u8; 32];
    last.copy_from_slice(&data[12..44]);
    let rate = u64::from_le_bytes(data[44..52].try_into().ok()?);
    let min = u64::from_le_bytes(data[52..60].try_into().ok()?);
    Some(State {
        version,
        end_block,
        last_payer_lock_hash: last,
        rate_blocks_per_ckb: rate,
        min_add_shannons: min,
    })
}

fn current_script_hash() -> Result<Byte32, SysError> {
    let script = load_script()?;
    Ok(script.calc_script_hash())
}

// 查找与当前锁脚本完全一致（含相同 args）的输入/输出索引
fn indices_with_lock_hash(source: Source, script_hash: &Byte32) -> Result<Vec<usize>, SysError> {
    let mut res = Vec::new();
    for (i, lh) in QueryIter::new(load_cell_lock_hash, source).enumerate() {
        let sh: [u8; 32] = script_hash.unpack();
        if lh == sh {
            res.push(i);
        }
    }
    Ok(res)
}

// 查找使用同一锁代码（code_hash 相同，args 可不同）的输入/输出索引
fn indices_with_lock_code(source: Source, code_hash: &Byte32) -> Result<Vec<usize>, SysError> {
    let mut res = Vec::new();
    for (i, _lh) in QueryIter::new(load_cell_lock_hash, source).enumerate() {
        let lock = load_cell_lock(i, source)?;
        let lch: [u8; 32] = lock.code_hash().unpack();
        let ch: [u8; 32] = code_hash.unpack();
        if lch == ch {
            res.push(i);
        }
    }
    Ok(res)
}

fn max_header_dep_number() -> Result<Option<u64>, SysError> {
    let mut maxn: Option<u64> = None;
    for hdr in QueryIter::new(load_header, Source::HeaderDep) {
        let n: u64 = hdr.raw().number().unpack();
        match maxn {
            Some(m) if n <= m => {}
            _ => maxn = Some(n),
        }
    }
    Ok(maxn)
}

fn input_has_lock_hash(lock_hash: &[u8; 32], exclude_idx: Option<usize>) -> Result<bool, SysError> {
    for (i, lh) in QueryIter::new(load_cell_lock_hash, Source::Input).enumerate() {
        if let Some(ex) = exclude_idx {
            if i == ex {
                continue;
            }
        }
        if lh == *lock_hash {
            return Ok(true);
        }
    }
    Ok(false)
}

fn sum_outputs_capacity_with_lock(lock_hash: &[u8; 32]) -> Result<u64, SysError> {
    let mut sum: u64 = 0;
    for (i, lh) in QueryIter::new(load_cell_lock_hash, Source::Output).enumerate() {
        if lh == *lock_hash {
            let cap = load_cell_capacity(i, Source::Output)?;
            sum = sum.checked_add(cap).ok_or(SysError::Encoding)?;
        }
    }
    Ok(sum)
}

fn validate() -> Result<(), SysError> {
    // 1) 当前锁脚本（用于取哈希与 code_hash）
    let script = load_script()?;
    let script_hash = script.calc_script_hash();
    let code_hash = script.code_hash();

    // 当前锁脚本所在输入组（相同锁哈希）
    let in_indices = indices_with_lock_hash(Source::Input, &script_hash)?;
    // 输出中使用同一锁代码的索引（args 可不同，用于延长/关闭判断）
    let out_code_indices = indices_with_lock_code(Source::Output, &code_hash)?;

    // 通过 header_deps 获取当前区块高度
    let now_block = max_header_dep_number()?.ok_or(SysError::ItemMissing)?;

    // 注：作为锁脚本，创建路径不会执行脚本（没有该锁的输入），因此不在此验证。

    // 其余情况必须恰好一个输入游戏Cell
    if in_indices.len() != 1 {
        return Err(SysError::IndexOutOfBound);
    }
    let in_idx = in_indices[0];
    let in_lock = load_cell_lock(in_idx, Source::Input)?;
    let state_in = decode_state(in_lock.args().raw_data().as_ref()).ok_or(SysError::Encoding)?;
    let game_in_capacity = load_cell_capacity(in_idx, Source::Input)?;

    // 延长/关闭路径判断
    if now_block < state_in.end_block {
        // 延长路径
        if out_code_indices.len() != 1 {
            return Err(SysError::IndexOutOfBound);
        }
        let out_idx = out_code_indices[0];

        // type script 与 cell data 不允许修改
        let in_type = load_cell_type_hash(in_idx, Source::Input)?;
        let out_type = load_cell_type_hash(out_idx, Source::Output)?;
        match (in_type, out_type) {
            (None, None) => {}
            (Some(a), Some(b)) if a == b => {}
            _ => return Err(SysError::Encoding),
        }
        let in_data = load_cell_data(in_idx, Source::Input)?;
        let out_data = load_cell_data(out_idx, Source::Output)?;
        if in_data != out_data {
            return Err(SysError::Encoding);
        }

        let game_out_capacity = load_cell_capacity(out_idx, Source::Output)?;
        let added = game_out_capacity
            .checked_sub(game_in_capacity)
            .ok_or(SysError::Encoding)?;
        if added < state_in.min_add_shannons {
            return Err(SysError::Encoding);
        }

        // 新状态校验
        let out_lock = load_cell_lock(out_idx, Source::Output)?;
        let state_out = decode_state(out_lock.args().raw_data().as_ref()).ok_or(SysError::Encoding)?;

        // 付费者锁必须在输入中出现（排除游戏Cell自身）
        let payer_present = input_has_lock_hash(&state_out.last_payer_lock_hash, Some(in_idx))?;
        if !payer_present {
            return Err(SysError::ItemMissing);
        }

        // 不可变参数
        if state_out.rate_blocks_per_ckb != state_in.rate_blocks_per_ckb {
            return Err(SysError::Encoding);
        }
        if state_out.min_add_shannons != state_in.min_add_shannons {
            return Err(SysError::Encoding);
        }
        if state_out.version != state_in.version {
            return Err(SysError::Encoding);
        }

        // end_block更新公式
        let base = core::cmp::max(state_in.end_block, now_block);
        let added_blocks_ckb = added / SHANNONS_PER_CKB;
        let added_blocks = added_blocks_ckb
            .checked_mul(state_in.rate_blocks_per_ckb)
            .ok_or(SysError::Encoding)?;
        let expected_end = base.checked_add(added_blocks).ok_or(SysError::Encoding)?;
        if state_out.end_block != expected_end {
            return Err(SysError::Encoding);
        }

        Ok(())
    } else {
        // 关闭路径：到期后不允许延长，必须发奖给最后付费者
        if !out_code_indices.is_empty() {
            return Err(SysError::IndexOutOfBound);
        }

        // 仅最终中奖者可领取：赢家锁在输入中出现（需签名）
        let winner_present = input_has_lock_hash(&state_in.last_payer_lock_hash, None)?;
        if !winner_present {
            return Err(SysError::ItemMissing);
        }

        // 奖池至少等于游戏Cell的输入容量总额
        let payout_sum = sum_outputs_capacity_with_lock(&state_in.last_payer_lock_hash)?;
        if payout_sum < game_in_capacity {
            return Err(SysError::Encoding);
        }

        Ok(())
    }
}

pub fn program_entry() -> i8 {
    match validate() {
        Ok(()) => 0,
        Err(_err) => 1,
    }
}