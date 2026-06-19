extern crate std;

use soroban_sdk::{
    contract, contractimpl, contracttype, testutils::Address as _, Address, Env, MuxedAddress,
};

use crate::{AnonymousTipping, AnonymousTippingClient, Error};

#[contract]
pub struct TestToken;

#[contracttype]
#[derive(Clone)]
enum TokenKey {
    Balance(Address),
}

#[contractimpl]
impl TestToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        let balance = Self::balance(env.clone(), to.clone());
        env.storage()
            .persistent()
            .set(&TokenKey::Balance(to), &(balance + amount));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get::<_, i128>(&TokenKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: MuxedAddress, amount: i128) {
        from.require_auth();
        let to = to.address();
        let from_balance = Self::balance(env.clone(), from.clone());
        let to_balance = Self::balance(env.clone(), to.clone());
        env.storage()
            .persistent()
            .set(&TokenKey::Balance(from), &(from_balance - amount));
        env.storage()
            .persistent()
            .set(&TokenKey::Balance(to), &(to_balance + amount));
    }
}

fn setup() -> (Env, AnonymousTippingClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let token_id = env.register(TestToken, ());
    let contract_id = env.register(AnonymousTipping, ());
    let client = AnonymousTippingClient::new(&env, &contract_id);
    client.init(&token_id);
    (env, client, token_id)
}

#[test]
fn send_tip_transfers_xlm_and_records_balance() {
    let (env, client, token_id) = setup();
    let token = TestTokenClient::new(&env, &token_id);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    token.mint(&sender, &1_000);

    let settlement_id = client.send_tip(&sender, &recipient, &125);

    assert_eq!(settlement_id, 1);
    assert_eq!(token.balance(&sender), 875);
    assert_eq!(token.balance(&recipient), 125);
    assert_eq!(client.get_tip_balance(&recipient), 125);
}

#[test]
fn get_tip_balance_returns_cumulative_total() {
    let (env, client, token_id) = setup();
    let token = TestTokenClient::new(&env, &token_id);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    token.mint(&sender, &1_000);

    client.send_tip(&sender, &recipient, &100);
    client.send_tip(&sender, &recipient, &250);

    assert_eq!(client.get_tip_balance(&recipient), 350);
    assert_eq!(token.balance(&recipient), 350);
}

#[test]
fn non_positive_amounts_return_contract_error() {
    let (env, client, _token_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    assert_eq!(
        client.try_send_tip(&sender, &recipient, &0),
        Err(Ok(Error::InvalidTipAmount))
    );
    assert_eq!(
        client.try_send_tip(&sender, &recipient, &-1),
        Err(Ok(Error::InvalidTipAmount))
    );
    assert_eq!(client.get_tip_balance(&recipient), 0);
}
