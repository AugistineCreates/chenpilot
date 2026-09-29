//! Central TTL policy for Soroban storage: every key type declares its
//! durability and renewal rule once, and `Store` applies it on every access.
#![no_std]

use soroban_sdk::{Env, IntoVal, TryFromVal, Val};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Durability {
    Instance,
    Persistent,
    Temporary,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KeyPolicy {
    pub durability: Durability,
    /// Renew when the remaining TTL drops below this many ledgers.
    pub threshold: u32,
    /// Renew up to this many ledgers from now.
    pub extend_to: u32,
}

impl KeyPolicy {
    pub const fn new(durability: Durability, threshold: u32, extend_to: u32) -> Self {
        Self { durability, threshold, extend_to }
    }

    /// Valid when the threshold does not exceed the target and the target
    /// fits inside the network's maximum TTL.
    pub fn is_valid(&self, max_ttl: u32) -> bool {
        self.threshold <= self.extend_to && self.extend_to <= max_ttl
    }
}

/// Implemented by each contract's `DataKey` enum.
pub trait PolicyKey {
    fn policy(&self) -> KeyPolicy;
}

/// Storage access that always applies the key's TTL policy.
pub struct Store<'a> {
    env: &'a Env,
}

impl<'a> Store<'a> {
    pub fn new(env: &'a Env) -> Self {
        Self { env }
    }

    pub fn set<K, V>(&self, key: &K, value: &V)
    where
        K: PolicyKey + IntoVal<Env, Val>,
        V: IntoVal<Env, Val>,
    {
        match key.policy().durability {
            Durability::Instance => self.env.storage().instance().set(key, value),
            Durability::Persistent => self.env.storage().persistent().set(key, value),
            Durability::Temporary => self.env.storage().temporary().set(key, value),
        }
        self.renew(key);
    }

    pub fn get<K, V>(&self, key: &K) -> Option<V>
    where
        K: PolicyKey + IntoVal<Env, Val>,
        V: TryFromVal<Env, Val>,
    {
        let value = match key.policy().durability {
            Durability::Instance => self.env.storage().instance().get(key),
            Durability::Persistent => self.env.storage().persistent().get(key),
            Durability::Temporary => self.env.storage().temporary().get(key),
        };
        if value.is_some() {
            self.renew(key);
        }
        value
    }

    /// Keeps the contract instance itself alive. Call at the start of every
    /// public entry point: if the instance expires, the contract cannot be
    /// invoked at all, whatever the TTL of its other entries.
    pub fn bump_instance(&self, threshold: u32, extend_to: u32) {
        self.env.storage().instance().extend_ttl(threshold, extend_to);
    }

    /// Only call for keys that exist: extending a missing entry panics.
    fn renew<K>(&self, key: &K)
    where
        K: PolicyKey + IntoVal<Env, Val>,
    {
        let p = key.policy();
        match p.durability {
            Durability::Instance => self.env.storage().instance().extend_ttl(p.threshold, p.extend_to),
            Durability::Persistent => self.env.storage().persistent().extend_ttl(key, p.threshold, p.extend_to),
            Durability::Temporary => self.env.storage().temporary().extend_ttl(key, p.threshold, p.extend_to),
        }
    }
}

#[cfg(test)]
mod test;
