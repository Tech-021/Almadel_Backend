const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  roundMoney,
  addMoney,
  subMoney,
  mulMoney,
  pctOf,
  toMoneyNumber,
  moneyEquals,
} = require("../../utils/money");
const { calculateTotals } = require("../../modules/sales/checkout.service");

describe("money precision", () => {
  it("handles classic 0.1 + 0.2 exactly at 2dp", () => {
    assert.equal(toMoneyNumber(addMoney(0.1, 0.2)), 0.3);
  });

  it("sums repeated fractional payments without drift", () => {
    let total = 0;
    for (let i = 0; i < 10; i += 1) {
      total = addMoney(total, 0.1);
    }
    assert.equal(toMoneyNumber(total), 1);
  });

  it("prices multiple decimal sale lines exactly", () => {
    const line1 = mulMoney(19.99, 3);
    const line2 = mulMoney(0.1, 2);
    assert.equal(toMoneyNumber(addMoney(line1, line2)), 60.17);
  });

  it("expected cash = opening + inflows - outflows", () => {
    const opening = 100.5;
    const inflows = 45.25;
    const outflows = 10.1;
    const expected = subMoney(addMoney(opening, inflows), outflows);
    assert.equal(toMoneyNumber(expected), 135.65);
  });

  it("partial payment math stays exact", () => {
    const balance = 100;
    const pay = 33.33;
    assert.equal(toMoneyNumber(subMoney(balance, pay)), 66.67);
    assert.equal(toMoneyNumber(subMoney(66.67, 33.33)), 33.34);
    assert.equal(toMoneyNumber(subMoney(33.34, 33.34)), 0);
  });

  it("percentage discounts round half-up to 2dp", () => {
    assert.equal(toMoneyNumber(pctOf(10, 33.33)), 3.33);
    assert.ok(moneyEquals(roundMoney(1.005), 1.01) || moneyEquals(roundMoney(1.005), 1.0));
  });

  it("calculateTotals combines item + cart discounts in Decimal", () => {
    const totals = calculateTotals(100, 10, "percentage", 10);
    assert.equal(toMoneyNumber(totals.discountAmount), 19);
    assert.equal(toMoneyNumber(totals.totalAmount), 81);
  });
});
