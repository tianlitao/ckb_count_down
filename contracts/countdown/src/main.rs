#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

use alloc::vec::Vec;
use ckb_std::{
    ckb_constants::Source,
    ckb_types::{packed::Byte32, prelude::*},
    // replace old error type
    error::SysError,
    high_level::{
        load_cell_capacity, load_cell_data, load_cell_lock_hash, load_cell_type_hash, load_header,
        load_script, QueryIter,
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

fn indices_with_type_hash(source: Source, script_hash: &Byte32) -> Result<Vec<usize>, SysError> {
    let mut res = Vec::new();
    for (i, th_opt) in QueryIter::new(load_cell_type_hash, source).enumerate() {
        if let Some(th) = th_opt {
            if th.as_slice() == script_hash.as_slice() {
                res.push(i);
            }
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
        if lh.as_slice() == lock_hash {
            return Ok(true);
        }
    }
    Ok(false)
}

fn sum_outputs_capacity_with_lock(lock_hash: &[u8; 32]) -> Result<u64, SysError> {
    let mut sum: u64 = 0;
    for (i, lh) in QueryIter::new(load_cell_lock_hash, Source::Output).enumerate() {
        if lh.as_slice() == lock_hash {
            let cap = load_cell_capacity(i, Source::Output)?;
            sum = sum.checked_add(cap).ok_or(SysError::Encoding)?;
        }
    }
    Ok(sum)
}

fn validate() -> Result<(), SysError> {
    // 1) 当前脚本哈希
    let script_hash = current_script_hash()?;
    // 输入/输出中携带该 type 的索引
    let in_indices = indices_with_type_hash(Source::Input, &script_hash)?;
    let out_indices = indices_with_type_hash(Source::Output, &script_hash)?;

    // 通过 header_deps 获取当前区块高度
    let now_block = max_header_dep_number()?.ok_or(SysError::ItemMissing)?;

    // 创建路径：输入中没有该 type，输出中恰好一个该 type
    if in_indices.is_empty() {
        if out_indices.len() != 1 {
            return Err(SysError::IndexOutOfBound);
        }
        let out_idx = out_indices[0];

        let out_data = load_cell_data(out_idx, Source::Output)?;
        let state_out = decode_state(&out_data).ok_or(SysError::Encoding)?;
        let game_out_capacity = load_cell_capacity(out_idx, Source::Output)?;

        // 创建时的容量需不小于最小追加额度
        if game_out_capacity < state_out.min_add_shannons {
            return Err(SysError::Encoding);
        }

        // 付费者锁必须在输入中出现（创建无需排除自身）
        let payer_present = input_has_lock_hash(&state_out.last_payer_lock_hash, None)?;
        if !payer_present {
            return Err(SysError::ItemMissing);
        }

        // 创建的 end_block 由容量推导：now + floor(capacity/CKB) * rate
        let added_blocks_ckb = game_out_capacity / SHANNONS_PER_CKB;
        let added_blocks = added_blocks_ckb
            .checked_mul(state_out.rate_blocks_per_ckb)
            .ok_or(SysError::Encoding)?;
        let expected_end = now_block
            .checked_add(added_blocks)
            .ok_or(SysError::Encoding)?;
        if state_out.end_block != expected_end {
            return Err(SysError::Encoding);
        }

        return Ok(());
    }

    // 其余情况必须恰好一个输入游戏Cell
    if in_indices.len() != 1 {
        return Err(SysError::IndexOutOfBound);
    }
    let in_idx = in_indices[0];

    let in_data = load_cell_data(in_idx, Source::Input)?;
    let state_in = decode_state(&in_data).ok_or(SysError::Encoding)?;
    let game_in_capacity = load_cell_capacity(in_idx, Source::Input)?;

    // 延长/关闭路径判断
    if now_block < state_in.end_block {
        // 延长路径
        if out_indices.len() != 1 {
            return Err(SysError::IndexOutOfBound);
        }
        let out_idx = out_indices[0];

        let game_out_capacity = load_cell_capacity(out_idx, Source::Output)?;
        let added = game_out_capacity
            .checked_sub(game_in_capacity)
            .ok_or(SysError::Encoding)?;
        if added < state_in.min_add_shannons {
            return Err(SysError::Encoding);
        }

        // 新状态校验
        let out_data = load_cell_data(out_idx, Source::Output)?;
        let state_out = decode_state(&out_data).ok_or(SysError::Encoding)?;

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
        if !out_indices.is_empty() {
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