#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

use alloc::vec::Vec;
use ckb_std::{
    ckb_constants::Source,
    ckb_types::{packed::Byte32, prelude::*},
    error::SysError,
    high_level::{
        load_cell_capacity, load_cell_data, load_cell_lock, load_cell_lock_hash, load_cell_type_hash, load_header,
        load_script, QueryIter,
    },
};

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

const ARGS_LEN: usize = 56;

#[derive(Clone, Copy, Debug)]
struct AuctionArgs {
    end_block: u64,
    price_step_shannons: u64,
    bidder_lock_hash: [u8; 32],
    bid_shannons: u64,
}

fn decode_args(buf: &[u8]) -> Option<AuctionArgs> {
    if buf.len() != ARGS_LEN {
        return None;
    }
    let end_block = u64::from_le_bytes(buf[0..8].try_into().ok()?);
    let price_step_shannons = u64::from_le_bytes(buf[8..16].try_into().ok()?);
    let mut bidder_lock_hash = [0u8; 32];
    bidder_lock_hash.copy_from_slice(&buf[16..48]);
    let bid_shannons = u64::from_le_bytes(buf[48..56].try_into().ok()?);
    Some(AuctionArgs { end_block, price_step_shannons, bidder_lock_hash, bid_shannons })
}


fn indices_with_lock_code_hash(source: Source, code_hash: &Byte32) -> Result<Vec<usize>, SysError> {
    let mut res = Vec::new();
    for (i, _lh) in QueryIter::new(load_cell_lock_hash, source).enumerate() {
        let s = load_cell_lock(i, source)?;
        if s.code_hash().as_slice() == code_hash.as_slice() {
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
    let script = load_script()?;
    let script_hash = script.calc_script_hash();
    let code_hash = script.code_hash();

    let in_indices = {
        let mut v = Vec::new();
        for (i, lh) in QueryIter::new(load_cell_lock_hash, Source::Input).enumerate() {
            if lh.as_slice() == script_hash.as_slice() {
                v.push(i);
            }
        }
        v
    };
    let out_indices_by_code = indices_with_lock_code_hash(Source::Output, &code_hash)?;

    let now_block = max_header_dep_number()?.ok_or(SysError::ItemMissing)?;

    if in_indices.is_empty() {
        if out_indices_by_code.len() != 1 {
            return Err(SysError::IndexOutOfBound);
        }
        let out_idx = out_indices_by_code[0];
        let out_lock = load_cell_lock(out_idx, Source::Output)?;
        let out_args_buf = out_lock.args().raw_data().to_vec();
        let state_out = decode_args(&out_args_buf).ok_or(SysError::Encoding)?;
        let cap_out = load_cell_capacity(out_idx, Source::Output)?;

        if cap_out != state_out.bid_shannons {
            return Err(SysError::Encoding);
        }

        let bidder_present = input_has_lock_hash(&state_out.bidder_lock_hash, None)?;
        if !bidder_present {
            return Err(SysError::ItemMissing);
        }

        if now_block >= state_out.end_block {
            return Err(SysError::Encoding);
        }

        if state_out.price_step_shannons == 0 {
            return Err(SysError::Encoding);
        }

        return Ok(());
    }

    if in_indices.len() != 1 {
        return Err(SysError::IndexOutOfBound);
    }
    let in_idx = in_indices[0];
    let in_lock = load_cell_lock(in_idx, Source::Input)?;
    let in_args_buf = in_lock.args().raw_data().to_vec();
    let state_in = decode_args(&in_args_buf).ok_or(SysError::Encoding)?;
    let cap_in = load_cell_capacity(in_idx, Source::Input)?;

    if cap_in != state_in.bid_shannons {
        return Err(SysError::Encoding);
    }

    if now_block < state_in.end_block {
        if out_indices_by_code.len() != 1 {
            return Err(SysError::IndexOutOfBound);
        }
        let out_idx = out_indices_by_code[0];
        let out_lock = load_cell_lock(out_idx, Source::Output)?;
        let out_args_buf = out_lock.args().raw_data().to_vec();
        let state_out = decode_args(&out_args_buf).ok_or(SysError::Encoding)?;
        let cap_out = load_cell_capacity(out_idx, Source::Output)?;

        if cap_out != state_out.bid_shannons {
            return Err(SysError::Encoding);
        }

        if state_out.end_block != state_in.end_block {
            return Err(SysError::Encoding);
        }
        if state_out.price_step_shannons != state_in.price_step_shannons {
            return Err(SysError::Encoding);
        }

        let min_next = state_in
            .bid_shannons
            .checked_add(state_in.price_step_shannons)
            .ok_or(SysError::Encoding)?;
        if state_out.bid_shannons < min_next {
            return Err(SysError::Encoding);
        }

        let new_bidder_present = input_has_lock_hash(&state_out.bidder_lock_hash, Some(in_idx))?;
        if !new_bidder_present {
            return Err(SysError::ItemMissing);
        }

        let in_type = load_cell_type_hash(in_idx, Source::Input)?;
        let out_type = load_cell_type_hash(out_idx, Source::Output)?;
        match (in_type, out_type) {
            (None, None) => {}
            (Some(a), Some(b)) if a.as_slice() == b.as_slice() => {}
            _ => return Err(SysError::Encoding),
        }

        let in_data = load_cell_data(in_idx, Source::Input)?;
        let out_data = load_cell_data(out_idx, Source::Output)?;
        if in_data != out_data {
            return Err(SysError::Encoding);
        }

        let refund_sum = sum_outputs_capacity_with_lock(&state_in.bidder_lock_hash)?;
        if refund_sum < state_in.bid_shannons {
            return Err(SysError::Encoding);
        }

        return Ok(());
    } else {
        if !out_indices_by_code.is_empty() {
            return Err(SysError::IndexOutOfBound);
        }

        let winner_present = input_has_lock_hash(&state_in.bidder_lock_hash, None)?;
        if !winner_present {
            return Err(SysError::ItemMissing);
        }

        if now_block < state_in.end_block {
            return Err(SysError::Encoding);
        }

        let payout_sum = sum_outputs_capacity_with_lock(&state_in.bidder_lock_hash)?;
        if payout_sum < cap_in {
            return Err(SysError::Encoding);
        }

        return Ok(());
    }
}

pub fn program_entry() -> i8 {
    match validate() {
        Ok(()) => 0,
        Err(_err) => 1,
    }
}