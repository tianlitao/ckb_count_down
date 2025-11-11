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
// New state layout:
// u32(version) + u64(end_block) + u64(rate_blocks_per_ckb)
// + u64(min_add_shannons) + u128(xudt_per_block) + u128(min_pool_xudt)
// = 60 bytes
const STATE_LEN: usize = 60;

#[derive(Clone, Copy, Debug)]
struct State {
    version: u32,
    end_block: u64,
    rate_blocks_per_ckb: u64,
    min_add_shannons: u64,
    xudt_per_block: u128,
    min_pool_xudt: u128,
}

fn decode_state(data: &[u8]) -> Option<State> {
    if data.len() != STATE_LEN {
        return None;
    }
    let version = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    let end_block = u64::from_le_bytes(data[4..12].try_into().ok()?);
    let rate = u64::from_le_bytes(data[12..20].try_into().ok()?);
    let min = u64::from_le_bytes(data[20..28].try_into().ok()?);
    let xudt_per_block = u128::from_le_bytes(data[28..44].try_into().ok()?);
    let min_pool_xudt = u128::from_le_bytes(data[44..60].try_into().ok()?);
    Some(State {
        version,
        end_block,
        rate_blocks_per_ckb: rate,
        min_add_shannons: min,
        xudt_per_block,
        min_pool_xudt,
    })
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

fn xudt_amount_at(index: usize, source: Source) -> Result<u128, SysError> {
    let data = load_cell_data(index, source)?;
    if data.len() < 16 {
        return Err(SysError::Encoding);
    }
    let mut amt_bytes = [0u8; 16];
    amt_bytes.copy_from_slice(&data[0..16]);
    Ok(u128::from_le_bytes(amt_bytes))
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

        // type script 必须存在且与输入的类型脚本哈希一致（同一 XUDT 资产）
        let in_type_hash = load_cell_type_hash(in_idx, Source::Input)?;
        let out_type_hash = load_cell_type_hash(out_idx, Source::Output)?;
        match (in_type_hash, out_type_hash) {
            (Some(a), Some(b)) if a == b => {}
            _ => return Err(SysError::Encoding),
        }

        // 允许修改 data，但需要校验铸币量与延长的区块数按比例一致
        let game_out_capacity = load_cell_capacity(out_idx, Source::Output)?;
        let added = game_out_capacity
            .checked_sub(game_in_capacity)
            .ok_or(SysError::Encoding)?;
        if added < state_in.min_add_shannons {
            return Err(SysError::Encoding);
        }

        // 新状态校验（仅可变 end_block）和不变参数约束
        let out_lock = load_cell_lock(out_idx, Source::Output)?;
        let state_out = decode_state(out_lock.args().raw_data().as_ref()).ok_or(SysError::Encoding)?;
        if state_out.rate_blocks_per_ckb != state_in.rate_blocks_per_ckb {
            return Err(SysError::Encoding);
        }
        if state_out.min_add_shannons != state_in.min_add_shannons {
            return Err(SysError::Encoding);
        }
        if state_out.version != state_in.version {
            return Err(SysError::Encoding);
        }
        if state_out.xudt_per_block != state_in.xudt_per_block {
            return Err(SysError::Encoding);
        }
        if state_out.min_pool_xudt != state_in.min_pool_xudt {
            return Err(SysError::Encoding);
        }

        // end_block 更新公式
        let base = core::cmp::max(state_in.end_block, now_block);
        let added_blocks_ckb = added / SHANNONS_PER_CKB;
        let added_blocks = added_blocks_ckb
            .checked_mul(state_in.rate_blocks_per_ckb)
            .ok_or(SysError::Encoding)?;
        let expected_end = base.checked_add(added_blocks).ok_or(SysError::Encoding)?;
        if state_out.end_block != expected_end {
            return Err(SysError::Encoding);
        }

        // XUDT 分发校验（不增发）：
        // 注：净增发为 0 的约束由 XUDT 类型脚本负责，这里不重复校验。

        // 2) 游戏池内的 XUDT 必须按比例减少：
        //    distribute = 新增区块数 * xudt_per_block
        //    pool_y_out == pool_y_in - distribute
        let pool_y_in = xudt_amount_at(in_idx, Source::Input)?;
        let distribute = state_in
            .xudt_per_block
            .checked_mul(u128::from(added_blocks))
            .ok_or(SysError::Encoding)?;
        let expected_pool_y_out = pool_y_in
            .checked_sub(distribute)
            .ok_or(SysError::Encoding)?;

        // 流动性池最低 XUDT 数量（输出游戏池）
        let pool_y_out = xudt_amount_at(out_idx, Source::Output)?;
        if pool_y_out != expected_pool_y_out {
            return Err(SysError::Encoding);
        }
        if pool_y_out < state_in.min_pool_xudt {
            return Err(SysError::Encoding);
        }

        Ok(())
    } else {
        // Swap 模式：到期后允许使用同一锁代码维持池子，实行常数乘积 k = x * y
        if out_code_indices.len() != 1 {
            return Err(SysError::IndexOutOfBound);
        }
        let out_idx = out_code_indices[0];

        // type script 必须存在且与输入一致（保证同一 XUDT 资产）
        let in_type_hash = load_cell_type_hash(in_idx, Source::Input)?;
        let out_type_hash = load_cell_type_hash(out_idx, Source::Output)?;
        match (in_type_hash, out_type_hash) {
            (Some(a), Some(b)) if a == b => {}
            _ => return Err(SysError::Encoding),
        }

        // 锁 args 在 swap 模式下保持不变（固定池参数一致性）
        let in_lock = load_cell_lock(in_idx, Source::Input)?;
        let out_lock = load_cell_lock(out_idx, Source::Output)?;
        if in_lock.args().raw_data().as_ref() != out_lock.args().raw_data().as_ref() {
            return Err(SysError::Encoding);
        }

        // 读取储备：x = capacity(shannons), y = xudt amount(前16字节)
        let x_in = game_in_capacity; // u64
        let y_in = xudt_amount_at(in_idx, Source::Input)?; // u128
        let x_out = load_cell_capacity(out_idx, Source::Output)?; // u64
        let y_out = xudt_amount_at(out_idx, Source::Output)?; // u128

        // 计算变化量（swap 只允许单边增加，另一边减少）
        let dx: i128 = (x_out as i128) - (x_in as i128);
        let dy: i128 = (y_out as i128) - (y_in as i128);
        if dx == 0 || dy == 0 {
            return Err(SysError::Encoding);
        }

        // 常数乘积校验：
        // - CKB -> XUDT：dx > 0, dy < 0，要求 y_out == floor((x_in * y_in) / x_out)
        // - XUDT -> CKB：dx < 0, dy > 0，要求 x_out == floor((x_in * y_in) / y_out)
        let xin_u128 = u128::from(x_in);
        if dx > 0 && dy < 0 {
            let xout_u128 = u128::from(x_out);
            let numer = xin_u128.checked_mul(y_in).ok_or(SysError::Encoding)?;
            let expected_y_out = numer
                .checked_div(xout_u128)
                .ok_or(SysError::Encoding)?;
            if y_out != expected_y_out {
                return Err(SysError::Encoding);
            }
        } else if dx < 0 && dy > 0 {
            let numer = xin_u128.checked_mul(y_in).ok_or(SysError::Encoding)?;
            if y_out == 0 {
                return Err(SysError::IndexOutOfBound);
            }
            let expected_x_out_u128 = numer
                .checked_div(y_out)
                .ok_or(SysError::Encoding)?;
            let expected_x_out_u64 = u64::try_from(expected_x_out_u128).map_err(|_| SysError::Encoding)?;
            if x_out != expected_x_out_u64 {
                return Err(SysError::Encoding);
            }
        } else {
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
