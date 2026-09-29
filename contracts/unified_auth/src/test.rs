#![cfg(test)]

use soroban_sdk::{symbol_short, Address, Env};

use super::{DataKey, EmergencyReason, UnifiedAuthContract, UnifiedRole, ContractId, EvtInit, EvtRoleGranted, EvtRoleRevoked, EvtAdminTransferred, EvtEmergencyTriggered, EvtEmergencyEnded, EvtContractRegistered, EvtContractUnregistered};

#[test]
fn test_initialization() {
    let env = Env::default();
    let contract_id = env.register_contract(None, UnifiedAuthContract);
    let client = UnifiedAuthContractClient::new(&env, &contract_id);

    let super_admin = Address::generate(&env);
    
    client.init(&super_admin);

    // Verify super admin is set
    assert_eq!(client.super_admin(), super_admin);
}

#[test]
fn test_cannot_reinitialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, UnifiedAuthContract);
    let client = UnifiedAuthContractClient::new(&env, &contract_id);

    let super_admin = Address::generate(&env);
    client.init(&super_admin);

    // Second init should panic
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.init(&super_admin);
    }));
    assert!(result.is_err());
}

#[test]
fn test_grant_role() {
    let env = Env::default();
    let contract_id = env.register_contract(None, UnifiedAuthContract);
    let client = UnifiedAuthContractClient::new(&env, &contract_id);

    let super_admin = Address::generate(&env);
    client.init(&super_admin);

    let user = Address::generate(&env);
    let role = UnifiedRole::EmergencyAdmin;

    client.grant_role(&user, &role);

    // Verify role was granted
    assert!(client.has_role(&user, &role));
}

#[test]
fn test_grant_role_unauthorized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, UnifiedAuthContract);
    let client = UnifiedAuthContractClient::new(&env, &contract_id);

    let super_admin = Address::generate(&env);
    client.init(&super_admin);

    let user = Address::generate(&env);
    let role = UnifiedRole::EmergencyAdmin;

    // Try to grant role as non-super-admin
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.with_source_account(&user).grant_role(&user, &role);
    }));
    assert!(result.is_err());
}

#[test]
fn test_revoke_role() {
    let env = Env::default();
    let contract_id = env.register_contract(None, UnifiedAuthContract);
    let client = UnifiedAuthContractClient::new(&env, &contract_id);

    let super_admin = Address::generate(&env);
    client.init(&super_admin);

    let user = Address::generate(&env);
    let role = UnifiedRole::EmergencyAdmin;

    client.grant_role(&user, &role);
    assert!(client.has_role(&user, &role));

    client.revoke_role(&user, &role);
    assert!(!client.has_role(&user, &role));
}

#[test]
fn test_require_role() {
    let env = Env::default();
    let contract_id = env.register_contract(None, UnifiedAuthContract);
    let client = UnifiedAuthContractClient::new(&env, &contract_id);

    let super_admin = Address::generate(&env);
    client.init(&super_admin);

    let user = Address::generate(&env);
    let role = UnifiedRole::EmergencyAdmin;

    // Should panic when role not held
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.require_role(&user, &role);
    }));
    assert!(result.is_err());

    // Should not panic when role is held
    client.grant_role(&user, &role);
    client.require_role(&user, &role);
}

#[test]
fn test_transfer_super_admin() {
    let env = Env::default();
    let contract_id = env.register_contract(None, UnifiedAuthContract);
    let client = UnifiedAuthContractClient::new(&env, &contract_id);

    let old_admin = Address::generate(&env);
    client.init(&old_admin);

    let new_admin = Address::generate(&env);
    client.transfer_super_admin(&new_admin);

    // Verify admin was transferred
    assert_eq!(client.super_admin(), new_admin);
}

#[test]
fn test_emergency_trigger() {
    let env = Env::default();
    let contract_id = env.register_contract(None, UnifiedAuthContract);
    let client = UnifiedAuthContractClient::new(&env, &contract_id);

    let super_admin = Address::generate(&env);
    client.init(&super_admin);

    let emergency_admin = Address::generate(&env);
    client.grant_role(&emergency_admin, &UnifiedRole::EmergencyAdmin);

    // Trigger emergency as emergency admin
    client.with_source_account(&emergency_admin)
        .trigger_emergency(&EmergencyReason::GovernanceDecision);

    // Verify emergency is active
    assert!(client.is_emergency_active());
    
    let state = client.get_emergency_state().unwrap();
    assert!(state.is_emergency);
    assert_eq!(state.triggered_by, emergency_admin);
}

#[test]
fn test_emergency_end() {
    let env = Env::default();
    let contract_id = env.register_contract(None, UnifiedAuthContract);
    let client = UnifiedAuthContractClient::new(&env, &contract_id);

    let super_admin = Address::generate(&env);
    client.init(&super_admin);

    let emergency_admin = Address::generate(&env);
    client.grant_role(&emergency_admin, &UnifiedRole::EmergencyAdmin);

    // Trigger emergency
    client.with_source_account(&emergency_admin)
        .trigger_emergency(&EmergencyReason::GovernanceDecision);
    assert!(client.is_emergency_active());

    // End emergency
    client.with_source_account(&emergency_admin)
        .end_emergency();
    
    assert!(!client.is_emergency_active());
}

#[test]
fn test_contract_registration() {
    let env = Env::default();
    let contract_id = env.register_contract(None, UnifiedAuthContract);
    let client = UnifiedAuthContractClient::new(&env, &contract_id);

    let super_admin = Address::generate(&env);
    client.init(&super_admin);

    let contract_address = Address::generate(&env);
    client.register_contract(&ContractId::CoreVault, &contract_address);

    // Verify contract is registered
    assert!(client.is_contract_registered(&ContractId::CoreVault));
    assert_eq!(client.get_contract_address(&ContractId::CoreVault).unwrap(), contract_address);
}

#[test]
fn test_contract_unregistration() {
    let env = Env::default();
    let contract_id = env.register_contract(None, UnifiedAuthContract);
    let client = UnifiedAuthContractClient::new(&env, &contract_id);

    let super_admin = Address::generate(&env);
    client.init(&super_admin);

    let contract_address = Address::generate(&env);
    client.register_contract(&ContractId::CoreVault, &contract_address);
    assert!(client.is_contract_registered(&ContractId::CoreVault));

    client.unregister_contract(&ContractId::CoreVault);
    assert!(!client.is_contract_registered(&ContractId::CoreVault));
}

#[test]
fn test_role_separation() {
    let env = Env::default();
    let contract_id = env.register_contract(None, UnifiedAuthContract);
    let client = UnifiedAuthContractClient::new(&env, &contract_id);

    let super_admin = Address::generate(&env);
    client.init(&super_admin);

    let emergency_admin = Address::generate(&env);
    let vault_admin = Address::generate(&env);
    let upgrade_admin = Address::generate(&env);

    client.grant_role(&emergency_admin, &UnifiedRole::EmergencyAdmin);
    client.grant_role(&vault_admin, &UnifiedRole::VaultAdmin);
    client.grant_role(&upgrade_admin, &UnifiedRole::UpgradeAdmin);

    // Verify each role is independent
    assert!(client.has_role(&emergency_admin, &UnifiedRole::EmergencyAdmin));
    assert!(!client.has_role(&emergency_admin, &UnifiedRole::VaultAdmin));
    assert!(!client.has_role(&emergency_admin, &UnifiedRole::UpgradeAdmin));

    assert!(client.has_role(&vault_admin, &UnifiedRole::VaultAdmin));
    assert!(!client.has_role(&vault_admin, &UnifiedRole::EmergencyAdmin));

    assert!(client.has_role(&upgrade_admin, &UnifiedRole::UpgradeAdmin));
    assert!(!client.has_role(&upgrade_admin, &UnifiedRole::VaultAdmin));
}
