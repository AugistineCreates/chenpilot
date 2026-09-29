#![no_std]

use soroban_sdk::{contracterror, Env};

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
#[repr(u32)]
pub enum FailureReason {
    Unauthorized = 1,
    AlreadyInitialized = 2,
    NotInitialized = 3,

    InvalidArgument = 10,
    InvalidState = 11,
    NotFound = 12,
    AlreadyExists = 13,

    AmountNotPositive = 20,
    InsufficientBalance = 21,
    SlippageExceeded = 22,

    BackendOffline = 30,
    BackendOnline = 31,
    EmergencyMode = 32,
    UpgradeMode = 33,

    TimelockNotExpired = 40,
    ChallengePeriodNotElapsed = 41,
    UnbondingPeriodNotMet = 42,

    ForceExitAlreadyPending = 50,
    NoPendingForceExit = 51,
    NoPendingUpgrade = 52,
    UnifiedAuthNotConfigured = 53,

    OraclePriceMissing = 60,
    OracleDataStale = 61,
    OracleSequenceNotIncreasing = 62,
    OracleUpdateGapExceeded = 63,
    SnapshotTooRecent = 64,
    SnapshotSameLedger = 65,
    SnapshotTooOld = 66,
    CircuitBreakerActive = 67,
    CircuitBreakerTripped = 68,
    PriceDeviationExceedsThreshold = 69,
    ConsecutivePriceChangeExceedsThreshold = 70,

    InvalidBasisPoints = 80,
    BorrowExceedsLTV = 81,
    NoDebtToLiquidate = 82,
    PositionHealthy = 83,

    SwapAlreadyExists = 90,
    SwapNotActive = 91,
    SwapExpired = 92,
    SwapNotYetExpired = 93,
    InvalidPreimage = 94,
    ExpiryNotInFuture = 95,

    TxAlreadyClaimed = 100,
    InvalidBlockHeaderLength = 101,
    ProofOfWorkCheckFailed = 102,
    InsufficientMerkleProofDepth = 103,
    MerkleProofInvalid = 104,

    StrategyDisabled = 110,
    AuditReportExpired = 111,
    MaxTotalAllocationExceeded = 112,
    MaxPerStrategyAllocationExceeded = 113,
    InsufficientDiversification = 114,
    MaxConcentrationExceeded = 115,
    InsufficientAllocation = 116,
    WithdrawalNotYetEligible = 117,
    NotInEmergencyMode = 118,
    NoAllocationToWithdraw = 119,

    AgentNotAuthorized = 130,
    PoolNotVerified = 131,
    SlashedRelayersCannotWithdraw = 132,
    UnstakeNotRequested = 133,

    LiquidityProtectionViolation = 140,
    DepositForceExitMismatch = 141,

    StorageValueMissing = 200,
    ArithmeticError = 201,

    InsufficientQuorum = 210,
    InsufficientQuorumWeight = 211,
    ExcessiveSourceDisagreement = 212,
    SourceAlreadyRegistered = 213,
    SourceNotRegistered = 214,
    InvalidWeight = 215,
    InvalidQuorumConfig = 216,
    NoValidSources = 217,
    TooManySources = 218,
}

pub fn fail(env: &Env, reason: FailureReason) -> ! {
    env.panic_with_error(reason)
}

pub fn require(env: &Env, condition: bool, reason: FailureReason) {
    if !condition {
        fail(env, reason);
    }
}

pub fn unwrap_or_fail<T>(env: &Env, value: Option<T>, reason: FailureReason) -> T {
    match value {
        Some(v) => v,
        None => fail(env, reason),
    }
}
