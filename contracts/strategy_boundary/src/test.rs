#![cfg(test)]

use soroban_sdk::{symbol_short, Address, Env, BytesN};

use super::{StrategyBoundaryContract, DataKey, RiskLevel, StrategyMetadata, AllocationLimits, RiskLimits, HealthStatus, StrategyHealth, WithdrawalRequest};

#[test]
fn test_initialization() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StrategyBoundaryContract);
    let client = StrategyBoundaryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unified_auth = Address::generate(&env);

    client.init(&admin, &unified_auth);

    // Verify default limits are set
    let limits = client.get_allocation_limits();
    assert_eq!(limits.max_total_allocation, 1_000_000_000);
    assert_eq!(limits.min_diversification, 3);
}

#[test]
fn test_register_strategy() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StrategyBoundaryContract);
    let client = StrategyBoundaryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unified_auth = Address::generate(&env);
    client.init(&admin, &unified_auth);

    let strategy_id = BytesN::from_array(&env, &[1u8; 32]);
    let strategy_address = Address::generate(&env);
    
    let metadata = StrategyMetadata {
        strategy_id: strategy_id.clone(),
        strategy_address,
        risk_level: RiskLevel::Medium,
        max_allocation: 100_000_000,
        min_liquidity: 10_000_000,
        withdrawal_delay: 7200, // 10 hours
        audit_report: BytesN::from_array(&env, &[2u8; 32]),
        audit_expiry: env.ledger().timestamp() + 86400 * 30, // 30 days
    };

    let signature = [0u8; 64];
    client.register_strategy(&metadata, &signature);

    // Verify strategy is registered
    let retrieved = client.get_strategy_metadata(&strategy_id).unwrap();
    assert_eq!(retrieved.strategy_id, strategy_id);
    assert_eq!(retrieved.risk_level, RiskLevel::Medium);
}

#[test]
fn test_register_strategy_expired_audit() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StrategyBoundaryContract);
    let client = StrategyBoundaryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unified_auth = Address::generate(&env);
    client.init(&admin, &unified_auth);

    let strategy_id = BytesN::from_array(&env, &[1u8; 32]);
    let strategy_address = Address::generate(&env);
    
    let metadata = StrategyMetadata {
        strategy_id: strategy_id.clone(),
        strategy_address,
        risk_level: RiskLevel::Medium,
        max_allocation: 100_000_000,
        min_liquidity: 10_000_000,
        withdrawal_delay: 7200,
        audit_report: BytesN::from_array(&env, &[2u8; 32]),
        audit_expiry: env.ledger().timestamp() - 1000, // Expired
    };

    let signature = [0u8; 64];
    
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.register_strategy(&metadata, &signature);
    }));
    assert!(result.is_err());
}

#[test]
fn test_disable_strategy() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StrategyBoundaryContract);
    let client = StrategyBoundaryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unified_auth = Address::generate(&env);
    client.init(&admin, &unified_auth);

    let strategy_id = BytesN::from_array(&env, &[1u8; 32]);
    let strategy_address = Address::generate(&env);
    
    let metadata = StrategyMetadata {
        strategy_id: strategy_id.clone(),
        strategy_address,
        risk_level: RiskLevel::Medium,
        max_allocation: 100_000_000,
        min_liquidity: 10_000_000,
        withdrawal_delay: 7200,
        audit_report: BytesN::from_array(&env, &[2u8; 32]),
        audit_expiry: env.ledger().timestamp() + 86400 * 30,
    };

    let signature = [0u8; 64];
    client.register_strategy(&metadata, &signature);

    client.disable_strategy(&strategy_id);

    assert!(client.is_strategy_disabled(&strategy_id));
}

#[test]
fn test_allocation_limits() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StrategyBoundaryContract);
    let client = StrategyBoundaryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unified_auth = Address::generate(&env);
    client.init(&admin, &unified_auth);

    let strategy_id = BytesN::from_array(&env, &[1u8; 32]);
    let strategy_address = Address::generate(&env);
    
    let metadata = StrategyMetadata {
        strategy_id: strategy_id.clone(),
        strategy_address,
        risk_level: RiskLevel::Medium,
        max_allocation: 100_000_000,
        min_liquidity: 10_000_000,
        withdrawal_delay: 7200,
        audit_report: BytesN::from_array(&env, &[2u8; 32]),
        audit_expiry: env.ledger().timestamp() + 86400 * 30,
    };

    let signature = [0u8; 64];
    client.register_strategy(&metadata, &signature);

    // Try to allocate more than max per strategy
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.allocate_to_strategy(&strategy_id, &600_000_000);
    }));
    assert!(result.is_err());
}

#[test]
fn test_diversification_requirement() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StrategyBoundaryContract);
    let client = StrategyBoundaryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unified_auth = Address::generate(&env);
    client.init(&admin, &unified_auth);

    let strategy_id = BytesN::from_array(&env, &[1u8; 32]);
    let strategy_address = Address::generate(&env);
    
    let metadata = StrategyMetadata {
        strategy_id: strategy_id.clone(),
        strategy_address,
        risk_level: RiskLevel::Medium,
        max_allocation: 100_000_000,
        min_liquidity: 10_000_000,
        withdrawal_delay: 7200,
        audit_report: BytesN::from_array(&env, &[2u8; 32]),
        audit_expiry: env.ledger().timestamp() + 86400 * 30,
    };

    let signature = [0u8; 64];
    client.register_strategy(&metadata, &signature);

    // Try to allocate with insufficient diversification (only 1 strategy)
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.allocate_to_strategy(&strategy_id, &10_000_000);
    }));
    assert!(result.is_err());
}

#[test]
fn test_withdrawal_request() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StrategyBoundaryContract);
    let client = StrategyBoundaryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unified_auth = Address::generate(&env);
    client.init(&admin, &unified_auth);

    let strategy_id = BytesN::from_array(&env, &[1u8; 32]);
    let strategy_address = Address::generate(&env);
    
    let metadata = StrategyMetadata {
        strategy_id: strategy_id.clone(),
        strategy_address,
        risk_level: RiskLevel::Medium,
        max_allocation: 100_000_000,
        min_liquidity: 10_000_000,
        withdrawal_delay: 7200,
        audit_report: BytesN::from_array(&env, &[2u8; 32]),
        audit_expiry: env.ledger().timestamp() + 86400 * 30,
    };

    let signature = [0u8; 64];
    client.register_strategy(&metadata, &signature);

    // Request withdrawal
    client.request_strategy_withdrawal(&strategy_id, &1_000_000);

    // In production, this would verify the withdrawal request was created
    // For now, this test documents the expected behavior
}

#[test]
fn test_health_update_auto_disable() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StrategyBoundaryContract);
    let client = StrategyBoundaryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unified_auth = Address::generate(&env);
    client.init(&admin, &unified_auth);

    let strategy_id = BytesN::from_array(&env, &[1u8; 32]);
    let strategy_address = Address::generate(&env);
    
    let metadata = StrategyMetadata {
        strategy_id: strategy_id.clone(),
        strategy_address,
        risk_level: RiskLevel::Medium,
        max_allocation: 100_000_000,
        min_liquidity: 10_000_000,
        withdrawal_delay: 7200,
        audit_report: BytesN::from_array(&env, &[2u8; 32]),
        audit_expiry: env.ledger().timestamp() + 86400 * 30,
    };

    let signature = [0u8; 64];
    client.register_strategy(&metadata, &signature);

    assert!(!client.is_strategy_disabled(&strategy_id));

    // Update health to critical
    let health = StrategyHealth {
        strategy_id: strategy_id.clone(),
        total_value: 50_000_000,
        user_funds: 40_000_000,
        performance: -2000, // -20%
        last_updated: env.ledger().timestamp(),
        health_status: HealthStatus::Critical,
    };

    client.update_strategy_health(&health);

    // Strategy should be auto-disabled
    assert!(client.is_strategy_disabled(&strategy_id));
}

#[test]
fn test_custom_allocation_limits() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StrategyBoundaryContract);
    let client = StrategyBoundaryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unified_auth = Address::generate(&env);
    client.init(&admin, &unified_auth);

    let custom_limits = AllocationLimits {
        max_total_allocation: 2_000_000_000,
        max_per_strategy: 1_000_000_000,
        min_diversification: 5,
        max_concentration: 3000,
    };

    client.set_allocation_limits(&custom_limits);

    let retrieved = client.get_allocation_limits();
    assert_eq!(retrieved.max_total_allocation, 2_000_000_000);
    assert_eq!(retrieved.min_diversification, 5);
}

#[test]
fn test_custom_risk_limits() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StrategyBoundaryContract);
    let client = StrategyBoundaryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unified_auth = Address::generate(&env);
    client.init(&admin, &unified_auth);

    let custom_risk = RiskLimits {
        max_smart_contract_exposure: 300_000_000,
        max_market_exposure: 400_000_000,
        max_liquidity_exposure: 150_000_000,
        max_single_counterparty: 500_000_000,
    };

    client.set_risk_limits(&custom_risk);

    let retrieved = client.get_risk_limits();
    assert_eq!(retrieved.max_smart_contract_exposure, 300_000_000);
}
