import hashlib
import hmac
import json
from concurrent.futures import ThreadPoolExecutor
import pytest
from services.payments import Payments, VerifiedPayment
from services.plaza_db import PlazaDb
from services.reward_system import RewardSystem, RewardError


class TestProvider:
    """Test-only adapter; NEVER selectable by an environment variable."""
    __test__ = False
    name = "test-only"
    secret = b"test-only-callback-secret"
    def create(self, order): return {"displayText": "TEST ONLY " + order["id"]}
    def query(self, order): return None
    def cancel(self, order): return True
    def verify_callback(self, raw, headers):
        if not hmac.compare_digest(hmac.new(self.secret, raw, hashlib.sha256).hexdigest(), headers.get("Signature", "")):
            raise RewardError("BAD_SIGNATURE", "invalid signature", 401)
        data = json.loads(raw)
        return VerifiedPayment(**data)


@pytest.fixture
def service(tmp_path):
    db=PlazaDb(tmp_path/'payments.db')
    a=db.create_user('first','not-used'), db.create_user('second','not-used')
    return Payments(RewardSystem(db.db_path),TestProvider()), a


def test_disabled_and_server_price_and_idempotency(service):
    pay, (a,b)=service
    assert not Payments(pay.rewards).capabilities()['available']
    with pytest.raises(RewardError): Payments(pay.rewards).create(a.user_id,'diamonds_10','request-1')
    order=pay.create(a.user_id,'diamonds_10','request-1')['order']
    assert order['amountMinor']==100 and order['status']=='PENDING'
    assert pay.create(a.user_id,'diamonds_10','request-1')['order']==order
    with pytest.raises(RewardError): pay.create(a.user_id,'diamonds_60','request-1')
    with pytest.raises(RewardError): pay.query(b.user_id,order['orderId'])
    assert pay.rewards.dashboard(a)['wallet']['diamonds']==0


def test_verified_callback_duplicate_concurrent_and_wrong_amount(service):
    pay,(a,b)=service
    order=pay.create(a.user_id,'diamonds_10','request-1')['order']
    event=VerifiedPayment(order['orderId'],'trade-1',100,'CNY')
    with pytest.raises(RewardError): pay.callback(b'{}',{'Signature':'forged'})
    with pytest.raises(RewardError): pay.settle(VerifiedPayment(event.order_id,'trade-1',1,'CNY'))
    with pytest.raises(RewardError): pay.settle(VerifiedPayment(event.order_id,'trade-1',100,'USD'))
    raw=json.dumps(event.__dict__).encode()
    signature=hmac.new(TestProvider.secret,raw,hashlib.sha256).hexdigest()
    with ThreadPoolExecutor(4) as pool:
        results=list(pool.map(lambda _:pay.callback(raw,{'Signature':signature}),range(8)))
    assert all(row['status']=='PAID' for row in results)
    assert pay.rewards.dashboard(a)['wallet']['diamonds']==10
    assert pay.rewards.dashboard(b)['wallet']['diamonds']==0
    other=pay.create(a.user_id,'diamonds_10','request-2')['order']
    with pytest.raises(RewardError): pay.settle(VerifiedPayment(other['orderId'],'trade-1',100,'CNY'))
    assert pay.get(a.user_id,other['orderId'])['status']=='PENDING'


def test_cancel_and_provider_timeout_retry_same_order(service):
    pay,(a,_)=service
    original=pay.provider.create
    pay.provider.create=lambda _: (_ for _ in ()).throw(TimeoutError())
    with pytest.raises(TimeoutError): pay.create(a.user_id,'diamonds_10','request-1')
    pay.provider.create=original
    order=pay.create(a.user_id,'diamonds_10','request-1')['order']
    assert pay.cancel(a.user_id,order['orderId'])['status']=='CANCELLED'
    with pytest.raises(RewardError): pay.settle(VerifiedPayment(order['orderId'],'late-trade',100,'CNY'))
    assert pay.rewards.dashboard(a)['wallet']['diamonds']==0
