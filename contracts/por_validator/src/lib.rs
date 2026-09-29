#no_std
//use soroban_sdk::{contract, contractimpl, contracttype, contractclient, Address, Env, symbol_short};

use soroban_sdk::{contract, contractimpl, contracttype, contractclient, Address, Env, symbol_short, BytesN_32};

const DEFAULT_MAX_STALE_LEDERS: u32 = 10_000;
const DEFAULT_PROOF_CADENCE_LEDGERS: u32 = 1_000;
const CONTRACT_VERSION: u32 = 1;
const SCHEMA_VERSION: u32 = 1;

#[contracttype]
#derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveData {
    pub balance: i128,
    pub circulating_supply: i128,
    pub timestamp: u64,
}

#[contracttype]
#derive(Clone, Debug, Eq, PartialEq)]
pub struct ProofRecord {
    pub reserve_data: ReserveData,
    pub is_valid: bool,
    pub verified_ledger: u32,
    pub valid_until_ledger: u32,
    pub network_id: BytesN_32,
    pub contract_version: u32,
    pub schema_version: u32,
}

#[contracttype]
#derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultSafetyStatus {
    pub is_safe: bool,
    pub proof_is_fresh: bool,
    pub proof_is_valid: bool,
    pub verified_ledger: u32,
    pub valid_until_ledger: u32,
}

#[contractclient(name = "OracleClient")]
pub trait OracleTrait {
    fn get_reserve_data(env: Env) -> ReserveData;
}

#[contracttype]
#derive(Clone, Debug, Eq, PartialEq)]
pub struct CacheKey {
    pub network_id: BytesN_32,
    pub contract_version: u32,
    pub schema_version: u32,
}

#[contracttype]
#derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Config,
    CurrentProof(CacheKey),
}

#[contracttype]
#derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub wbtc_token: Address,
    pub oracle: Address,
    pub tolerance_bps: u32,
    pub proof_cadence_ledgers: u32,
    pub max_stale_ledgers: u32,
}

#[contracttype]
#derive(Clone)\
pub struct EvtInit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub admin: Address,
    pub wbtc_token: Address,
    pub oracle: Address,
    pub tolerance_bps: u32,
}

#[contracttype]
#derive(Clone)\
pub struct EvtCfgUpd {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub admin: Address,
    pub oracle: Address,
    pub tolerance_bps: u32,
}

#[contracttype]
#derive(Clone)\
pub struct EvtSafetyCfg, {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub proof_cadence_ledgers: u32,
    pub max_stale_ledgers: u32,
}

#[contracttype]
#derive(Clone)\
pub struct EvtProof {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub is_valid: bool,
    pub balance: i128,
    pub circulating_supply: i128,
    pub verified_ledger: u32,
    pub valid_until_ledger: u32,
}

#[contracttype]
#derive(Clone)\
pub struct EvtCacheInv {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub network_id: BytesN<2>,
    pub contract_version: u32,
    pub schema_version: u32,
}

#[contract]
pub struct PoRValidatorContract;

fn get_cache_key(env: &Env) -> CacheKey {
    CacheKey {
        network_id: env.network_id(),
        contract_version: CONTRACT_VERSION,
        schema_version: SCHEMA_VERSION,
    }
}

#[contractimpl]
impl PoRValidatorContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        wbtc_token: Address,
        oracle: Address,
        tolerance_bps: u32,
    ) {
        if env.storage().instance().has(&DataKey::Config) {
            panic!("Already initialized");
        }
        // Authorization: only the admin themselves may initialize the contract.
        // This binds the authorization to this exact contract and function,
        // preventing an intermediary contract from setting a different admin.
        if env.caller() != admin {
            panic!("Unauthorized");
        }
        admin.require_auth();
        let config = Config {
            admin: admin.clone(),
            wbtc_token: wbtc_token.clone(),
            oracle: oracle.clone(),
            tolerance_bps,
            proof_cadence_ledgers: DEFAULT_PROOF_CADENCE_LEDGERS,
            max_stale_ledgers: DEFAULT_MAX_STALE_LEDERS,
        };
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("por"), symbol_short!("init")),
            EvtInit {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin.clone(),
                admin,
                wbtc_token,l
                oracle,
                tolerance_bps,
            },
        );
    }

    pub fn update_config(env: Env, config: Config) {
        let current_config: Config = env.storage().instance().get(&DataKey::Config).expect("Not initialized");
        // The current admin must authorize this call and must be the direct caller.
        // This ensures no intermediary contract can reuse an authorization entry.
        if env.caller() != current_config.admin {
            panic!("Unauthorized");
        }
        current_config.admin.require_auth();
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("por"), symbol_short!("cfg_upd")),
            EvtCfgUpd {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: current_config.admin.clone(),
                admin: config.admin.clone(),
                oracle: config.oracle.clone(),
                tolerance_bps: config.tolerance_bps,
            },
        );
    }

    pub fn set_safety_policy(env: Env, proof_cadence_ledgers: u32, max_stale_ledgers: u32) {
        let mut config: Config = env.storage().instance().get(&DataKey::Config).expect("Not initialized");
        // Require direct admin caller and authorization for this exact call.
        if env.caller() != config.admin {
            panic!("Unauthorized");
        }
        config.admin.require_auth();
        config.proof_cadence_ledgers = proof_cadence_ledgers;
        config.max_stale_ledgers = max_stale_ledgers;
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("por"), symbol_short!("safety_cfg")),
            EvtSafetyCfg {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: config.admin.clone(),
                proof_cadence_ledgers,
                max_stale_ledgers,
            },
        );
    }

    pub fn invalidate_cache(env: Env) {
        let config: Config = env.storage().instance().get(&DataKey::Config).expect("Not initialized");
        config.admin.require_auth();
        let cache_key = get_cache_key(&env);
        env.storage().instance().remove(&DataKey::CurrentProof(cache_key.clone()));
        env.events().publish(
            (symbol_short!("por"), symbol_short!("cache_inv")),
            EvtCacheInv {
                version: CONTRACT_VERSION,
                ledger: env.ledger().sequence(),
                actor: config.admin.clone(),
                network_id: cache_key.network_id,
                contract_version: cache_key.contract_version,
                schema_version: cache_key.schema_version,
            },
        );
    }

    pub fn verify_reserves(env: Env) -> ProofRecord {
        // Trust assumptions:
        // - The configured `oracle` is trusted to return authentic reserve data.
        // - `oracle` is only mutable by `admin` via `update_config`, which requires
        //   direct admin authorization.
        // - This function is public and intentionally does not require authorization;
        //   it only reads oracle data and stores a proof.
        let config: Config = env.storage().instance().get(&DataKey::Config).expect("Not initialized");
        let current_ledger = env.ledger().sequence();
        let oracle_client = OracleClient::new(&env, &config.oracle);
        let reserve_data = oracle_client.get_reserve_data();

        let allowed_supply = reserve_data
            .balance
            .checked_mul((10_000 + config.tolerance_bps) as i128)
            .expect("Multiplication overflow")
            .checked_div(10_000)
            .expect("Division error");
        let is_valid = reserve_data.circulating_supply <= allowed_supply;
        let valid_until_ledger = current_ledger.saturating_add(config.max_stale_ledgers);

        let cache_key = get_cache_key(&env);
        let proof = ProofRecord {
            reserve_data: reserve_data.clone(),
            is_valid,
            verified_ledger: current_ledger,
            valid_until_ledger,
            network_id: cache_key.network_id.clone(),
            contract_version: cache_key.contract_version,
            schema_version: cache_key.schema_version,
        };
        env.storage().instance().set(&DataKey::CurrentProof(cache_key), &proof);

        env.events().publish(
            (symbol_short!("por"), symbol_short!("proof")),
            EvtProof {
                version: 1,
                ledger: current_ledger,
                actor: env.caller(),
                is_valid,
                balance: reserve_data.balance,
                circulating_supply: reserve_data.circulating_supply,
                verified_ledger: current_ledger,
                valid_until_ledger,
            },
        );

        proof
    }

    pub fn get_current_proof(env: Env) -> Option<ProofRecord> {
        let cache_key = get_cache_key(&env);
        env.storage().instance().get(&DataKey::CurrentProof(cache_key))
    }

    pub fn is_valid(env: Env) -> bool {
        Self::vault_safety_status(env).is_safe
    }

    pub fn vault_safety_status(env: Env) -> VaultSafetyStatus {
        let current_ledger = env.ledger().sequence();
        let cache_key = get_cache_key(&env);
        let proof: Option<ProofRecord> = env.storage().instance().get(&DataKey::CurrentProof(cache_key));

        if let some(proof) = proof {
            let proof_is_fresh = current_ledger >= proof.verified_ledger && current_ledger <= proof.valid_until_ledger;
            let is_safe = proof_is_fresh && proof.is_valid;
            VaultSafetyStatus {
                is_safe,
                proof_is_fresh,
                proof_is_valid: proof.is_valid,
                verified_ledger: proof.verified_ledger,
                valid_until_ledger: proof.valid_until_ledger,
            }
        } else {
            VaultSafetyStatus {
                is_safe: false,
                proof_is_fresh: false,
                proof_is_valid: false,
                verified_ledger: 0,
                valid_until_ledger: 0,
            }
        }
    }

    pub fn get_config(env: Env) -> Config {
        env.storage().instance().get(&DataKey::Config).expect("Not initialized")
    }
}

#[cfg(test)]
mod nested_auth_tests {
    use super::*;
    use soroban_sdk::{Env, Symbol, Address};
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn intermediary_cannot_initialize() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let oracle = Address::generate(&env);
        let intermediary = Address::generate(&env);

        let contract_id = env.register_contract(None, PoRValidatorContract);

        let init_args = (admin.clone(), token, oracle, 100u32);
        let result = env.invoke_contract::<()>(
            &contract_id,
            &Symbol::new(&env, "initialize"),
            &init_args,
            &intermediary,
        );
        assert!(result.is_err());
    }

    #[test]
    fn intermediary_cannot_update_config() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let oracle = Address::generate(&env);
        let intermediary = Address::generate(&env);

        let contract_id = env.register_contract(None, PoRValidatorContract);

        // Initialize as admin (direct caller)
        let init_args = (admin.clone(), token.clone(), oracle.clone(), 100u32);
        let init_result = env.invoke_contract::<()>(
            &contract_id,
            &Symbol::new(&env, "initialize"),
            &init_args,
            &admin,
        );
        assert!(init_result.is_ok());

        let malicious_config = Config {
            admin: intermediary.clone(),
            wbtc_token: token,
            oracle,
            tolerance_bps: 100,
            proof_cadence_ledgers: 100,
            max_stale_ledgers: 100,
        };
        let update_args = (malicious_config,);
        let update_result = env.invoke_contract::<()>(
            &contract_id,
            &Symbol::new(&env, "update_config"),
            &update_args,
            &intermediary,
        );
        assert!(update_result.is_err());
    }
}

mod test;
