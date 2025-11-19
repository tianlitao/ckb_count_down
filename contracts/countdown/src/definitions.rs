// 布局常量
pub const ARGS_LEN: usize = 32 + 2 + 2;
pub const POT_DATA_LEN: usize = 1;
pub const BET_DATA_MIN_LEN: usize = 8 + 1 + 32;

// 类型标记
pub const POT_KIND: u8 = 1;

pub struct GlobalConfig {
    pub platform_hash: [u8; 32],
    pub house_edge_bp: u16,
    pub confirmations: u16,
}

impl GlobalConfig {
    pub fn from_slice(data: &[u8]) -> Option<Self> {
        if data.len() != ARGS_LEN {
            return None;
        }
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&data[0..32]);

        let house_edge_bp = u16::from_le_bytes(data[32..34].try_into().unwrap());
        let confirmations = u16::from_le_bytes(data[34..36].try_into().unwrap());

        Some(GlobalConfig {
            platform_hash: hash,
            house_edge_bp,
            confirmations,
        })
    }
}

pub struct BetData<'a> {
    pub stake: u64,
    pub guess: u8,
    pub bettor_lock_hash: &'a [u8],
}

impl<'a> BetData<'a> {
    pub fn from_slice(data: &'a [u8]) -> Option<Self> {
        if data.len() < BET_DATA_MIN_LEN {
            return None;
        }
        let stake = u64::from_le_bytes(data[0..8].try_into().unwrap());
        let guess = data[8];
        let bettor_lock_hash = &data[9..41];
        if bettor_lock_hash.len() != 32 { return None; }
        if guess > 1 { return None; }
        Some(BetData { stake, guess, bettor_lock_hash })
    }
}
