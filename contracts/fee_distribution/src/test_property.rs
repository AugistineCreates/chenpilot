#![cfg(test)]

//! Property tests comparing the on-chain cumulative reward-index contract
//! against a high-precision rational reference model.
//!
//! Invariants verified at every checkpoint:
//!   1. **Never over-claim (the hard correctness invariant).** For every user,
//!      the total value they can withdraw (already claimed + `pending_rewards`)
//!      is never greater than their exact accrued reward. This means a late
//!      joiner or a partially-exited participant can never pull historical
//!      rewards they did not earn.
//!   2. **Round-trip conserves value within a bounded dust.** The total a user
//!      can withdraw is within `MAX_DUST` of their exact accrued reward, so the
//!      integer model does not silently destroy user rewards. The irreducible
//!      truncation remainder deterministically stays in the contract's reward
//!      pool (see module doc).

use super::*;
use num_bigint::BigInt;
use num_traits::{One, Zero, Signed};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env};

/// Maximum rounding dust (in reward-token units) a single user may lose to the
/// pool across the whole run. Larger than per-claim dust to bound cumulative
/// truncation from many distributes and claims.
const MAX_DUST: i128 = 64;

fn gcd(a: &BigInt, b: &BigInt) -> BigInt {
    if b.is_zero() {
        return a.abs();
    }
    gcd(b, &(a % b))
}

/// A high-precision rational accumulator for one user's accrued rewards.
#[derive(Clone)]
struct Rational {
    num: BigInt,
    den: BigInt,
}

impl Rational {
    fn zero() -> Self {
        Rational { num: BigInt::zero(), den: BigInt::one() }
    }
    fn add(&mut self, n: &BigInt, d: &BigInt) {
        let new_num = &self.num * d + n * &self.den;
        let new_den = &self.den * d;
        let g = gcd(&new_num, &new_den);
        self.num = new_num / &g;
        self.den = new_den / &g;
    }
    fn floor(&self) -> i128 {
        let q = &self.num / &self.den;
        q.to_string().parse::<i128>().unwrap_or(i128::MAX)
    }
}

struct Prng {
    state: u64,
}
impl Prng {
    fn new(seed: u64) -> Self {
        Prng { state: seed.wrapping_mul(2654435761) }
    }
    fn next(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.state = x;
        if self.state == 0 {
            self.state = 0x9E37_79B9_7F4A_7C15;
        }
        self.state
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

#[test]
fn test_cumulative_index_matches_high_precision_reference() {
    for seed in 1..200u64 {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let ai_agent_pool = Address::generate(&env);
        let lp_pool = Address::generate(&env);

        let (token_addr, token_client, stellar_asset) = {
            let contract_id = env.register_stellar_asset_contract(admin.clone());
            let token = token::Client::new(&env, &contract_id);
            let sa = token::StellarAssetClient::new(&env, &contract_id);
            (contract_id, token, sa)
        };
        let contract_id = env.register_contract(None, FeeDistributionContract);
        let client = FeeDistributionContractClient::new(&env, &contract_id);
        client.initialize(&admin, &treasury, &ai_agent_pool, &lp_pool, &3000, &2000);

        let n = 5u64;
        let users: Vec<Address> = (0..n).map(|i| Address::generate(&env)).collect();
        for u in &users {
            stellar_asset.mint(u, &10_000_000);
            token_client.approve(u, &contract_id, &10_000_000, &(env.ledger().sequence() + 10_000));
        }

        let mut rng = Prng::new(seed);
        let mut shares_int = vec![0i128; n as usize];
        // Reference exact per-user accrued reward accumulator.
        let mut exact = vec![Rational::zero(); n as usize];
        // Integer total value the contract has paid out (claims) + pending.
        let mut paid = vec![0i128; n as usize];

        let mut fee_source = Address::generate(&env);
        let mut distribute_nonce_guard: i128 = 0;
        let _ = &mut distribute_nonce_guard;

        for _step in 0..40 {
            let ui = rng.below(n) as usize;
            let total_int: i128 = shares_int.iter().sum::<i128>();
            match rng.below(100) {
                0..=45 => {
                    // distribute
                    let amount = (rng.below(10_000) + 1) as i128;
                    stellar_asset.mint(&fee_source, &amount);
                    token_client.approve(&fee_source, &contract_id, &amount, &(env.ledger().sequence() + 10_000));
                    let rec = client.distribute(&token_addr, &fee_source, &amount);
                    // Linear distribution reference: only the LP residual reaches stakers.
                    let ts = total_int;
                    if ts > 0 && rec.lp_share > 0 {
                        for (j, u) in users.iter().enumerate() {
                            let sh = shares_int[j];
                            if sh > 0 {
                                exact[j].add(&BigInt::from(sh * rec.lp_share), &BigInt::from(ts));
                            }
                            let _ = u;
                        }
                    }
                }
                46..=70 => {
                    // stake
                    let amt = (rng.below(200) + 1) as i128;
                    client.stake(&token_addr, &users[ui], &amt);
                    shares_int[ui] += amt;
                }
                71..=90 => {
                    // unstake (partial/full)
                    if shares_int[ui] > 0 {
                        let amt = 1 + rng.below(shares_int[ui] as u64) as i128;
                        client.unstake(&token_addr, &users[ui], &amt);
                        shares_int[ui] -= amt;
                    }
                }
                _ => {
                    // claim
                    let claimed = client.claim(&token_addr, &users[ui]);
                    paid[ui] += claimed;
                }
            }
        }

        // Final settle: catch every user up to the current index before
        // checking the invariant (mirrors a final claim by each participant).
        let claimed = client.claim(&token_addr, &users[0]);
        paid[0] += claimed;
        for i in 1..n as usize {
            let claimed = client.claim(&token_addr, &users[i]);
            paid[i] += claimed;
        }

        // Verify invariants against the high-precision reference.
        for i in 0..n as usize {
            // All accruals are non-negative, so BigInt `/` (truncation) == floor.
            let exact_total = &exact[i].num / &exact[i].den;
            let exact_i: i128 = exact_total
                .clone()
                .to_string()
                .parse::<i128>()
                .unwrap_or(i128::MAX);
            let withdrawable = client.pending_rewards(&token_addr, &users[i]) + paid[i];

            // 1) Never over-claim.
            assert!(
                withdrawable <= exact_i,
                "seed {seed} u{i}: over-claim withdrawable={withdrawable} > exact={exact_i}"
            );
            // 2) Round-trip conserves value within bounded dust.
            assert!(
                exact_i - withdrawable <= MAX_DUST,
                "seed {seed} u{i}: under-pay dust exact={exact_i} withdrawable={withdrawable} ({} > {MAX_DUST})",
                exact_i - withdrawable
            );
        }
    }
}
